"""Tests for the reviewer activity Report Feed publication."""

from __future__ import annotations

import datetime as dt
import json

import pytest

from framework.core import ValidationError
from framework.io import Refresh
from framework.run import RunContext
from framework.transform import CoercionError
from pipelines.reviewer_activity import pipeline as reviewer_pipeline
from pipelines.reviewer_activity import report_feed
from pipelines.reviewer_activity.pipeline import publish_report_feeds
from pipelines.reviewer_activity.report_feed import (
    ReportFeedWriter,
    reviewer_report_feed_builder,
)
from tests.framework_testing import build_databases, given_rows, make_dataset
from tools.deliverables import get_deliverable_path
from tools.medallion import medallion
from tools.observability import timestamps
from tools.store import StoreRegistry

AS_OF = "2026-08-01T00:30:00+00:00"


def _row(
    account: str,
    reportable_date: str,
    case_type: str = "claims",
    count: int = 1,
) -> dict[str, object]:
    return {
        "reviewer_account": account,
        "reportable_date": reportable_date,
        "case_type": case_type,
        "count": count,
        "as_of_utc": AS_OF,
    }


def _path(tmp_path, account: str):
    return get_deliverable_path(
        tmp_path, "cora_report_feeds", "my-stats", f"{account}.txt"
    )


def _write_prepared(writer, rows):
    source = given_rows(rows).read()
    writer.write(report_feed._prepare_report_rows(source))


def test_writer_emits_exact_sparse_envelopes_and_inclusive_window(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        timestamps,
        "local_timezone",
        lambda: dt.timezone(dt.timedelta(hours=1)),
    )
    rows = [
        _row("A.KHAN", "2025-08-01"),
        _row("A.KHAN", "2025-07-31"),
        _row("A.KHAN", "2026-08-01"),
        _row("A.KHAN", "2026-08-02"),
        _row("B.JONES", "2024-01-01"),
    ]
    writer = ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00")

    _write_prepared(writer, rows)

    payload = json.loads(_path(tmp_path, "a.khan").read_text(encoding="utf-8"))
    assert list(payload) == [
        "schema_version",
        "reviewer_account",
        "generated_at",
        "complete_through",
        "rows",
    ]
    assert payload["schema_version"] == 1
    assert payload["reviewer_account"] == "a.khan"
    assert payload["generated_at"] == "2026-08-01T12:00:00+00:00"
    assert payload["complete_through"] == "2026-07-31"
    assert payload["rows"] == [
        {"date": "2025-07-31", "case_type": "claims", "count": 1},
        {"date": "2025-08-01", "case_type": "claims", "count": 1},
    ]
    assert json.loads(_path(tmp_path, "b.jones").read_text())["rows"] == []
    assert {location["name"] for location in writer.data_locations} == {
        str(_path(tmp_path, "a.khan")),
        str(_path(tmp_path, "b.jones")),
    }


def test_writer_replaces_files_and_keeps_stale_reviewers(tmp_path):
    stale = _path(tmp_path, "stale")
    stale.parent.mkdir(parents=True)
    stale.write_text("old", encoding="utf-8")
    writer = ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00")

    _write_prepared(writer, [_row("A.KHAN", "2026-07-31", count=1)])
    _write_prepared(writer, [_row("A.KHAN", "2026-07-31", count=4)])

    assert json.loads(_path(tmp_path, "a.khan").read_text())["rows"][0]["count"] == 4
    assert stale.read_text(encoding="utf-8") == "old"


@pytest.mark.parametrize("account", ["../escape", "CON", "con.txt", "COM1.csv"])
def test_writer_rejects_unsafe_reviewer_account(tmp_path, account):
    writer = ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00")

    with pytest.raises(ValidationError, match="unsafe reviewer account"):
        _write_prepared(writer, [_row(account, "2026-08-01")])


def test_pipeline_rejects_malformed_committed_gold_before_writer(tmp_path):
    # Committed gold whose count is not a number is caught at the coerce step,
    # before the validator ever sees the column — and the abort names the value
    # that broke it rather than just the dtype the column ended up with.
    writer = ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00")
    pipeline = reviewer_report_feed_builder(
        given_rows([_row("a.khan", "2026-08-01", count="not-an-int")]), writer
    )

    with pytest.raises(CoercionError, match="not parseable as int"):
        pipeline.run()


@pytest.fixture
def base_dir(tmp_path):
    """A base directory with ``reviewer_activity``'s gold built from its baseline.

    These tests seed the subject's own committed gold and publish from it, so
    they have to write into the table its baseline declares — the same table the
    aggregate hop writes in production. Gold is all they touch, so gold is all
    they build.
    """
    return build_databases(tmp_path, "reviewer_activity/gold")


def test_publication_reads_committed_gold_and_has_one_writer(base_dir):
    registry = StoreRegistry(base_dir)
    output = medallion(registry, "reviewer_activity")
    output.gold.writer("reviewer_activity_daily", Refresh()).write(
        make_dataset([_row("A.KHAN", "2026-08-01")])
    )

    result = publish_report_feeds(RunContext(base_dir=base_dir))

    assert len(result) == 1
    description = reviewer_report_feed_builder(
        given_rows([_row("a.khan", "2026-08-01")]),
        ReportFeedWriter(base_dir, generated_at="2026-08-01T12:00:00+00:00"),
    ).describe()
    assert description.count("[Write]") == 1


def test_publish_only_retries_from_committed_gold_without_recomputing(
    base_dir, monkeypatch
):
    registry = StoreRegistry(base_dir)
    output = medallion(registry, "reviewer_activity")
    output.gold.writer("reviewer_activity_daily", Refresh()).write(
        make_dataset([_row("A.KHAN", "2026-08-01")])
    )

    def fail_if_recomputed(*args, **kwargs):
        raise AssertionError("aggregate must not be rebuilt")

    monkeypatch.setattr(
        reviewer_pipeline,
        "build_reviewer_activity_daily_pipeline",
        fail_if_recomputed,
    )

    reviewer_pipeline.run(
        RunContext(base_dir=base_dir, params={"publish_only": "true"})
    )

    assert _path(base_dir, "a.khan").exists()
