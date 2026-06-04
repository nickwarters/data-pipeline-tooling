"""The run registry (issue #52, ADR-0005/0007).

A ``RunRegistry`` ingests the structured JSONL a ``RunLog`` emits into its own
queryable SQLite store, so operators can answer "did last night's run succeed,
how many rows, did anything warn?" without grepping ``.log`` files. The tests
drive a *real* ``Pipeline`` + ``RunLog`` to produce the log, then ingest it —
exercising the actual emitter→registry seam, never a hand-faked record shape.
"""

import json

import pandas as pd
import pytest

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.run_log import RunLog
from framework.run_registry import RunRegistry
from framework.validators import (
    ColumnValidator,
    ValidationError,
    VolumeAnomalyValidator,
)


class RecordingReader:
    """A Reader that returns a fixed dataset (mirrors test_run_log)."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def read(self) -> Dataset:
        return self._dataset


class CapturingWriter:
    """A Writer that captures what it was handed."""

    def write(self, dataset: Dataset) -> None:
        self._written = dataset


class PassThroughProcessor:
    """A Processor that returns the dataset unchanged (emits a `process` step)."""

    def process(self, dataset: Dataset) -> Dataset:
        return dataset


def _run_pipeline(log_path, name="cases", rows=2):
    """Drive a real run that emits to ``log_path``; return its run_id."""
    reader = RecordingReader(
        Dataset.from_pandas(pd.DataFrame({"id": list(range(rows))}))
    )
    pipeline = Pipeline(name, reader, run_log=RunLog(log_path))
    pipeline.write_to(CapturingWriter()).run()
    return pipeline.run_id


def test_ingest_makes_a_runs_steps_queryable_by_run_id(tmp_path):
    # The headline behaviour: a RunLog file ingested into the registry, then the
    # run's per-step records read back by its correlating run_id.
    log_path = tmp_path / "cases.log"
    run_id = _run_pipeline(log_path)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    records = registry.records_for_run(run_id)
    steps = {r["step"] for r in records}
    assert {"read", "pre-validate", "post-validate", "write", "run"} <= steps
    assert all(r["run_id"] == run_id for r in records)


def test_ingest_is_idempotent_re_reading_does_not_double_count(tmp_path):
    # Re-reading the same JSONL must not double-count (AC #3): a record's
    # identity is run_id + step (+ ordinal), so the second ingest inserts nothing
    # and the per-run record set is unchanged.
    log_path = tmp_path / "cases.log"
    run_id = _run_pipeline(log_path)

    registry = RunRegistry(tmp_path / "registry.db")
    first = registry.ingest(log_path)
    after_first = registry.records_for_run(run_id)

    second = registry.ingest(log_path)
    after_second = registry.records_for_run(run_id)

    assert first > 0  # the first ingest landed the run's records
    assert second == 0  # the re-read inserted nothing new
    assert len(after_second) == len(after_first)


def test_latest_run_per_pipeline_returns_the_most_recent_summary_each(tmp_path):
    # "Latest run per pipeline" (AC #2): for each pipeline, the most recent run
    # summary by emit time — one row per pipeline, regardless of how many runs.
    log_path = tmp_path / "runs.log"
    _run_pipeline(log_path, name="alpha")
    alpha_latest = _run_pipeline(log_path, name="alpha")  # a second alpha run
    beta_only = _run_pipeline(log_path, name="beta")

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    latest = {r["pipeline"]: r["run_id"] for r in registry.latest_run_per_pipeline()}
    assert latest == {"alpha": alpha_latest, "beta": beta_only}


def _run_failing_pipeline(log_path, name="cases"):
    """Drive a run that aborts at pre-validate (missing column); return run_id."""
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    pipeline = (
        Pipeline(name, reader, run_log=RunLog(log_path))
        .with_validator(ColumnValidator(["case_ref"]))
        .write_to(CapturingWriter())
    )
    with pytest.raises(ValidationError):
        pipeline.run()
    return pipeline.run_id


def test_query_runs_returns_summaries_filterable_by_pipeline_and_status(tmp_path):
    # The run summary (step="run") is the operator's headline row. query_runs
    # returns one per run and narrows by pipeline and by status (AC #2).
    log_path = tmp_path / "runs.log"
    ok_a = _run_pipeline(log_path, name="alpha")
    ok_b = _run_pipeline(log_path, name="beta")
    err_a = _run_failing_pipeline(log_path, name="alpha")

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    all_runs = registry.query_runs()
    assert {r["run_id"] for r in all_runs} == {ok_a, ok_b, err_a}
    assert all(r["step"] == "run" for r in all_runs)  # summaries only

    alpha = registry.query_runs(pipeline="alpha")
    assert {r["run_id"] for r in alpha} == {ok_a, err_a}

    errored = registry.query_runs(status="error")
    assert {r["run_id"] for r in errored} == {err_a}


def test_ingest_tolerates_a_pre_timestamp_log(tmp_path):
    # The registry must read a log written before the timestamp field existed
    # (AC #5, the format the emitter produced previously): the record ingests,
    # its missing timestamp lands as null, and it is still queryable by run_id.
    log_path = tmp_path / "old.log"
    old_record = {  # the pre-amendment shape — no "timestamp" key
        "run_id": "abc123",
        "pipeline": "legacy",
        "step": "run",
        "status": "ok",
        "rows_in": 3,
        "rows_out": 3,
        "errors": [],
        "warn_hits": [],
    }
    log_path.write_text(json.dumps(old_record) + "\n", encoding="utf-8")

    registry = RunRegistry(tmp_path / "registry.db")
    assert registry.ingest(log_path) == 1

    (run,) = registry.query_runs(pipeline="legacy")
    assert run["run_id"] == "abc123"
    assert run["timestamp"] is None
    assert run["rows_out"] == 3


def test_runs_that_warned_surfaces_tolerated_warn_hits(tmp_path):
    # A warn-severity breach (the home of a schema-drift warning, ADR-0008) is
    # tolerated — the run stays "ok" — but its message is carried on the run
    # summary's warn_hits. runs_that_warned returns exactly those runs, with the
    # messages decoded back to a list, so a drift is visible without re-grepping
    # (AC #2 "runs that warned" + AC #6 schema-drift surfacing).
    log_path = tmp_path / "runs.log"
    clean = _run_pipeline(log_path, name="alpha")  # no warns

    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    warned = (
        Pipeline("beta", reader, run_log=RunLog(log_path))
        .with_validator(ColumnValidator(["case_ref"]), severity="warn")
        .write_to(CapturingWriter())
    )
    warned.run()

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    warned_runs = registry.runs_that_warned()
    assert {r["run_id"] for r in warned_runs} == {warned.run_id}
    assert clean not in {r["run_id"] for r in warned_runs}
    hits = warned_runs[0]["warn_hits"]
    assert isinstance(hits, list) and any("case_ref" in h for h in hits)


def test_recent_row_counts_returns_read_volumes_most_recent_first(tmp_path):
    # The volume guardrail (#54) derives its baseline from the read-step volume
    # of recent runs. recent_row_counts returns those counts for one pipeline,
    # most-recent-first, capped at `limit` — so a band can be built over "the
    # last N runs" without re-grepping logs.
    log_path = tmp_path / "runs.log"
    for rows in (100, 110, 90, 105):  # four healthy nights, in time order
        _run_pipeline(log_path, name="cases", rows=rows)
    _run_pipeline(log_path, name="other", rows=5)  # a different feed

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    assert registry.recent_row_counts("cases", limit=3) == [105, 90, 110]


def test_recent_row_counts_excludes_aborted_runs_from_the_baseline(tmp_path):
    # A run that read rows but then aborted (its summary is "error") must not
    # count toward the volume baseline (#54): otherwise a run the guardrail
    # itself tripped would drag tonight's baseline down toward the bad value.
    log_path = tmp_path / "runs.log"
    _run_pipeline(log_path, name="cases", rows=100)
    _run_failing_pipeline(log_path, name="cases")  # reads 1 row, then aborts
    _run_pipeline(log_path, name="cases", rows=110)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    # Only the two healthy runs' read volumes appear — not the aborted run's 1.
    assert registry.recent_row_counts("cases", limit=10) == [110, 100]


def test_volume_guardrail_trips_against_real_history_and_records_to_the_runlog(
    tmp_path,
):
    # End-to-end (#54): healthy runs build a baseline in the registry, then a
    # truncated run attaches a VolumeAnomalyValidator that reads that baseline.
    # Attached as warn, the run completes but its trip is recorded to the RunLog
    # — visible via the registry's runs_that_warned (AC #5: trips recorded).
    history_log = tmp_path / "history.log"
    for rows in (100, 110, 90, 105):
        _run_pipeline(history_log, name="cases", rows=rows)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(history_log)

    # Tonight's source export is truncated to 5 rows — far below the ~100 base.
    truncated_log = tmp_path / "tonight.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [0, 1, 2, 3, 4]})))
    pipeline = (
        Pipeline("cases", reader, run_log=RunLog(truncated_log))
        .with_validator(
            VolumeAnomalyValidator(registry, pipeline="cases", tolerance=0.5),
            severity="warn",
        )
        .write_to(CapturingWriter())
    )
    pipeline.run()  # warn-severity: completes rather than aborting

    registry.ingest(truncated_log)
    warned = registry.runs_that_warned()
    assert pipeline.run_id in {r["run_id"] for r in warned}
    (this_run,) = [r for r in warned if r["run_id"] == pipeline.run_id]
    assert any("deviates" in hit for hit in this_run["warn_hits"])


def test_volume_guardrail_aborts_the_run_at_error_severity(tmp_path):
    # At the default error severity the same trip aborts the run fail-fast
    # (ADR-0007) before anything lands, and the run is recorded as errored.
    history_log = tmp_path / "history.log"
    for rows in (100, 110, 90, 105):
        _run_pipeline(history_log, name="cases", rows=rows)
    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(history_log)

    truncated_log = tmp_path / "tonight.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [0, 1, 2]})))
    pipeline = (
        Pipeline("cases", reader, run_log=RunLog(truncated_log))
        .with_validator(VolumeAnomalyValidator(registry, pipeline="cases"))
        .write_to(CapturingWriter())
    )
    with pytest.raises(ValidationError, match="deviates"):
        pipeline.run()

    registry.ingest(truncated_log)
    (summary,) = registry.query_runs(pipeline="cases", status="error")
    assert summary["run_id"] == pipeline.run_id


def test_repeated_process_steps_are_kept_distinct_not_deduped(tmp_path):
    # A multi-processor run emits one `process` record per processor, all under
    # the same run_id + step="process". A bare (run_id, step) key would collide
    # them into one; the step ordinal keeps both, and re-ingest stays idempotent.
    log_path = tmp_path / "cases.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2]})))
    pipeline = (
        Pipeline("cases", reader, run_log=RunLog(log_path))
        .with_processor(PassThroughProcessor())
        .with_processor(PassThroughProcessor())
        .write_to(CapturingWriter())
    )
    pipeline.run()

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    process_records = [
        r for r in registry.records_for_run(pipeline.run_id) if r["step"] == "process"
    ]
    assert len(process_records) == 2
    assert {r["step_ordinal"] for r in process_records} == {0, 1}

    # Re-ingest must not duplicate the two process records.
    registry.ingest(log_path)
    again = [
        r for r in registry.records_for_run(pipeline.run_id) if r["step"] == "process"
    ]
    assert len(again) == 2
