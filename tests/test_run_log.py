"""Structured JSONL run observability (issue #4, ADR-0007).

A ``RunLog`` composed onto a ``Pipeline`` emits one JSON object per line to a
``.log`` file (the seam the future run-registry ingests) and human-readable
lines to the console. Every record of a single run shares one ``run_id``.
"""

import json
import logging
from pathlib import Path

import pandas as pd
import pytest

from framework.builder import Pipeline
from framework.data_handle import DataHandle
from framework.run_log import RunLog
from framework.validators import ColumnValidator, ValidationError


class RecordingReader:
    """A Reader that returns a fixed handle (mirrors test_pipeline)."""

    def __init__(self, handle: DataHandle) -> None:
        self._handle = handle

    def read(self) -> DataHandle:
        return self._handle


class CapturingWriter:
    """A Writer that captures what it was handed."""

    def __init__(self) -> None:
        self.written: DataHandle | None = None

    def write(self, handle: DataHandle) -> None:
        self.written = handle


def _read_records(log_path: Path) -> list[dict]:
    """Parse the JSONL log: one JSON object per line."""
    return [json.loads(line) for line in log_path.read_text().splitlines()]


def test_run_appends_jsonl_records_sharing_one_run_id(tmp_path):
    # A successful run writes its records as JSONL (one JSON object per line) to
    # the .log file, and every record carries the same correlating run_id.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(DataHandle.from_pandas(pd.DataFrame({"id": [1, 2]})))
    pipeline = Pipeline("cases", reader, run_log=RunLog(log_path))

    pipeline.write_to(CapturingWriter()).run()

    records = _read_records(log_path)
    assert records, "expected at least one JSONL record"
    run_ids = {r["run_id"] for r in records}
    assert run_ids == {pipeline.run_id}


def _by_step(records: list[dict]) -> dict[str, dict]:
    return {r["step"]: r for r in records}


def test_per_step_records_carry_row_counts_and_a_run_summary(tmp_path):
    # One record per step: `read` reports the rows it produced, `write` the rows
    # it consumed, and a final `run` summary reports overall status and the total
    # duration. All are status "ok" on the happy path.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(DataHandle.from_pandas(pd.DataFrame({"id": [1, 2, 3]})))
    pipeline = Pipeline("cases", reader, run_log=RunLog(log_path))

    pipeline.write_to(CapturingWriter()).run()

    steps = _by_step(_read_records(log_path))

    assert steps["read"]["status"] == "ok"
    assert steps["read"]["rows_out"] == 3

    assert steps["write"]["status"] == "ok"
    assert steps["write"]["rows_in"] == 3

    summary = steps["run"]
    assert summary["status"] == "ok"
    assert isinstance(summary["duration"], (int, float))
    assert summary["duration"] >= 0


def test_failed_validation_records_the_failing_step_and_aborts(tmp_path):
    # An error-severity validator aborts the run (ADR-0007 fail-fast): the
    # failing step is recorded `error` with the message, the run summary is
    # `error`, no `write` record is emitted (nothing partial lands), and the
    # ValidationError still propagates to the caller.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(DataHandle.from_pandas(pd.DataFrame({"id": [1]})))
    pipeline = (
        Pipeline("cases", reader, run_log=RunLog(log_path))
        .with_validator(ColumnValidator(["case_ref"]))
        .write_to(CapturingWriter())
    )

    with pytest.raises(ValidationError):
        pipeline.run()

    records = _read_records(log_path)
    steps = _by_step(records)

    assert steps["read"]["status"] == "ok"

    failed = steps["pre-validate"]
    assert failed["status"] == "error"
    assert any("case_ref" in e for e in failed["errors"])

    assert steps["run"]["status"] == "error"
    assert "write" not in steps


def test_warn_validator_is_recorded_as_a_warn_hit_and_the_run_continues(tmp_path):
    # warn is the explicit escape hatch (ADR-0007): the failure is recorded as a
    # warn-hit on its step, the step status stays "ok", the run proceeds to the
    # write, and the run summary surfaces the warn-hit so a tolerated condition
    # is still visible to the registry.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(DataHandle.from_pandas(pd.DataFrame({"id": [1]})))
    pipeline = (
        Pipeline("cases", reader, run_log=RunLog(log_path))
        .with_validator(ColumnValidator(["case_ref"]), severity="warn")
        .write_to(CapturingWriter())
    )

    pipeline.run()

    steps = _by_step(_read_records(log_path))

    pre = steps["pre-validate"]
    assert pre["status"] == "ok"
    assert any("case_ref" in w for w in pre["warn_hits"])

    assert "write" in steps  # the run continued past the warn
    summary = steps["run"]
    assert summary["status"] == "ok"
    assert any("case_ref" in w for w in summary["warn_hits"])


def test_console_output_is_human_readable_not_raw_json(tmp_path, caplog):
    # Alongside the JSONL file, each record echoes a human-readable line to the
    # console for development — naming the pipeline, step and status in prose,
    # *not* as a raw JSON object.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(DataHandle.from_pandas(pd.DataFrame({"id": [1, 2]})))
    pipeline = Pipeline("cases", reader, run_log=RunLog(log_path))

    with caplog.at_level(logging.INFO, logger="framework.run_log"):
        pipeline.write_to(CapturingWriter()).run()

    read_lines = [m for m in caplog.messages if "read" in m and "cases" in m]
    assert read_lines, "expected a human-readable console line for the read step"
    line = read_lines[0]
    assert "ok" in line
    with pytest.raises(json.JSONDecodeError):
        json.loads(line)  # human-readable prose, not a JSON object


def test_each_run_mints_a_fresh_run_id():
    # `.run()` mints a uuid run_id, exposed as `pipeline.run_id`; re-running the
    # same builder correlates a *new* run, so the id changes each time.
    reader = RecordingReader(DataHandle.from_pandas(pd.DataFrame({"id": [1]})))
    pipeline = Pipeline("cases", reader)

    assert pipeline.run_id is None  # nothing has run yet
    pipeline.run()
    first = pipeline.run_id
    assert first
    pipeline.run()
    assert pipeline.run_id != first
