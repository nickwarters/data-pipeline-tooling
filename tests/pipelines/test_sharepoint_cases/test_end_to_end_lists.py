"""More than one list, end to end.

All Case Types share one list template, so every list refines into the same
tables and is told apart by the Case Type on the row. What is per-list is the
watermark: each ``(site, list_id)`` keeps its own, so one list being inside its
safety lag is ordinary operation rather than a failure.
"""

from __future__ import annotations

import pytest

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import GOLD_TABLES
from pipelines.sharepoint_cases.pipeline import FEED_NAME, SAFETY_LAG
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
from tools.integrations.sharepoint_checkpoint import SharePointCheckpointStore
from tools.integrations.sharepoint_rest import SharePointFeedError
from tools.medallion import medallion
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
    checkpoints = SharePointCheckpointStore(polled)

    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG


def test_a_list_with_nothing_safe_to_poll_is_skipped_and_the_others_still_run(base_dir):
    # One list polled again inside the safety lag is ordinary operation, not a
    # failure: it is skipped and its watermark stands.
    run_log = RecordingRunLog()
    SharePointCheckpointStore(base_dir).commit(
        SOURCE,
        window_end=SERVER_NOW,
        ingestion_batch_id="earlier",
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
    checkpoints = SharePointCheckpointStore(base_dir)
    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG


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
    checkpoints = SharePointCheckpointStore(base_dir)
    assert {row["case_type"] for row in read_rows(med.silver, "case_version")} == {
        COMPLAINTS.case_type
    }
    assert published_gold(run_log) == set()
    assert checkpoints.committed_watermark(SOURCE) is None
    assert checkpoints.committed_watermark(OTHER_SOURCE) is None


def test_a_retry_after_a_partial_failure_converges_and_advances_both_lists(base_dir):
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    with pytest.raises(SharePointFeedError):
        run(context, client=broken_second_list_client(), case_lists=TWO_LISTS)
    run(context, client=two_list_client(), case_lists=TWO_LISTS)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    checkpoints = SharePointCheckpointStore(base_dir)
    # The first list's re-read is a no-op against append-only silver: one
    # version per list, and one current Case per list.
    for layer, table in ((med.silver, "case_version"), (med.gold, "case_current")):
        assert sorted(row["case_type"] for row in read_rows(layer, table)) == sorted(
            case_list.case_type for case_list in TWO_LISTS
        ), table
    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG
