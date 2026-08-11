"""Tests for the reviewer activity Report Feed publication."""

from __future__ import annotations

import datetime as dt
import json

import pytest

from framework.core import ValidationError
from framework.io import Refresh
from framework.run import RunContext
from pipelines.reviewer_activity import pipeline as reviewer_pipeline
from pipelines.reviewer_activity import report_feed
from pipelines.reviewer_activity.pipeline import publish_report_feeds
from pipelines.reviewer_activity.report_feed import (
    ReportFeedWriter,
    prepare_report_feed_rows,
    reviewer_report_feed_builder,
)
from tests.framework_testing import given_rows, make_dataset
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
    writer.write(prepare_report_feed_rows(source, writer=writer))


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
    assert payload["complete_through"] == "2026-08-01"
    assert payload["rows"] == [
        {"date": "2025-08-01", "case_type": "claims", "count": 1},
        {"date": "2026-08-01", "case_type": "claims", "count": 1},
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

    _write_prepared(writer, [_row("A.KHAN", "2026-08-01", count=1)])
    _write_prepared(writer, [_row("A.KHAN", "2026-08-01", count=4)])

    assert json.loads(_path(tmp_path, "a.khan").read_text())["rows"][0]["count"] == 4
    assert stale.read_text(encoding="utf-8") == "old"


@pytest.mark.parametrize("account", ["../escape", "CON", "con.txt", "COM1.csv"])
def test_writer_rejects_unsafe_reviewer_account(tmp_path, account):
    writer = ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00")

    with pytest.raises(ValidationError, match="unsafe reviewer account"):
        _write_prepared(writer, [_row(account, "2026-08-01")])


def test_writer_stages_all_files_before_replacing_any(tmp_path, monkeypatch):
    writer = ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00")
    _write_prepared(
        writer,
        [_row("a.khan", "2026-08-01"), _row("b.jones", "2026-08-01")],
    )
    before = {
        account: _path(tmp_path, account).read_text(encoding="utf-8")
        for account in ("a.khan", "b.jones")
    }
    original_replace = report_feed.os.replace
    calls = 0

    def fail_on_second_replace(source, target):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("injected replacement failure")
        return original_replace(source, target)

    monkeypatch.setattr(report_feed.os, "replace", fail_on_second_replace)
    with pytest.raises(OSError, match="injected replacement failure"):
        _write_prepared(
            writer,
            [
                _row("a.khan", "2026-08-01", count=2),
                _row("b.jones", "2026-08-01", count=3),
            ],
        )

    assert {
        account: _path(tmp_path, account).read_text(encoding="utf-8")
        for account in ("a.khan", "b.jones")
    } == before
    assert not list(_path(tmp_path, "a.khan").parent.glob("*.tmp"))
    assert not list(_path(tmp_path, "a.khan").parent.glob("*.bak"))


def test_pipeline_rejects_malformed_committed_gold_before_writer(tmp_path):
    writer = ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00")
    pipeline = reviewer_report_feed_builder(
        given_rows([_row("a.khan", "2026-08-01", count="not-an-int")]), writer
    )

    with pytest.raises(ValidationError, match="invalid count"):
        pipeline.run()


def test_publication_reads_committed_gold_and_has_one_writer(tmp_path):
    registry = StoreRegistry(tmp_path)
    output = medallion(registry, "reviewer_activity")
    output.gold.writer("reviewer_activity_daily", Refresh()).write(
        make_dataset([_row("A.KHAN", "2026-08-01")])
    )

    result = publish_report_feeds(RunContext(base_dir=tmp_path))

    assert len(result) == 1
    assert (
        reviewer_report_feed_builder(
            given_rows([_row("a.khan", "2026-08-01")]),
            ReportFeedWriter(tmp_path, generated_at="2026-08-01T12:00:00+00:00"),
        )
        .describe()
        .count("write")
        == 1
    )


def test_publish_only_retries_from_committed_gold_without_recomputing(
    tmp_path, monkeypatch
):
    registry = StoreRegistry(tmp_path)
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
        RunContext(base_dir=tmp_path, params={"publish_only": "true"})
    )

    assert _path(tmp_path, "a.khan").exists()
