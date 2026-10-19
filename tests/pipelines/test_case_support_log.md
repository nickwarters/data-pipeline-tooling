```python
"""The ``case_support_log`` feed, end to end under a migrated ``tmp_path``."""

from __future__ import annotations

import datetime as dt
import json
import sqlite3

import pandas as pd
import pytest

from framework.core import ErrorCategory
from framework.run import RunContext, active_context, dry_run_pipeline
from pipelines.case_support_log.pipeline import (
    SAFETY_LAG,
    LocalJsonListClient,
    NoClientError,
    main,
)
from pipelines.case_support_log.pipeline import run as _run
from pipelines.case_support_log.schema import FEED_NAME, LIST_ID, SITE
from tests.framework_testing import build_databases, read_rows
from tools.integrations.sharepoint_rest import SharePointFeedError, SharePointSource
from tools.medallion import medallion
from tools.source_checkpoint import SourceCheckpointStore
from tools.store import StoreRegistry

SERVER_NOW = dt.datetime(2026, 10, 5, 9, tzinfo=dt.timezone.utc)
SOURCE = SharePointSource(SITE, LIST_ID)


class FakeListClient:
    """Replays frames in call order, with a clock that moves on after each read."""

    def __init__(self, *frames: pd.DataFrame, advance=dt.timedelta(minutes=10)):
        self._frames = list(frames)
        self._now = SERVER_NOW
        self._advance = advance
        self.calls = 0

    def fetch_items(self, list_name, expand_fields, select_fields, filters):
        self.calls += 1
        return self._frames[min(self.calls, len(self._frames)) - 1].copy()

    def server_time(self) -> dt.datetime:
        now, self._now = self._now, self._now + self._advance
        return now


def entry(**overrides: object) -> dict[str, object]:
    """One list item as a ``$select=*`` read with Author expanded returns it."""
    row: dict[str, object] = {
        "Id": 1,
        "Modified": "2026-10-01T09:15:00Z",
        "odata.etag": '"1"',
        "Title": "CMP-000101",
        "CaseType": "complaints",
        "CaseId": "101",
        "SupportAction": "reassign",
        "Reason": "Reviewer on leave.",
        "Changes": json.dumps(
            [{"field": "assignedReviewer", "before": "a", "after": "b"}]
        ),
        "Outcome": "recorded",
        "RelatesTo": "",
        "Created": "2026-10-01T09:15:00Z",
        "Author": {"Name": "i:0#.w|CONTOSO\\r.maintainer", "Title": "Robin Maintainer"},
    }
    row.update(overrides)
    return row


def entries(*rows: dict[str, object]) -> pd.DataFrame:
    return pd.DataFrame(list(rows))


def run(context: RunContext, **kwargs):
    """Drive the feed with ``context`` ambient, as ``run_pipeline`` does."""
    with active_context(context):
        return _run(context, **kwargs)


def silver(base_dir) -> list[dict]:
    return read_rows(
        medallion(StoreRegistry(base_dir), FEED_NAME).silver, "support_log_entry"
    )


def quarantined(base_dir) -> list[dict]:
    path = base_dir / FEED_NAME / "quarantine.db"
    with sqlite3.connect(path) as con:
        con.row_factory = sqlite3.Row
        return [dict(r) for r in con.execute("SELECT * FROM support_log_entry")]


@pytest.fixture
def base_dir(tmp_path):
    """A base directory with this feed's migrations applied."""
    return build_databases(tmp_path, FEED_NAME)


def test_the_bundled_sample_lands_every_entry_in_raw_and_silver(base_dir, capsys):
    sample = LocalJsonListClient().fetch_items("CaseSupportLog", (), (), ())

    poll = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=LocalJsonListClient()
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert [r["source_item_id"] for r in read_rows(med.raw, "support_log_entry")] == [
        str(i) for i in sample["Id"]
    ]
    assert (poll.raw_rows, poll.silver_rows) == (len(sample), len(sample))
    assert {r["outcome"] for r in silver(base_dir)} == {"recorded", "not-applied"}

    assert main(["prog", "--base-dir", str(base_dir / "via-cli"), "--sample"]) == 0
    assert f"{poll.silver_rows} support log entr(ies)" in capsys.readouterr().out


def test_silver_names_the_reference_flattens_the_author_and_nulls_a_blank_relates_to(
    base_dir,
):
    client = FakeListClient(
        entries(
            entry(),
            entry(Id=2, Outcome="not-applied", RelatesTo="1", Changes="[]"),
        )
    )

    run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=client)

    first, second = sorted(silver(base_dir), key=lambda r: r["id"])
    assert first["case_reference"] == "CMP-000101"
    assert (first["author_name"], first["author_title"]) == (
        "i:0#.w|CONTOSO\\r.maintainer",
        "Robin Maintainer",
    )
    assert json.loads(first["changes"])[0]["field"] == "assignedReviewer"
    assert pd.isna(first["relates_to"])
    assert (second["outcome"], second["relates_to"]) == ("not-applied", "1")


def test_an_outcome_the_platform_never_writes_is_quarantined_and_the_rest_still_land(
    base_dir,
):
    client = FakeListClient(entries(entry(), entry(Id=2, Outcome="edited by hand")))

    poll = run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=client)

    assert (poll.raw_rows, poll.silver_rows) == (2, 1)
    assert [r["id"] for r in silver(base_dir)] == [1]
    assert [r["outcome"] for r in quarantined(base_dir)] == ["edited by hand"]


def test_a_re_read_entry_lands_once_and_the_watermark_advances(base_dir):
    client = FakeListClient(entries(entry()), entries(entry(), entry(Id=2)))
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    assert sorted(r["id"] for r in silver(base_dir)) == [1, 2]
    expected = SERVER_NOW + dt.timedelta(minutes=10) - SAFETY_LAG
    assert SourceCheckpointStore(base_dir).watermark(SOURCE.key) == expected


def test_a_quiet_window_lands_nothing_and_still_advances(base_dir):
    poll = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=FakeListClient(pd.DataFrame()),
    )

    assert (poll.raw_rows, poll.silver_rows) == (0, 0)
    assert silver(base_dir) == []
    assert (
        SourceCheckpointStore(base_dir).watermark(SOURCE.key) == SERVER_NOW - SAFETY_LAG
    )


def test_a_poll_sooner_than_the_safety_lag_reads_nothing(base_dir):
    client = FakeListClient(entries(entry()), advance=dt.timedelta(0))
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    run(context, client=client)

    assert run(context, client=client) is None
    assert client.calls == 1


def test_a_dry_run_lands_nothing_and_commits_no_watermark(base_dir):
    report = dry_run_pipeline(
        lambda ctx: run(ctx, client=FakeListClient(entries(entry()))),
        FEED_NAME,
        base_dir,
    )

    assert not report.failed
    assert silver(base_dir) == []
    assert SourceCheckpointStore(base_dir).watermark(SOURCE.key) is None


def test_a_read_missing_a_stored_column_fails_rather_than_landing_a_partial_entry(
    base_dir,
):
    row = entry()
    del row["Reason"]

    with pytest.raises(SharePointFeedError, match="Reason"):
        run(
            RunContext(base_dir=base_dir, pipeline=FEED_NAME),
            client=FakeListClient(entries(row)),
        )
    assert SourceCheckpointStore(base_dir).watermark(SOURCE.key) is None


def test_with_no_client_the_run_refuses_as_a_config_failure(base_dir, capsys):
    with pytest.raises(NoClientError) as refused:
        run(RunContext(base_dir=base_dir, pipeline=FEED_NAME))

    assert refused.value.category == ErrorCategory.CONFIG
    assert main(["prog", "--base-dir", str(base_dir)]) == 1
    assert "--sample" in capsys.readouterr().err

```
