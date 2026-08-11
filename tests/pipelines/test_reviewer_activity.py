"""Tests for the Sync-to-reviewer-activity gold aggregate."""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import Refresh
from framework.run import FreshnessRequirement, RunContext
from pipelines.reviewer_activity.gold import (
    aggregate_reviewer_activity,
    normalize_reviewer_account,
    reviewer_activity_daily_builder,
)
from pipelines.reviewer_activity.pipeline import UPSTREAMS, main, run
from pipelines.sharepoint_cases.schema import FEED_NAME as SYNC_SUBJECT
from tests.framework_testing import RecordingWriter, given_rows, read_rows, rows_of
from tools.medallion import medallion
from tools.observability import timestamps
from tools.observability.run_log import RunLog
from tools.store import StoreRegistry

AS_OF = "2026-08-10T06:00:00+00:00"


def _case(
    *,
    reviewer: str | None = r"i:0#.w|CONTEXT\A.KHAN",
    case_type: str | None = "claims",
    status: str = "Completed",
    reportable_at: str | None = "2026-08-09T23:30:00+00:00",
    as_of_utc: str = AS_OF,
) -> dict[str, object]:
    return {
        "assigned_reviewer_name": reviewer,
        "case_type": case_type,
        "status": status,
        "reportable_at": reportable_at,
        "as_of_utc": as_of_utc,
    }


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (r"i:0#.w|CONTEXT\A.KHAN", "a.khan"),
        (r"CONTEXT\A.KHAN", "a.khan"),
        ("A.KHAN", "a.khan"),
        ("  ", None),
        (None, None),
    ],
)
def test_normalize_reviewer_account_returns_the_lower_cased_bare_account(
    value, expected
):
    assert normalize_reviewer_account(value) == expected


def test_aggregate_uses_the_local_calendar_date_and_is_sparse(monkeypatch):
    monkeypatch.setattr(
        timestamps,
        "local_timezone",
        lambda: dt.timezone(dt.timedelta(hours=1)),
    )
    rows = [
        _case(),
        _case(),
        _case(
            reviewer=r"i:0#.w|CONTEXT\B.JONES",
            case_type="onboarding",
            reportable_at="2026-08-10T12:00:00+00:00",
        ),
        _case(status="Void"),
        _case(reviewer=""),
        _case(reportable_at=None),
        _case(case_type=""),
    ]

    result = aggregate_reviewer_activity(given_rows(rows).read())
    frame = result.to_pandas()

    assert frame.to_dict(orient="records") == [
        {
            "reviewer_account": "a.khan",
            "reportable_date": pd.Timestamp("2026-08-10"),
            "case_type": "claims",
            "count": 2,
            "as_of_utc": AS_OF,
        },
        {
            "reviewer_account": "b.jones",
            "reportable_date": pd.Timestamp("2026-08-10"),
            "case_type": "onboarding",
            "count": 1,
            "as_of_utc": AS_OF,
        },
    ]


def test_gold_builder_validates_its_aggregate_contract_before_writing():
    writer = RecordingWriter()

    reviewer_activity_daily_builder(given_rows([_case()]), writer).run()

    [row] = rows_of(writer)
    assert row["reviewer_account"] == "a.khan"
    assert row["reportable_date"] == dt.date(2026, 8, 9)
    assert row["count"] == 1
    assert row["as_of_utc"] == AS_OF


def test_main_reads_sync_gold_and_refreshes_the_reporting_subject(tmp_path):
    registry = StoreRegistry(tmp_path)
    sync = medallion(registry, SYNC_SUBJECT)
    reporting = medallion(registry, "reviewer_activity")
    gold_rows = [_case()]
    silver_rows = [_case(reviewer=r"i:0#.w|CONTEXT\SILVER")]

    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(gold_rows))
    )
    sync.silver.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(silver_rows))
    )

    assert main(["prog", "--base-dir", str(tmp_path)]) == 0

    assert read_rows(reporting.gold, "reviewer_activity_daily") == [
        {
            "reviewer_account": "a.khan",
            "reportable_date": "2026-08-09",
            "case_type": "claims",
            "count": 1,
            "as_of_utc": AS_OF,
        }
    ]

    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case(reviewer=r"CONTEXT\NEW")]))
    )
    assert main(["prog", "--base-dir", str(tmp_path)]) == 0

    rows = read_rows(reporting.gold, "reviewer_activity_daily")
    assert [row["reviewer_account"] for row in rows] == ["new"]


def test_reviewer_activity_declares_sync_as_a_freshness_upstream():
    assert len(UPSTREAMS) == 1
    requirement = UPSTREAMS[0]
    assert isinstance(requirement, FreshnessRequirement)
    assert requirement.upstream_pipeline == "sharepoint_cases"


def test_main_blocks_stale_sync_without_replacing_existing_publication(
    tmp_path, monkeypatch, capsys
):
    registry = StoreRegistry(tmp_path)
    sync = medallion(registry, SYNC_SUBJECT)
    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case()]))
    )

    assert main(["prog", "--base-dir", str(tmp_path)]) == 0

    gold_path = tmp_path / "reviewer_activity" / "gold.db"
    report_files = {
        path.relative_to(tmp_path): path.read_bytes()
        for path in (tmp_path / "deliverables").rglob("*")
        if path.is_file()
    }
    assert report_files
    gold_before = gold_path.read_bytes()

    monkeypatch.setattr(
        "tools.observability.run_log.utc_now_iso",
        lambda: "2026-08-01T00:00:00+00:00",
    )
    RunLog(tmp_path / "_runs" / "sharepoint_cases.log").record(
        "stale-sync", "sharepoint_cases", "run", "ok"
    )

    assert main(["prog", "--base-dir", str(tmp_path)]) == 1

    assert "upstream sharepoint_cases is stale" in capsys.readouterr().err
    assert gold_path.read_bytes() == gold_before
    assert {
        path.relative_to(tmp_path): path.read_bytes()
        for path in (tmp_path / "deliverables").rglob("*")
        if path.is_file()
    } == report_files


def test_dry_run_stops_before_reading_uncommitted_reviewer_activity_gold(tmp_path):
    registry = StoreRegistry(tmp_path)
    sync = medallion(registry, SYNC_SUBJECT)
    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case()]))
    )

    result = run(RunContext(base_dir=tmp_path, dry_run=True))

    assert len(result) == 1
    assert not (tmp_path / "reviewer_activity" / "gold.db").exists()
    assert not (tmp_path / "deliverables").exists()
