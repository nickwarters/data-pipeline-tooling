```python
"""The run registry.

A ``RunRegistry`` ingests the structured JSONL a ``RunLog`` emits into its own
queryable SQLite store, so operators can answer "did last night's run succeed,
how many rows, did anything warn?" without grepping ``.log`` files. The tests
drive a *real* ``Pipeline`` + ``RunLog`` to produce the log, then ingest it —
exercising the actual emitter→registry seam, never a hand-faked record shape.
"""

import json
import sqlite3
from datetime import date

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.validators import (
    ColumnValidator,
    ValidationError,
    VolumeAnomalyValidator,
)
from framework.run import RunAddress
from framework.run.builder import Pipeline
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry


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

    def __call__(self, dataset: Dataset) -> Dataset:
        return dataset


def _run_pipeline(log_path, name="cases", rows=2):
    """Drive a real run that emits to ``log_path``; return its run_id."""
    reader = RecordingReader(
        Dataset.from_pandas(pd.DataFrame({"id": list(range(rows))}))
    )
    p = Pipeline(name, run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    p.write(CapturingWriter(), r, name="write")
    p.run()
    return p.run_id


def _record(run_id, pipeline, step, status, timestamp):
    return {
        "timestamp": timestamp,
        "run_id": run_id,
        "pipeline": pipeline,
        "step": step,
        "step_address": pipeline if step == "run" else f"{pipeline}.{step}",
        "status": status,
        "rows_in": None,
        "rows_out": None,
        "rows_quarantined": None,
        "rows_excluded": None,
        "duration": 0.001,
        "errors": ["boom"] if status == "error" else [],
        "error_category": "data" if status == "error" else None,
        "warn_hits": [],
        "committed": False,
    }


def _write_records(log_path, records):
    log_path.write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )


def test_ingest_makes_a_runs_steps_queryable_by_run_id(tmp_path):
    # The headline behaviour: a RunLog file ingested into the registry, then the
    # run's per-step records read back by its correlating run_id.
    log_path = tmp_path / "cases.log"
    run_id = _run_pipeline(log_path)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    records = registry.records_for_run(run_id)
    steps = {r["step"] for r in records}
    assert {"read", "write", "run"} <= steps
    assert all(r["run_id"] == run_id for r in records)


def test_ingest_makes_step_addresses_queryable(tmp_path):
    log_path = tmp_path / "runs.log"
    run_id = _run_pipeline(log_path, name="pipeline_2")

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    [read] = registry.records_for_address("pipeline_2.read")
    assert read["run_id"] == run_id
    assert read["pipeline"] == "pipeline_2"
    assert read["step"] == "read"
    assert read["step_address"] == "pipeline_2.read"

    assert registry.has_successful_address("pipeline_2.read")
    assert not registry.has_successful_address("pipeline_2.missing")


def test_ingest_is_idempotent_re_reading_does_not_double_count(tmp_path):
    # Re-reading the same JSONL must not double-count: a record's
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
    # "Latest run per pipeline": for each pipeline, the most recent run
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
    p = Pipeline(name, run_log=RunLog(log_path))
    r = p.read(reader, name="read")
    v = p.validate(ColumnValidator(["case_ref"]), r, name="pre-validate")
    p.write(CapturingWriter(), v, name="write")
    with pytest.raises(ValidationError):
        p.run()
    return p.run_id


def test_query_runs_returns_summaries_filterable_by_pipeline_and_status(tmp_path):
    # The run summary (step="run") is the operator's headline row. query_runs
    # returns one per run and narrows by pipeline and by status.
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


def test_latest_success_for_pipeline_address_uses_latest_ok_run_summary(tmp_path):
    log_path = tmp_path / "runs.log"
    records = [
        _record("old-ok", "pipeline_4", "run", "ok", "2026-06-22T23:00:00+00:00"),
        _record("latest-ok", "pipeline_4", "run", "ok", "2026-06-23T09:00:00+00:00"),
        _record(
            "latest-failed",
            "pipeline_4",
            "run",
            "error",
            "2026-06-23T10:00:00+00:00",
        ),
    ]
    _write_records(log_path, records)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    latest = registry.latest_success(
        RunAddress.pipeline("pipeline_4"), on=date(2026, 6, 23)
    )
    assert latest is not None
    assert latest["run_id"] == "latest-ok"
    assert latest["step"] == "run"


def test_latest_success_backfills_legacy_rows_without_step_address(tmp_path):
    db_path = tmp_path / "registry.db"
    con = sqlite3.connect(db_path)
    try:
        con.execute(
            """
            CREATE TABLE run_records (
                timestamp        TEXT,
                run_id           TEXT NOT NULL,
                pipeline         TEXT,
                step             TEXT NOT NULL,
                step_ordinal     INTEGER NOT NULL,
                status           TEXT,
                rows_in          INTEGER,
                rows_out         INTEGER,
                rows_quarantined INTEGER,
                rows_excluded    INTEGER,
                duration         REAL,
                errors           TEXT,
                error_category   TEXT,
                warn_hits        TEXT,
                PRIMARY KEY (run_id, step, step_ordinal)
            )
            """
        )
        con.execute(
            """
            INSERT INTO run_records (
                timestamp, run_id, pipeline, step, step_ordinal, status,
                errors, warn_hits
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "2026-06-23T09:00:00+00:00",
                "legacy-ok",
                "pipeline_4",
                "run",
                0,
                "ok",
                "[]",
                "[]",
            ),
        )
        con.commit()
    finally:
        con.close()

    latest = RunRegistry(db_path).latest_success(RunAddress.pipeline("pipeline_4"))

    assert latest is not None
    assert latest["run_id"] == "legacy-ok"
    assert latest["step_address"] == "pipeline_4"


def test_latest_success_for_task_address_uses_latest_ok_non_run_step(tmp_path):
    log_path = tmp_path / "runs.log"
    records = [
        _record(
            "old-run",
            "pipeline_2",
            "step_4",
            "ok",
            "2026-06-16T07:00:00+00:00",
        ),
        _record(
            "latest-ok-run",
            "pipeline_2",
            "step_4",
            "ok",
            "2026-06-23T08:00:00+00:00",
        ),
        _record(
            "latest-failed-run",
            "pipeline_2",
            "step_4",
            "error",
            "2026-06-23T09:00:00+00:00",
        ),
        _record(
            "summary-with-same-address",
            "pipeline_2",
            "run",
            "ok",
            "2026-06-23T10:00:00+00:00",
        ),
    ]
    _write_records(log_path, records)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    latest = registry.latest_success(
        RunAddress.task("pipeline_2", "step_4"), on_or_after=date(2026, 6, 16)
    )
    assert latest is not None
    assert latest["run_id"] == "latest-ok-run"
    assert latest["step"] == "step_4"

    assert (
        registry.latest_success(
            RunAddress.task("pipeline_2", "step_4"), on_or_after=date(2026, 6, 24)
        )
        is None
    )


def test_ingest_preserves_the_error_triage_category(tmp_path):
    # The failure's triage category survives the emitter->registry round-trip, so
    # an operator can query "which runs failed on a data issue?" without grepping.
    log_path = tmp_path / "runs.log"
    err = _run_failing_pipeline(log_path, name="cases")

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    by_step = {r["step"]: r for r in registry.records_for_run(err)}
    # A missing-column ValidationError is a DATA failure.
    assert by_step["pre-validate"]["error_category"] == "data"
    assert by_step["run"]["error_category"] == "data"


def test_ingest_tolerates_a_pre_timestamp_log(tmp_path):
    # The registry must read a log written before the timestamp field existed
    # (, the format the emitter produced previously): the record ingests,
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
    # A warn-severity breach (the home of a schema-drift warning, ) is
    # tolerated — the run stays "ok" — but its message is carried on the run
    # summary's warn_hits. runs_that_warned returns exactly those runs, with the
    # messages decoded back to a list, so a drift is visible without re-grepping
    # ("runs that warned" + schema-drift surfacing).
    log_path = tmp_path / "runs.log"
    clean = _run_pipeline(log_path, name="alpha")  # no warns

    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    warned = Pipeline("beta", run_log=RunLog(log_path))
    r = warned.read(reader, name="read")
    v = warned.validate(
        ColumnValidator(["case_ref"]), r, name="pre-validate", severity="warn"
    )
    warned.write(CapturingWriter(), v, name="write")
    warned.run()

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    warned_runs = registry.runs_that_warned()
    assert {r["run_id"] for r in warned_runs} == {warned.run_id}
    assert clean not in {r["run_id"] for r in warned_runs}
    hits = warned_runs[0]["warn_hits"]
    assert isinstance(hits, list) and any("case_ref" in h for h in hits)


def test_recent_row_counts_returns_read_volumes_most_recent_first(tmp_path):
    # The volume guardrail derives its baseline from the read-step volume
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
    # count toward the volume baseline: otherwise a run the guardrail
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
    # End-to-end: healthy runs build a baseline in the registry, then a
    # truncated run attaches a VolumeAnomalyValidator that reads that baseline.
    # Attached as warn, the run completes but its trip is recorded to the RunLog
    # — visible via the registry's runs_that_warned (trips recorded).
    history_log = tmp_path / "history.log"
    for rows in (100, 110, 90, 105):
        _run_pipeline(history_log, name="cases", rows=rows)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(history_log)

    # Tonight's source export is truncated to 5 rows — far below the ~100 base.
    truncated_log = tmp_path / "tonight.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [0, 1, 2, 3, 4]})))
    pipeline = Pipeline("cases", run_log=RunLog(truncated_log))
    r = pipeline.read(reader, name="read")
    v = pipeline.validate(
        VolumeAnomalyValidator(registry, pipeline="cases", tolerance=0.5),
        r,
        name="volume-guardrail",
        severity="warn",
    )
    pipeline.write(CapturingWriter(), v, name="write")
    pipeline.run()  # warn-severity: completes rather than aborting

    registry.ingest(truncated_log)
    warned = registry.runs_that_warned()
    assert pipeline.run_id in {r["run_id"] for r in warned}
    (this_run,) = [r for r in warned if r["run_id"] == pipeline.run_id]
    assert any("deviates" in hit for hit in this_run["warn_hits"])


def test_volume_guardrail_aborts_the_run_at_error_severity(tmp_path):
    # At the default error severity the same trip aborts the run fail-fast
    # before anything lands, and the run is recorded as errored.
    history_log = tmp_path / "history.log"
    for rows in (100, 110, 90, 105):
        _run_pipeline(history_log, name="cases", rows=rows)
    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(history_log)

    truncated_log = tmp_path / "tonight.log"
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [0, 1, 2]})))
    pipeline = Pipeline("cases", run_log=RunLog(truncated_log))
    r = pipeline.read(reader, name="read")
    v = pipeline.validate(
        VolumeAnomalyValidator(registry, pipeline="cases"), r, name="volume-guardrail"
    )
    pipeline.write(CapturingWriter(), v, name="write")

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
    pipeline = Pipeline("cases", run_log=RunLog(log_path))
    r = pipeline.read(reader, name="read")
    t1 = pipeline.transform(PassThroughProcessor(), r, name="process")
    t2 = pipeline.transform(PassThroughProcessor(), t1, name="process")
    pipeline.write(CapturingWriter(), t2, name="write")
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


# ---------------------------------------------------------------------------
# Incremental-ingest tests (issue #146)
# ---------------------------------------------------------------------------


def test_incremental_ingest_second_call_returns_only_new_records(tmp_path):
    # After a first ingest, appending new records and calling ingest() again
    # returns only the count of newly added records — not the full file count.
    # The registry contents must equal a fresh full ingest on the same data.
    log_path = tmp_path / "cases.log"
    run_id_a = _run_pipeline(log_path, name="cases")

    registry = RunRegistry(tmp_path / "registry.db")
    first_count = registry.ingest(log_path)
    assert first_count > 0

    # Append a second run to the same log file.
    run_id_b = _run_pipeline(log_path, name="cases")

    second_count = registry.ingest(log_path)
    assert second_count > 0  # only the new run's records

    # Total records == full ingest of the combined file into a fresh registry.
    fresh_registry = RunRegistry(tmp_path / "fresh.db")
    fresh_count = fresh_registry.ingest(log_path)
    assert first_count + second_count == fresh_count

    # Both runs are queryable.
    all_runs = {r["run_id"] for r in registry.query_runs()}
    assert {run_id_a, run_id_b} <= all_runs

    # Ordinals match between incremental and fresh ingest.
    for run_id in (run_id_a, run_id_b):
        inc_records = sorted(
            registry.records_for_run(run_id),
            key=lambda r: (r["step"], r["step_ordinal"]),
        )
        fresh_records = sorted(
            fresh_registry.records_for_run(run_id),
            key=lambda r: (r["step"], r["step_ordinal"]),
        )
        assert [(r["step"], r["step_ordinal"]) for r in inc_records] == [
            (r["step"], r["step_ordinal"]) for r in fresh_records
        ]


def test_incremental_ingest_ordinals_continue_across_boundary(tmp_path):
    # Correctness-critical: a multi-processor run whose `process` records
    # straddle two ingest calls must still get ordinals 0, 1, 2, ... with no
    # silent drops.  Simulate by writing two `process` records manually so the
    # first ingest sees only one and the second sees the other.
    import json as _json

    # Craft a log with a single run that has three `process` entries.
    # We write them one at a time to simulate the straddle.
    proc_log = tmp_path / "proc.log"
    base = {
        "run_id": "straddle-run",
        "pipeline": "cases",
        "step": "process",
        "status": "ok",
        "rows_in": 2,
        "rows_out": 2,
        "rows_quarantined": None,
        "rows_excluded": None,
        "duration": 0.001,
        "errors": [],
        "warn_hits": [],
        "timestamp": "2026-01-01T00:00:00+00:00",
    }

    # Write the first two process records + a partial run summary (no newline
    # after last line is NOT the scenario here — both lines are complete).
    line0 = _json.dumps({**base}) + "\n"
    line1 = _json.dumps({**base}) + "\n"
    line2 = _json.dumps({**base}) + "\n"

    proc_log.write_bytes(line0.encode("utf-8"))

    registry = RunRegistry(tmp_path / "registry.db")
    c1 = registry.ingest(proc_log)
    assert c1 == 1  # first process record ingested

    # Append two more process records.
    with proc_log.open("ab") as fh:
        fh.write(line1.encode("utf-8"))
        fh.write(line2.encode("utf-8"))

    c2 = registry.ingest(proc_log)
    assert c2 == 2  # both new records ingested (not silently dropped)

    # All three records present with ordinals 0, 1, 2 — no gaps, no duplicates.
    process_records = [
        r for r in registry.records_for_run("straddle-run") if r["step"] == "process"
    ]
    assert len(process_records) == 3
    assert {r["step_ordinal"] for r in process_records} == {0, 1, 2}


def test_incremental_ingest_partial_line_not_ingested_then_completed(tmp_path):
    # A trailing partial line (no terminating \n) is not ingested and not
    # counted.  Once the writer completes the line (appends \n + maybe more),
    # the next ingest picks it up exactly once.
    import json as _json

    log_path = tmp_path / "cases.log"

    record = _json.dumps(
        {
            "run_id": "partial-run",
            "pipeline": "cases",
            "step": "run",
            "status": "ok",
            "rows_in": 1,
            "rows_out": 1,
            "rows_quarantined": None,
            "rows_excluded": None,
            "duration": 0.001,
            "errors": [],
            "warn_hits": [],
            "timestamp": "2026-01-01T00:00:00+00:00",
        }
    )

    # Write without trailing newline — mid-append simulation.
    log_path.write_bytes(record.encode("utf-8"))

    registry = RunRegistry(tmp_path / "registry.db")
    count = registry.ingest(log_path)
    assert count == 0  # partial line — nothing ingested

    # Complete the line.
    with log_path.open("ab") as fh:
        fh.write(b"\n")

    count2 = registry.ingest(log_path)
    assert count2 == 1  # now it lands

    # Re-ingest: idempotent — no duplicates.
    count3 = registry.ingest(log_path)
    assert count3 == 0

    records = registry.records_for_run("partial-run")
    assert len(records) == 1


def test_incremental_ingest_truncation_resets_and_picks_up_new_file(tmp_path):
    # If the file is shorter than the stored offset (truncation / rotation),
    # the offset resets to 0 and the new file is ingested from the top.
    log_path = tmp_path / "cases.log"
    _run_pipeline(log_path, name="cases")

    registry = RunRegistry(tmp_path / "registry.db")
    first_count = registry.ingest(log_path)
    assert first_count > 0

    # Replace the file with a shorter one containing a new run.
    import json as _json

    new_record = _json.dumps(
        {
            "run_id": "new-run-after-rotation",
            "pipeline": "cases",
            "step": "run",
            "status": "ok",
            "rows_in": 5,
            "rows_out": 5,
            "rows_quarantined": None,
            "rows_excluded": None,
            "duration": 0.001,
            "errors": [],
            "warn_hits": [],
            "timestamp": "2026-06-01T00:00:00+00:00",
        }
    )
    log_path.write_bytes((new_record + "\n").encode("utf-8"))

    count_after = registry.ingest(log_path)
    assert count_after == 1  # the new record, ingested from the top

    records = registry.records_for_run("new-run-after-rotation")
    assert len(records) == 1
    assert records[0]["rows_out"] == 5


def test_incremental_ingest_no_new_content_returns_zero(tmp_path):
    # Re-ingesting with no new content returns 0 and advances nothing.
    log_path = tmp_path / "cases.log"
    _run_pipeline(log_path, name="cases")

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    assert registry.ingest(log_path) == 0
    assert registry.ingest(log_path) == 0  # stable across multiple calls


def test_incremental_ingest_offset_persisted_across_registry_instances(tmp_path):
    # The byte offset lives in the DB, not in memory.  A second RunRegistry
    # instance pointing at the same DB must pick up where the first left off.
    log_path = tmp_path / "cases.log"
    _run_pipeline(log_path, name="cases")

    db_path = tmp_path / "registry.db"
    registry_a = RunRegistry(db_path)
    count_a = registry_a.ingest(log_path)
    assert count_a > 0

    # Append a second run.
    _run_pipeline(log_path, name="cases")

    # A fresh instance against the same DB should only see the new tail.
    registry_b = RunRegistry(db_path)
    count_b = registry_b.ingest(log_path)
    assert count_b > 0
    assert count_b == count_a  # same pipeline / step structure → same record count

    # And re-ingesting with registry_a (same DB) also sees nothing new.
    assert registry_a.ingest(log_path) == 0


def test_committed_marker_round_trips_through_ingest(tmp_path):
    # The write step's `committed` artifact marker (ADR-0007 amd 03) survives the
    # emitter -> registry seam: it reads back as True on write, False on read.
    log_path = tmp_path / "cases.log"
    run_id = _run_pipeline(log_path)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    by_step = {r["step"]: r for r in registry.records_for_run(run_id)}
    assert by_step["write"]["committed"] is True
    assert by_step["read"]["committed"] is False


def test_ingest_migrates_a_pre_committed_registry_db(tmp_path):
    # A registry DB created before the `committed` column existed must keep
    # ingesting: _connect adds the column in place rather than erroring on the
    # INSERT that names it.
    import sqlite3

    db_path = tmp_path / "registry.db"
    con = sqlite3.connect(db_path)
    con.execute(
        """
        CREATE TABLE run_records (
            timestamp        TEXT,
            run_id           TEXT NOT NULL,
            pipeline         TEXT,
            step             TEXT NOT NULL,
            step_ordinal     INTEGER NOT NULL,
            status           TEXT,
            rows_in          INTEGER,
            rows_out         INTEGER,
            rows_quarantined INTEGER,
            rows_excluded    INTEGER,
            duration         REAL,
            errors           TEXT,
            error_category   TEXT,
            warn_hits        TEXT,
            PRIMARY KEY (run_id, step, step_ordinal)
        )
        """
    )
    con.commit()
    con.close()

    log_path = tmp_path / "cases.log"
    run_id = _run_pipeline(log_path)

    registry = RunRegistry(db_path)
    assert registry.ingest(log_path) > 0  # the migration let the INSERT through

    by_step = {r["step"]: r for r in registry.records_for_run(run_id)}
    assert by_step["write"]["committed"] is True

```
