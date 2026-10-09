"""More than one list, end to end.

All Case Types share one list template, so every list refines into the same
tables and is told apart by the Case Type on the row. What is per-list is the
watermark: each ``(site, list_id)`` keeps its own, so one list being inside its
safety lag is ordinary operation rather than a failure.
"""

from __future__ import annotations

import pandas as pd
import pytest

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import DETAIL_TABLES, GOLD_TABLES
from pipelines.sharepoint_cases.pipeline import FEED_NAME, PERSON_TABLE, SAFETY_LAG
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    OTHER,
    OTHER_SOURCE,
    SERVER_NOW,
    SOURCE,
    TWO_LISTS,
    FakeListClient,
    item,
    items,
    published_gold,
    run,
)
from tests.framework_testing import RecordingRunLog, read_rows
from tools.integrations.sharepoint_rest import SharePointFeedError
from tools.medallion import medallion
from tools.source_checkpoint import SourceCheckpointStore
from tools.store import StoreRegistry


def two_list_client(**kwargs) -> FakeListClient:
    """A client serving each list one item, both carrying item id 101."""
    return FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [items(item(Title="OTH-000101"))],
        },
        **kwargs,
    )


def broken_second_list_client() -> FakeListClient:
    """The same pair, with the second list answering an unreadable Person."""
    return FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [items(item(ResponsibleParty="not an object"))],
        }
    )


@pytest.fixture
def polled(base_dir):
    """Both lists polled once, into a base directory the test then reads."""
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )
    return base_dir


def test_two_lists_land_in_one_observation_table_and_one_version_table(base_dir):
    polls = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert {poll.case_list for poll in polls} == set(TWO_LISTS)
    assert {
        row["source_list_name"] for row in read_rows(med.raw, "case_observation")
    } == {case_list.list_name for case_list in TWO_LISTS}
    assert {row["case_type"] for row in read_rows(med.silver, "case_version")} == {
        case_list.case_type for case_list in TWO_LISTS
    }


def test_the_same_item_id_in_two_lists_is_two_cases(polled):
    # Item 101 exists in every list, so neither the observation id nor the
    # case_id may be derived from it alone.
    med = medallion(StoreRegistry(polled), FEED_NAME)
    current_cases = read_rows(med.gold, "case_current")

    assert {row["source_item_id"] for row in current_cases} == {"101"}
    assert len({row["case_id"] for row in current_cases}) == 2
    assert len({row["source_observation_id"] for row in current_cases}) == 2


def test_gold_counts_across_every_list(polled):
    # A Reviewer holds Cases across Case Types, so the aggregate is one table
    # over the union rather than one table per list -- split into one row per
    # Case Type, since Case Type is part of the base grain.
    rows = read_rows(
        medallion(StoreRegistry(polled), FEED_NAME).gold, "case_counts_current"
    )

    assert {row["case_type"] for row in rows} == {
        COMPLAINTS.case_type,
        OTHER.case_type,
    }
    assert sum(row["case_count"] for row in rows) == 2


def test_each_list_keeps_its_own_watermark(polled):
    checkpoints = SourceCheckpointStore(polled)

    assert checkpoints.watermark(SOURCE.key) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.watermark(OTHER_SOURCE.key) == SERVER_NOW - SAFETY_LAG


def test_a_list_with_nothing_safe_to_poll_is_skipped_and_the_others_still_run(base_dir):
    # One list polled again inside the safety lag is ordinary operation, not a
    # failure: it is skipped and its watermark stands.
    run_log = RecordingRunLog()
    SourceCheckpointStore(base_dir).commit(
        SOURCE.key,
        SERVER_NOW,
        batch_id="earlier",
        pipeline_run_id="earlier-run",
    )

    polls = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert [poll.case_list for poll in polls] == [OTHER]
    assert {row["case_type"] for row in read_rows(med.silver, "case_version")} == {
        OTHER.case_type
    }
    assert published_gold(run_log) == set(GOLD_TABLES)
    checkpoints = SourceCheckpointStore(base_dir)
    assert checkpoints.watermark(SOURCE.key) == SERVER_NOW
    assert checkpoints.watermark(OTHER_SOURCE.key) == SERVER_NOW - SAFETY_LAG


def test_a_failure_polling_the_second_list_leaves_no_gold_and_no_watermark(base_dir):
    # Fail fast: the first list's observations are committed (append-only, per
    # step), but nothing is published and no watermark moves.
    run_log = RecordingRunLog()

    with pytest.raises(SharePointFeedError):
        run(
            RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
            client=broken_second_list_client(),
            case_lists=TWO_LISTS,
        )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    checkpoints = SourceCheckpointStore(base_dir)
    assert {row["case_type"] for row in read_rows(med.silver, "case_version")} == {
        COMPLAINTS.case_type
    }
    assert published_gold(run_log) == set()
    assert checkpoints.watermark(SOURCE.key) is None
    assert checkpoints.watermark(OTHER_SOURCE.key) is None


def test_a_retry_after_a_partial_failure_converges_and_advances_both_lists(base_dir):
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    with pytest.raises(SharePointFeedError):
        run(context, client=broken_second_list_client(), case_lists=TWO_LISTS)
    run(context, client=two_list_client(), case_lists=TWO_LISTS)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    checkpoints = SourceCheckpointStore(base_dir)
    # The first list's re-read is a no-op against append-only silver: one
    # version per list, and one current Case per list.
    for layer, table in ((med.silver, "case_version"), (med.gold, "case_current")):
        assert sorted(row["case_type"] for row in read_rows(layer, table)) == sorted(
            case_list.case_type for case_list in TWO_LISTS
        ), table
    assert checkpoints.watermark(SOURCE.key) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.watermark(OTHER_SOURCE.key) == SERVER_NOW - SAFETY_LAG


# --- a quiet list -------------------------------------------------------------


def quiet_other_client() -> FakeListClient:
    """The first list answering one item, the second answering nothing."""
    return FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [pd.DataFrame()],
        }
    )


def steps_of(run_log: RecordingRunLog, case_list) -> set[str]:
    """Every step a list recorded, by the Case Type its step names carry."""
    return {
        record["step"]
        for record in run_log.records
        if record["step"].split(":")[1] == case_list.case_type
    }


def test_a_quiet_list_records_its_read_and_runs_no_write_or_silver_step(base_dir):
    # Polled and found empty: the run log shows the list was read, but there is
    # nothing to land, so it opens no connection to raw, silver or quarantine.
    run_log = RecordingRunLog()

    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=quiet_other_client(),
        case_lists=TWO_LISTS,
    )

    assert steps_of(run_log, OTHER) == {
        f"raw:{OTHER.case_type}:read",
        f"raw:{OTHER.case_type}:observation",
    }
    # ... while the busy list beside it records every step it always did.
    busy = steps_of(run_log, COMPLAINTS)
    assert f"raw:{COMPLAINTS.case_type}:write" in busy
    assert f"silver:{COMPLAINTS.case_type}:write" in busy
    assert f"silver:{COMPLAINTS.case_type}:{PERSON_TABLE}:write" in busy
    for table in DETAIL_TABLES:
        assert f"silver:{COMPLAINTS.case_type}:{table}:write" in busy, table


def test_a_quiet_list_still_gets_a_poll_of_zeros_and_the_busy_list_is_unaffected(
    base_dir,
):
    polls = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=quiet_other_client(),
        case_lists=TWO_LISTS,
    )

    busy, quiet = polls
    assert (busy.case_list, quiet.case_list) == (COMPLAINTS, OTHER)
    assert (busy.raw_rows, busy.silver_rows) == (1, 1)
    assert busy.detail_rows[PERSON_TABLE] > 0
    # The quiet poll has the busy one's shape -- person and every Detail Table
    # named -- so anything reading ListPoll needs no special case for it.
    assert (quiet.raw_rows, quiet.silver_rows) == (0, 0)
    assert dict(quiet.detail_rows) == {table: 0 for table in busy.detail_rows}
    assert set(quiet.detail_rows) == {PERSON_TABLE, *DETAIL_TABLES}
    assert quiet.window == busy.window

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert {row["case_type"] for row in read_rows(med.silver, "case_version")} == {
        COMPLAINTS.case_type
    }


def test_a_quiet_list_still_advances_its_watermark(base_dir):
    # The window was read and found empty, which is exactly what the watermark
    # vouches for.
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=quiet_other_client(),
        case_lists=TWO_LISTS,
    )

    checkpoints = SourceCheckpointStore(base_dir)
    assert checkpoints.watermark(SOURCE.key) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.watermark(OTHER_SOURCE.key) == SERVER_NOW - SAFETY_LAG


def test_a_quiet_list_leaves_its_watermark_alone_under_a_dry_run(base_dir):
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, dry_run=True),
        client=quiet_other_client(),
        case_lists=TWO_LISTS,
    )

    checkpoints = SourceCheckpointStore(base_dir)
    assert checkpoints.watermark(SOURCE.key) is None
    assert checkpoints.watermark(OTHER_SOURCE.key) is None


def test_gold_is_still_published_when_every_list_is_quiet(base_dir):
    run_log = RecordingRunLog()

    polls = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=FakeListClient(pd.DataFrame()),
        case_lists=TWO_LISTS,
    )

    assert [poll.raw_rows for poll in polls] == [0, 0]
    assert published_gold(run_log) == set(GOLD_TABLES)
    # Every list recorded its read and nothing it would have written.
    for case_list in TWO_LISTS:
        assert steps_of(run_log, case_list) == {
            f"raw:{case_list.case_type}:read",
            f"raw:{case_list.case_type}:observation",
        }
    checkpoints = SourceCheckpointStore(base_dir)
    assert checkpoints.watermark(SOURCE.key) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.watermark(OTHER_SOURCE.key) == SERVER_NOW - SAFETY_LAG
