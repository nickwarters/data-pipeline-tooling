"""Structured JSONL run observability.

A ``RunLog`` composed onto a ``Pipeline`` emits one JSON object per line to a
``.log`` file (the seam the run-registry ingests) and human-readable
lines to the console. Every record of a single run shares one ``pipeline_run_id``.
"""

import datetime
import json
import logging
from pathlib import Path

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.validators import ColumnValidator, ValidationError
from framework.run.builder import Pipeline
from tools.observability.run_log import RunLog


class RecordingReader:
    """A Reader that returns a fixed dataset (mirrors test_pipeline)."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def read(self) -> Dataset:
        return self._dataset


class CapturingWriter:
    """A Writer that captures what it was handed."""

    def __init__(self) -> None:
        self.written: Dataset | None = None

    def write(self, dataset: Dataset) -> None:
        self.written = dataset


def adding_processor(column: str):
    def process(dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas().copy()
        frame[column] = "derived"
        return Dataset.from_pandas(frame)

    return process


def _read_records(log_path: Path) -> list[dict]:
    """Parse the JSONL log: one JSON object per line."""
    return [json.loads(line) for line in log_path.read_text().splitlines()]


def test_run_appends_jsonl_records_sharing_one_run_id(tmp_path):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    p.write(CapturingWriter(), r, name="write")
    p.run()

    records = _read_records(log_path)
    assert records, "expected at least one JSONL record"
    run_ids = {r["pipeline_run_id"] for r in records}
    assert run_ids == {p.pipeline_run_id}


def _by_step(records: list[dict]) -> dict[str, dict]:
    return {r["step"]: r for r in records}


def test_per_step_records_carry_row_counts_and_a_run_summary(tmp_path):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2, 3]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    p.write(CapturingWriter(), r, name="write")
    p.run()

    steps = _by_step(_read_records(log_path))

    assert steps["read"]["status"] == "ok"
    assert steps["write"]["status"] == "ok"

    summary = steps["run"]
    assert summary["status"] == "ok"
    assert isinstance(summary["duration"], (int, float))
    assert summary["duration"] >= 0


def test_write_step_is_marked_committed_read_and_validate_are_not(tmp_path):
    # `committed` flags the steps that durably wrote an artifact (ADR-0005):
    # the write commits, the read and validate steps do not.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1"]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    v = p.validate(ColumnValidator(["case_ref"]), r, name="pre-validate")
    p.write(CapturingWriter(), v, name="write")
    p.run()

    steps = _by_step(_read_records(log_path))
    assert steps["write"]["committed"] is True
    assert steps["read"]["committed"] is False
    assert steps["pre-validate"]["committed"] is False
    assert steps["run"]["committed"] is False


def test_failed_validation_records_the_failing_step_and_aborts(tmp_path):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    v = p.validate(ColumnValidator(["case_ref"]), r, name="pre-validate")
    p.write(CapturingWriter(), v, name="write")

    with pytest.raises(ValidationError):
        p.run()

    records = _read_records(log_path)
    steps = _by_step(records)

    assert steps["read"]["status"] == "ok"

    failed = steps["pre-validate"]
    assert failed["status"] == "error"
    assert any("case_ref" in e for e in failed["errors"])

    assert steps["run"]["status"] == "error"
    assert "write" not in steps


def test_failed_validation_records_its_triage_category(tmp_path):
    # A ValidationError is a DATA failure; the category lands on both the failing
    # step record and the run summary so an operator can triage from the log.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    v = p.validate(ColumnValidator(["case_ref"]), r, name="pre-validate")
    p.write(CapturingWriter(), v, name="write")

    with pytest.raises(ValidationError):
        p.run()

    steps = _by_step(_read_records(log_path))
    assert steps["pre-validate"]["error_category"] == "data"
    assert steps["run"]["error_category"] == "data"


def test_a_raw_bug_records_a_null_category(tmp_path):
    # A non-PipelineError (a genuine bug in a processor) is recorded with a null
    # category — the absence is the signal that this was a bug, not an expected
    # data/operational/config failure.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    def boom(dataset: Dataset) -> Dataset:
        raise KeyError("missing key")

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    t = p.transform(boom, r, name="boom")
    p.write(CapturingWriter(), t, name="write")

    with pytest.raises(KeyError):
        p.run()

    steps = _by_step(_read_records(log_path))
    assert steps["boom"]["status"] == "error"
    assert steps["boom"]["error_category"] is None
    assert steps["run"]["error_category"] is None


def test_warn_validator_is_recorded_as_a_warn_hit_and_the_run_continues(tmp_path):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    v = p.validate(
        ColumnValidator(["case_ref"]), r, name="pre-validate", severity="warn"
    )
    p.write(CapturingWriter(), v, name="write")

    p.run()

    steps = _by_step(_read_records(log_path))

    pre = steps["pre-validate"]
    assert pre["status"] == "ok"
    assert any("case_ref" in w for w in pre["warn_hits"])

    assert "write" in steps
    summary = steps["run"]
    assert summary["status"] == "ok"
    assert any("case_ref" in w for w in summary["warn_hits"])


def test_console_output_is_human_readable_not_raw_json(tmp_path, caplog):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    p.write(CapturingWriter(), r, name="write")

    with caplog.at_level(logging.INFO, logger="tools.observability.run_log"):
        p.run()

    read_lines = [m for m in caplog.messages if "read" in m and "cases" in m]
    assert read_lines, "expected a human-readable console line for the read step"
    line = read_lines[0]
    assert "ok" in line
    with pytest.raises(json.JSONDecodeError):
        json.loads(line)


def test_checkpoint_emits_its_own_step_record(tmp_path):
    log_path = tmp_path / "cases.log"
    ds = Dataset.from_pandas(pd.DataFrame({"id": [1, 2, 3]}))
    reader = RecordingReader(ds)

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    cp0 = p.write(CapturingWriter(), r, name="checkpoint:0")
    p.write(CapturingWriter(), cp0, name="checkpoint:1")
    p.run()

    steps = _by_step(_read_records(log_path))

    assert steps["checkpoint:0"]["status"] == "ok"
    assert steps["checkpoint:1"]["status"] == "ok"


def test_checkpoint_failure_is_recorded_before_run_aborts(tmp_path):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    class BrokenWriter:
        def write(self, dataset: Dataset) -> None:
            raise RuntimeError("disk full")

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    p.write(BrokenWriter(), r, name="checkpoint:0")

    with pytest.raises(RuntimeError):
        p.run()

    steps = _by_step(_read_records(log_path))
    assert steps["checkpoint:0"]["status"] == "error"
    assert steps["run"]["status"] == "error"


def test_named_stages_emit_named_run_log_records(tmp_path):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    v1 = p.validate(ColumnValidator(["id"]), r, name="Validate file shape")
    t1 = p.transform(adding_processor("derived"), v1, name="Normalise cases")
    v2 = p.validate(ColumnValidator(["derived"]), t1, name="Validate normalised cases")
    p.write(CapturingWriter(), v2, name="write")

    p.run()

    steps = _by_step(_read_records(log_path))

    assert steps["Validate file shape"]["status"] == "ok"
    assert steps["Normalise cases"]["status"] == "ok"
    assert steps["Validate normalised cases"]["status"] == "ok"


def test_every_record_carries_a_parseable_utc_timestamp(tmp_path):
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2]})))

    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    p.write(CapturingWriter(), r, name="write")

    before = datetime.datetime.now(datetime.timezone.utc)
    p.run()
    after = datetime.datetime.now(datetime.timezone.utc)

    records = _read_records(log_path)
    assert records
    for record in records:
        stamped = datetime.datetime.fromisoformat(record["timestamp"])
        assert stamped.tzinfo is not None
        assert before <= stamped <= after


def test_each_run_mints_a_fresh_run_id():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    p = Pipeline("cases")
    r = p.read(reader, name="read")
    p.write(CapturingWriter(), r, name="write")

    assert p.pipeline_run_id is None
    p.run()
    first = p.pipeline_run_id
    assert first
    p.run()
    assert p.pipeline_run_id != first
