"""Tests for the ``pipeline_run_metric`` Reporting pipeline.

Each reduction is exercised on a few registry records whose answer can be
checked by hand, then one end-to-end run lands every table through the
migrated write path from a real run log.
"""

from __future__ import annotations

import datetime as dt
import sqlite3

import pandas as pd
import pytest

from framework.core import RUN_PROVENANCE_COLUMN, Dataset
from pipelines.pipeline_run_metric import metrics
from pipelines.pipeline_run_metric.pipeline import GOLD_TABLES, main
from tests.framework_testing import build_databases, given_rows, read_rows
from tools.medallion import medallion
from tools.observability import timestamps
from tools.observability.record_schema import (
    RUN_RECORD_COLUMNS,
    RUN_RECORD_PRIMARY_KEY,
    create_table_sql,
)
from tools.observability.run_log import RunLog
from tools.observability.run_store import RunStore
from tools.store import StoreRegistry

AS_OF = "2026-08-27T07:00:05+00:00"
LOGICAL = "ingest:2026-08-27"


def _record(
    run_id: str,
    step: str,
    status: str = "ok",
    *,
    at: str,
    pipeline: str = "ingest",
    logical_run_id: str | None = LOGICAL,
    step_address: str | None = None,
    rows_in=None,
    rows_out=None,
    rows_quarantined=None,
    rows_excluded=None,
    duration=None,
    error_category=None,
    warn_hits: str = "[]",
    committed: int = 0,
    run_date: str | None = None,
) -> dict[str, object]:
    """One registry row as ``SqliteReader`` hands it over: lists as JSON text,
    the flag as 0/1."""
    return {
        "timestamp": at,
        "pipeline_run_id": run_id,
        "logical_run_id": logical_run_id,
        "pipeline": pipeline,
        "step": step,
        "step_address": step_address,
        "status": status,
        "rows_in": rows_in,
        "rows_out": rows_out,
        "rows_quarantined": rows_quarantined,
        "rows_excluded": rows_excluded,
        "duration": duration,
        "error_category": error_category,
        "warn_hits": warn_hits,
        "committed": committed,
        "run_date": run_date,
    }


# A successful run, then a failed re-drive of the same logical run.
RECORDS = [
    _record(
        "r1",
        "read",
        at="2026-08-27T07:00:00+00:00",
        step_address="ingest.read",
        rows_out=100,
        duration=0.5,
    ),
    _record(
        "r1",
        "validate",
        at="2026-08-27T07:00:01+00:00",
        step_address="ingest.validate",
        rows_in=100,
        rows_out=90,
        rows_quarantined=10,
        duration=0.2,
        warn_hits='["w1", "w2"]',
    ),
    _record(
        "r1",
        "write",
        at="2026-08-27T07:00:02+00:00",
        step_address="ingest.write",
        rows_in=90,
        rows_out=90,
        duration=0.3,
        committed=1,
    ),
    _record("r1", "run", at="2026-08-27T07:00:02+00:00", duration=1.1),
    _record(
        "r2",
        "read",
        "error",
        at="2026-08-27T07:00:04+00:00",
        step_address="ingest.read",
        duration=0.9,
        error_category="data",
    ),
    _record("r2", "run", "error", at=AS_OF, duration=1.0, error_category="data"),
]


def _rows(dataset: Dataset) -> list[dict[str, object]]:
    return [
        {k: (None if pd.isna(v) else v) for k, v in row.items()}
        for row in dataset.to_pandas().to_dict(orient="records")
    ]


def test_as_of_is_the_latest_record_or_none_for_an_empty_registry():
    assert metrics.latest_instant(given_rows(RECORDS).read()) == AS_OF
    empty = Dataset.from_pandas(pd.DataFrame(columns=list(metrics.RECORD_COLUMNS)))
    assert metrics.latest_instant(empty) is None


def test_run_summary_is_one_row_per_run_ranked_within_its_logical_run():
    result = _rows(metrics.run_summary(given_rows(RECORDS).read(), as_of=AS_OF))

    assert result == [
        {
            "run_id": "r1",
            "pipeline": "ingest",
            "logical_run_id": LOGICAL,
            "run_date": "2026-08-27",
            # The first record ends at 07:00:00 after a 0.5 s step.
            "started_at": "2026-08-27T06:59:59.500000+00:00",
            "finished_at": "2026-08-27T07:00:02+00:00",
            "wall_clock_seconds": 1.1,  # the summary record's, not last - first
            "step_duration_seconds": 1.0,
            "step_count": 3,
            "failed_step_count": 0,
            "committed_step_count": 1,
            "warn_hit_count": 2,
            "status": "ok",
            "error_category": None,
            "attempt_number": 1,
            "is_latest_attempt": False,
            "as_of_utc": AS_OF,
        },
        {
            "run_id": "r2",
            "pipeline": "ingest",
            "logical_run_id": LOGICAL,
            "run_date": "2026-08-27",
            "started_at": "2026-08-27T07:00:03.100000+00:00",
            "finished_at": AS_OF,
            "wall_clock_seconds": 1.0,
            "step_duration_seconds": 0.9,
            "step_count": 1,
            "failed_step_count": 1,
            "committed_step_count": 0,
            "warn_hit_count": 0,
            "status": "error",
            "error_category": "data",
            "attempt_number": 2,
            "is_latest_attempt": True,
            "as_of_utc": AS_OF,
        },
    ]


def test_run_summary_without_a_summary_record_derives_wall_clock_and_status():
    # A run that died before its summary was written: the clock runs from the
    # first step's start to the last record, and an errored step makes the run
    # an error.
    records = [
        _record("r9", "read", at="2026-08-27T07:00:00+00:00", duration=0.5),
        _record("r9", "write", "error", at="2026-08-27T07:00:03+00:00", duration=0.1),
    ]
    [row] = _rows(metrics.run_summary(given_rows(records).read(), as_of=AS_OF))

    assert row["wall_clock_seconds"] == 3.5  # the read began 0.5 s before 07:00:00
    assert row["status"] == "error"
    assert row["attempt_number"] == 1 and row["is_latest_attempt"] is True


def test_run_summary_marks_a_run_with_no_summary_and_no_failure_incomplete():
    # Killed mid-run, or still running when the registry was read.
    records = [_record("r9", "read", at="2026-08-27T07:00:00+00:00", duration=0.5)]
    [row] = _rows(metrics.run_summary(given_rows(records).read(), as_of=AS_OF))

    assert row["status"] == "incomplete"


def test_run_summary_counts_a_warn_once_though_the_summary_repeats_it():
    # Builder pipelines copy every step's warns onto the run summary.
    records = [
        _record("r9", "validate", at="2026-08-27T07:00:00+00:00", warn_hits='["w"]'),
        _record("r9", "run", at="2026-08-27T07:00:01+00:00", warn_hits='["w"]'),
    ]
    [row] = _rows(metrics.run_summary(given_rows(records).read(), as_of=AS_OF))

    assert row["warn_hit_count"] == 1


def test_run_summary_dates_a_run_on_the_run_date_it_recorded():
    # A re-drive of 5 Jan run on 27 Aug is filed under 5 Jan, like its
    # logical run id.
    records = [
        _record(
            "r9",
            "run",
            at="2026-08-27T07:00:00+00:00",
            duration=1.0,
            logical_run_id="ingest:2026-01-05",
            run_date="2026-01-05",
        ),
    ]
    [row] = _rows(metrics.run_summary(given_rows(records).read(), as_of=AS_OF))

    assert row["run_date"] == "2026-01-05"


def test_run_summary_dates_a_run_on_the_local_date_it_started(monkeypatch):
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    records = [_record("r9", "run", at="2026-08-26T23:30:00+00:00", duration=1.0)]
    [row] = _rows(metrics.run_summary(given_rows(records).read(), as_of=AS_OF))

    assert row["run_date"] == "2026-08-27"


def test_run_summary_dates_a_run_on_when_it_started_not_when_it_ended(monkeypatch):
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    # Ends 00:10 local on the 27th, but began 23:50 local (22:50 UTC) on the 26th.
    records = [_record("r9", "run", at="2026-08-26T23:10:00+00:00", duration=1200.0)]
    [row] = _rows(metrics.run_summary(given_rows(records).read(), as_of=AS_OF))

    assert row["run_date"] == "2026-08-26"


def test_step_duration_trend_baselines_each_day_on_the_previous_days_p50s():
    def day(n: int, duration: float, run_id: str) -> dict[str, object]:
        return _record(
            run_id,
            "read",
            at=f"2026-08-{n:02d}T07:00:00+00:00",
            step_address="ingest.read",
            duration=duration,
            logical_run_id=f"ingest:2026-08-{n:02d}",
        )

    records = [
        day(20, 1.0, "a"),
        day(21, 2.0, "b"),
        day(22, 4.0, "c"),
        day(22, 6.0, "c2"),  # two executions on the 22nd: p50 is 5.0
        _record("a", "run", at="2026-08-20T07:00:01+00:00", duration=9.0),
    ]
    result = _rows(metrics.step_duration_trend(given_rows(records).read(), as_of=AS_OF))

    # The summary record is not a step and never appears.
    assert [r["step_address"] for r in result] == ["ingest.read"] * 3
    assert [r["execution_count"] for r in result] == [1, 1, 2]
    assert [r["duration_p50"] for r in result] == [1.0, 2.0, 5.0]
    assert [r["trailing_p50_median"] for r in result] == [None, 1.0, 1.5]
    assert [r["delta_seconds"] for r in result] == [None, 1.0, 3.5]
    assert [r["delta_ratio"] for r in result] == [None, 1.0, 2.333333]


def test_step_duration_trend_leaves_failed_executions_out():
    records = [
        _record("a", "read", at="2026-08-20T07:00:00+00:00", duration=10.0),
        _record("b", "read", "error", at="2026-08-20T08:00:00+00:00", duration=0.1),
    ]
    [row] = _rows(metrics.step_duration_trend(given_rows(records).read(), as_of=AS_OF))

    assert row["execution_count"] == 1
    assert row["duration_p50"] == 10.0


def test_step_duration_trend_looks_back_over_a_bounded_number_of_days():
    records = [
        _record(
            f"r{n}",
            "read",
            at=f"2026-08-{n:02d}T07:00:00+00:00",
            step_address="ingest.read",
            duration=float(n),
        )
        for n in range(1, 6)
    ]
    result = _rows(
        metrics.step_duration_trend(
            given_rows(records).read(), as_of=AS_OF, trailing_days=2
        )
    )

    # Day 5's baseline is the median of days 3 and 4 only.
    assert result[-1]["trailing_p50_median"] == 3.5


def test_a_re_drive_is_filed_on_its_business_date_but_timed_on_its_execution_date(
    monkeypatch,
):
    # 5 Jan ran on 5 Jan; an operator re-drove it at 00:30 local on 27 Aug
    # (23:30 UTC on the 26th, at UTC+1), and its summary recorded 5 Jan.
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    jan = "ingest:2026-01-05"

    def run(run_id: str, at: str, duration: float) -> list[dict[str, object]]:
        return [
            _record(
                run_id,
                "read",
                at=at,
                step_address="ingest.read",
                rows_out=5,
                duration=duration,
                logical_run_id=jan,
            ),
            _record(
                run_id,
                "run",
                at=at,
                duration=duration,
                logical_run_id=jan,
                run_date="2026-01-05",
            ),
        ]

    records = given_rows(
        run("original", "2026-01-05T07:00:00+00:00", 2.0)
        + run("redrive", "2026-08-26T23:30:00+00:00", 10.0)
    )

    # The summary and the row flow file the re-drive under the business date,
    # beside the attempt it replaces.
    summary = _rows(metrics.run_summary(records.read(), as_of=AS_OF))
    assert [(r["run_id"], r["run_date"], r["attempt_number"]) for r in summary] == [
        ("original", "2026-01-05", 1),
        ("redrive", "2026-01-05", 2),
    ]
    flow = _rows(metrics.step_row_flow(records.read(), as_of=AS_OF))
    assert [(r["run_id"], r["run_date"]) for r in flow] == [
        ("original", "2026-01-05"),
        ("redrive", "2026-01-05"),
    ]

    # The trend times it on the local day it executed: January's row keeps
    # only January's execution, and the re-drive appears on 27 Aug.
    trend = _rows(metrics.step_duration_trend(records.read(), as_of=AS_OF))
    assert [
        (r["run_date"], r["execution_count"], r["duration_p50"]) for r in trend
    ] == [
        ("2026-01-05", 1, 2.0),
        ("2026-08-27", 1, 10.0),
    ]


def test_step_row_flow_keeps_unreported_counts_null_and_ratios_against_rows_in():
    result = _rows(metrics.step_row_flow(given_rows(RECORDS).read(), as_of=AS_OF))

    assert [
        (
            r["run_id"],
            r["step_address"],
            r["rows_in"],
            r["rows_out"],
            r["rows_quarantined"],
            r["out_ratio"],
            r["quarantine_ratio"],
        )
        for r in result
    ] == [
        ("r1", "ingest.read", None, 100.0, None, None, None),
        ("r1", "ingest.validate", 100.0, 90.0, 10.0, 0.9, 0.1),
        ("r1", "ingest.write", 90.0, 90.0, None, 1.0, None),
    ]
    # r2's read reported no counts at all, so it is not a funnel row.
    assert {r["run_id"] for r in result} == {"r1"}


def test_step_row_flow_sums_a_step_executed_twice_in_one_run():
    records = [
        _record(
            "r1",
            "load",
            at="2026-08-27T07:00:00+00:00",
            step_address="ingest.load",
            rows_in=10,
            rows_out=8,
        ),
        _record(
            "r1",
            "load",
            at="2026-08-27T07:00:01+00:00",
            step_address="ingest.load",
            rows_in=10,
            rows_out=6,
        ),
    ]
    [row] = _rows(metrics.step_row_flow(given_rows(records).read(), as_of=AS_OF))

    assert (
        row["execution_count"],
        row["rows_in"],
        row["rows_out"],
        row["out_ratio"],
    ) == (2, 20.0, 14.0, 0.7)


def test_a_record_predating_step_address_derives_it_from_pipeline_and_step():
    records = [_record("r1", "read", at="2026-08-27T07:00:00+00:00", rows_out=5)]
    [row] = _rows(metrics.step_row_flow(given_rows(records).read(), as_of=AS_OF))

    assert row["step_address"] == "ingest.read"


# --- end to end -------------------------------------------------------------


@pytest.fixture
def base_dir(tmp_path):
    return build_databases(tmp_path, "pipeline_run_metric/gold")


def test_main_reads_the_caught_up_registry_and_refreshes_every_table(base_dir):
    # A run log nothing has ingested yet: the pipeline catches the registry up
    # before it reads, so the records are visible on the very first run.
    log = RunLog(base_dir / "_runs" / "ingest.log")
    log.record(
        "r1",
        "ingest",
        "read",
        "ok",
        logical_run_id=LOGICAL,
        rows_out=100,
        duration=0.5,
        step_address="ingest.read",
    )
    log.record(
        "r1",
        "ingest",
        "write",
        "ok",
        logical_run_id=LOGICAL,
        rows_in=100,
        rows_out=100,
        duration=0.3,
        committed=True,
        step_address="ingest.write",
    )
    log.record("r1", "ingest", "run", "ok", logical_run_id=LOGICAL, duration=1.0)

    assert main(["prog", "--base-dir", str(base_dir)]) == 0

    gold = medallion(StoreRegistry(base_dir), "pipeline_run_metric").gold
    for table, contract in GOLD_TABLES:
        rows = read_rows(gold, table)
        assert rows, table
        for row in rows:
            assert row.pop(RUN_PROVENANCE_COLUMN)
            assert set(row) == set(contract.__dataclass_fields__), table

    [summary] = read_rows(gold, "pipeline_run_summary")
    assert (summary["run_id"], summary["status"], summary["step_count"]) == (
        "r1",
        "ok",
        2,
    )

    # The reporting run's own records are ingested after it returns: a second
    # run sees the first reporting run as a run, and still never itself.
    assert main(["prog", "--base-dir", str(base_dir)]) == 0
    pipelines = {r["pipeline"] for r in read_rows(gold, "pipeline_run_summary")}
    assert pipelines == {"ingest", "pipeline_run_metric"}
    assert len(read_rows(gold, "pipeline_run_summary")) == 2


def test_main_on_a_base_dir_nothing_has_run_in_lands_empty_tables(base_dir):
    assert main(["prog", "--base-dir", str(base_dir)]) == 0

    gold = medallion(StoreRegistry(base_dir), "pipeline_run_metric").gold
    for table, _ in GOLD_TABLES:
        assert read_rows(gold, table) == []


def test_main_reads_a_registry_older_than_run_date_whose_logs_are_gone(base_dir):
    # A registry written before ``run_date`` joined the record, with ``_runs/``
    # emptied by rotation: no ingest opens it, so the read itself must still
    # find the column rather than fail the first run and heal on the second.
    registry_path = RunStore(base_dir).registry_path
    registry_path.parent.mkdir(parents=True)
    older = [f for f in RUN_RECORD_COLUMNS if f.name != "run_date"]
    with sqlite3.connect(registry_path) as con:
        con.execute(create_table_sql("run_records", older, RUN_RECORD_PRIMARY_KEY))
        con.execute(
            "INSERT INTO run_records (timestamp, pipeline_run_id, pipeline, step, "
            "step_ordinal, status, duration) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("2026-08-27T07:00:00+00:00", "r1", "ingest", "run", 0, "ok", 1.0),
        )
    con.close()

    assert main(["prog", "--base-dir", str(base_dir)]) == 0

    gold = medallion(StoreRegistry(base_dir), "pipeline_run_metric").gold
    [summary] = read_rows(gold, "pipeline_run_summary")
    assert (summary["run_id"], summary["run_date"]) == ("r1", "2026-08-27")


def test_main_writes_no_table_when_a_later_table_fails_to_build(base_dir, monkeypatch):
    log = RunLog(base_dir / "_runs" / "ingest.log")
    log.record("r1", "ingest", "run", "ok", logical_run_id=LOGICAL, duration=1.0)

    def broken(records, *, as_of):
        raise ValueError("row flow broke")

    monkeypatch.setattr(metrics, "step_row_flow", broken)
    with pytest.raises(ValueError):
        main(["prog", "--base-dir", str(base_dir)])

    # The summary built fine but was never written: the tables move together.
    gold = medallion(StoreRegistry(base_dir), "pipeline_run_metric").gold
    assert read_rows(gold, "pipeline_run_summary") == []
