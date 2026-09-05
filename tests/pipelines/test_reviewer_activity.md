```python
"""Tests for the Sync-to-reviewer-activity gold aggregate."""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from framework.core import RUN_PROVENANCE_COLUMN, Dataset
from framework.io import Refresh
from framework.run import FreshnessRequirement, RunContext
from pipelines.reviewer_activity.gold import (
    UNKNOWN_BRAND,
    aggregate_reviewer_activity,
    normalize_reviewer_account,
    reviewer_activity_daily_builder,
)
from pipelines.reviewer_activity.pipeline import UPSTREAMS, main, run
from pipelines.sharepoint_cases.schema import FEED_NAME as SYNC_SUBJECT
from tests.framework_testing import (
    RecordingWriter,
    build_databases,
    given_rows,
    read_rows,
    rows_of,
)
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
            "brand": UNKNOWN_BRAND,
            "count": 2,
            "as_of_utc": AS_OF,
        },
        {
            "reviewer_account": "b.jones",
            "reportable_date": pd.Timestamp("2026-08-10"),
            "case_type": "onboarding",
            "brand": UNKNOWN_BRAND,
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


@pytest.fixture
def base_dir(tmp_path):
    """A base directory with both subjects this pipeline touches migrated.

    ``reviewer_activity`` writes its own gold and reads Sync's, and both are
    under migration control — so a test seeding Sync gold as a fixture has to
    seed it into the table Sync's baseline declares, exactly as the real feed
    writes it.

    Both ends are named database by database rather than subject by subject:
    gold is the only one either side touches here, and building Sync whole
    would build its raw, silver and quarantine for nothing.
    """
    return build_databases(tmp_path, f"{SYNC_SUBJECT}/gold", "reviewer_activity/gold")


def test_main_reads_sync_gold_and_refreshes_the_reporting_subject(base_dir):
    registry = StoreRegistry(base_dir)
    sync = medallion(registry, SYNC_SUBJECT)
    reporting = medallion(registry, "reviewer_activity")

    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case()]))
    )
    # Sync silver has no case_current; assert the aggregate reads migrated gold.
    assert sync.silver.columns_of("case_current").columns() is None

    assert main(["prog", "--base-dir", str(base_dir)]) == 0

    # The published row, minus the reserved provenance column every table-backed
    # Writer stamps: the run that wrote it is asserted separately, because its
    # value is a fresh id per run and is not part of the aggregate's contract.
    [published] = read_rows(reporting.gold, "reviewer_activity_daily")
    assert published.pop(RUN_PROVENANCE_COLUMN)
    assert published == {
        "reviewer_account": "a.khan",
        "reportable_date": "2026-08-09",
        "case_type": "claims",
        "brand": UNKNOWN_BRAND,
        "count": 1,
        "as_of_utc": AS_OF,
    }

    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case(reviewer=r"CONTEXT\NEW")]))
    )
    assert main(["prog", "--base-dir", str(base_dir)]) == 0

    rows = read_rows(reporting.gold, "reviewer_activity_daily")
    assert [row["reviewer_account"] for row in rows] == ["new"]


def test_reviewer_activity_declares_sync_as_a_freshness_upstream():
    assert len(UPSTREAMS) == 1
    requirement = UPSTREAMS[0]
    assert isinstance(requirement, FreshnessRequirement)
    assert requirement.upstream_pipeline == "sharepoint_cases"


def test_main_blocks_stale_sync_without_replacing_existing_publication(
    base_dir, monkeypatch, capsys
):
    registry = StoreRegistry(base_dir)
    sync = medallion(registry, SYNC_SUBJECT)
    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case()]))
    )

    assert main(["prog", "--base-dir", str(base_dir)]) == 0

    gold_path = base_dir / "reviewer_activity" / "gold.db"
    report_files = {
        path.relative_to(base_dir): path.read_bytes()
        for path in (base_dir / "deliverables").rglob("*")
        if path.is_file()
    }
    assert report_files
    gold_before = gold_path.read_bytes()

    monkeypatch.setattr(
        "tools.observability.run_log.utc_now_iso",
        lambda: "2026-08-01T00:00:00+00:00",
    )
    RunLog(base_dir / "_runs" / "sharepoint_cases.log").record(
        "stale-sync", "sharepoint_cases", "run", "ok"
    )

    assert main(["prog", "--base-dir", str(base_dir)]) == 1

    assert "upstream sharepoint_cases is stale" in capsys.readouterr().err
    assert gold_path.read_bytes() == gold_before
    assert {
        path.relative_to(base_dir): path.read_bytes()
        for path in (base_dir / "deliverables").rglob("*")
        if path.is_file()
    } == report_files


def test_dry_run_stops_before_reading_uncommitted_reviewer_activity_gold(base_dir):
    registry = StoreRegistry(base_dir)
    sync = medallion(registry, SYNC_SUBJECT)
    reporting = medallion(registry, "reviewer_activity")
    sync.gold.writer("case_current", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame([_case()]))
    )

    result = run(RunContext(base_dir=base_dir, dry_run=True))

    assert len(result) == 1
    # The aggregate table exists before the run — its migration created it — so
    # "wrote nothing" is that it is still empty rather than still absent.
    assert read_rows(reporting.gold, "reviewer_activity_daily") == []
    assert not (base_dir / "deliverables").exists()

```
