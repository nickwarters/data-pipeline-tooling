"""Tests for the Sync-to-reviewer-activity gold aggregate."""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import Refresh
from framework.run import RunContext
from pipelines.reviewer_activity.gold import (
    aggregate_reviewer_activity,
    normalize_reviewer_account,
    reviewer_activity_daily_builder,
)
from pipelines.reviewer_activity.pipeline import run
from tests.framework_testing import RecordingWriter, given_rows, read_rows, rows_of
from tools.medallion import medallion
from tools.observability import timestamps
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


def test_conflicting_sync_snapshot_stamps_are_refused():
    rows = [_case(), _case(as_of_utc="2026-08-10T07:00:00+00:00")]

    with pytest.raises(ValueError, match="conflicting as_of_utc"):
        aggregate_reviewer_activity(given_rows(rows).read())


def test_non_empty_sync_snapshot_requires_an_as_of_stamp():
    with pytest.raises(ValueError, match="no usable as_of_utc"):
        aggregate_reviewer_activity(given_rows([_case(as_of_utc=None)]).read())


def test_gold_builder_validates_its_aggregate_contract_before_writing():
    writer = RecordingWriter()

    reviewer_activity_daily_builder(given_rows([_case()]), writer).run()

    [row] = rows_of(writer)
    assert row["reviewer_account"] == "a.khan"
    assert row["count"] == 1
    assert row["as_of_utc"] == AS_OF


def test_run_reads_sync_gold_and_refreshes_the_reporting_subject(tmp_path):
    registry = StoreRegistry(tmp_path)
    sync = medallion(registry, "cora_cases")
    reporting = medallion(registry, "reviewer_activity")
    gold_rows = [_case()]
    silver_rows = [_case(reviewer=r"i:0#.w|CONTEXT\SILVER")]

    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(gold_rows))
    )
    sync.silver.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(silver_rows))
    )

    run(RunContext(base_dir=tmp_path))

    assert read_rows(reporting.gold, "reviewer_activity_daily") == [
        {
            "reviewer_account": "a.khan",
            "reportable_date": "2026-08-09 00:00:00",
            "case_type": "claims",
            "count": 1,
            "as_of_utc": AS_OF,
        }
    ]

    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case(reviewer=r"CONTEXT\NEW")]))
    )
    run(RunContext(base_dir=tmp_path))

    rows = read_rows(reporting.gold, "reviewer_activity_daily")
    assert [row["reviewer_account"] for row in rows] == ["new"]
