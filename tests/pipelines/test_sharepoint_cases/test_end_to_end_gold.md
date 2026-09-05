```python
"""Gold, end to end: every table published from a real silver history, and the
watermark committed last.

The unit suites prove each reduction against a ``RecordingWriter``. What only a
real store can show is that the *whole* rebuild agrees on one winning
observation per Case -- including the deletions a per-child reduce is
structurally blind to.
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import GOLD_TABLES
from pipelines.sharepoint_cases.pipeline import FEED_NAME, SAFETY_LAG
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    NEXT_POLL,
    OTHER,
    SERVER_NOW,
    SOURCE,
    FakeListClient,
    item,
    items,
    later_item,
    published_gold,
    run,
)
from tests.framework_testing import RecordingRunLog, read_rows
from tools.integrations.sharepoint_checkpoint import SharePointCheckpointStore
from tools.medallion import medallion
from tools.store import StoreRegistry


def two_polls(base_dir, first: list[dict], second: list[dict]) -> None:
    """Poll twice: ``first``'s items in one window, ``second``'s in the next.

    Every gold Detail Table test below is this shape -- what differs is only
    which blob moved between the two observations.
    """
    client = FakeListClient(items(*first), items(*second), advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    run(context, client=client)
    run(context, client=client)


def winning_observation(med) -> str:
    """The observation id gold's current-state reduction settled on."""
    [winner] = read_rows(med.gold, "case_current")
    return winner["source_observation_id"]


def test_a_poll_publishes_every_gold_table_and_then_commits_the_watermark(base_dir):
    run_log = RecordingRunLog()
    source = item()
    [poll] = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=FakeListClient(items(source)),
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert poll.window.end == SERVER_NOW - SAFETY_LAG
    # A first load's batch is named for the list it loaded.
    assert str(COMPLAINTS.list_id) in poll.ingestion_batch_id
    assert published_gold(run_log) == set(GOLD_TABLES)
    [case] = read_rows(med.gold, "case_current")
    assert (case["source_item_id"], case["status"]) == (
        str(source["Id"]),
        source["Status"],
    )
    assert case["as_of_utc"] == (SERVER_NOW - SAFETY_LAG).isoformat()
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )


def test_a_quiet_first_window_commits_and_publishes_every_gold_table_empty(base_dir):
    # Nothing to reduce is not nothing to publish: a consumer reading gold must
    # find the tables, empty, rather than a missing one it has to special-case.
    run_log = RecordingRunLog()
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=FakeListClient(pd.DataFrame()),
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert published_gold(run_log) == set(GOLD_TABLES)
    assert all(read_rows(med.gold, table) == [] for table in GOLD_TABLES)
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )


def test_the_winning_observation_settles_gold_answer_and_drops_the_others(base_dir):
    early = {"q1": {"value": "A"}, "q2": {"value": "X"}}
    late = {"q1": {"value": "B"}, "q3": {"value": "Y"}}
    two_polls(
        base_dir,
        [item(Answers=json.dumps(early))],
        [later_item(Answers=json.dumps(late), Status="Completed")],
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    # Silver is append-only: it keeps both observations, not just the winner.
    assert len(read_rows(med.silver, "answer")) == len(early) + len(late)

    gold_answer = read_rows(med.gold, "answer")
    assert {row["question_id"] for row in gold_answer} == set(late)
    assert {row["source_observation_id"] for row in gold_answer} == {
        winning_observation(med)
    }


def test_the_winning_observation_settles_gold_general_answer_and_drops_the_others(
    base_dir,
):
    early = {"general:a": {"value": "first"}, "general:b": {"value": "X"}}
    late = {"general:a": {"value": "second"}, "general:c": {"value": "Y"}}
    two_polls(
        base_dir,
        [item(Answers=json.dumps(early))],
        [later_item(Answers=json.dumps(late), Status="Completed")],
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    # Silver is append-only: it keeps both observations, not just the winner.
    assert len(read_rows(med.silver, "general_answer")) == len(early) + len(late)

    gold_general_answer = read_rows(med.gold, "general_answer")
    assert {row["general_key"] for row in gold_general_answer} == {
        key.removeprefix("general:") for key in late
    }
    assert {row["source_observation_id"] for row in gold_general_answer} == {
        winning_observation(med)
    }


def test_the_winning_observation_settles_gold_capture_and_action_and_drops_the_others(
    base_dir,
):
    # Poll 2 sets remediationRequired to "no", the app's trigger for deleting
    # both -- the exact deletion a child-keyed reduce is structurally blind to.
    stripped_early = item(
        Id=101,
        Answers=json.dumps(
            {
                "q1": {
                    "value": "A",
                    "remediationRequired": "yes",
                    "remediationActions": [
                        {"id": "ra-0", "text": "Retrain the branch team."}
                    ],
                    "capture": {"field-a": "Old note."},
                }
            }
        ),
    )
    stripped_later = later_item(
        Id=101,
        Answers=json.dumps({"q1": {"value": "A", "remediationRequired": "no"}}),
        Status="Completed",
    )

    # Item 102 adds a genuinely new capture field on poll 2, proving gold
    # reflects an addition rather than always landing empty.
    grown_early = item(
        Id=102, Answers=json.dumps({"q1": {"value": "A", "remediationRequired": "yes"}})
    )
    grown_later = later_item(
        Id=102,
        Answers=json.dumps(
            {
                "q1": {
                    "value": "A",
                    "remediationRequired": "yes",
                    "capture": {"field-added": "Added on the second poll."},
                }
            }
        ),
        Status="Completed",
    )

    two_polls(base_dir, [stripped_early, grown_early], [stripped_later, grown_later])

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.silver, "answer_capture")) == 2
    assert len(read_rows(med.silver, "answer_action")) == 1

    gold_capture = read_rows(med.gold, "answer_capture")
    gold_action = read_rows(med.gold, "answer_action")

    # The semi-join reads the winner's absence correctly, rather than keeping
    # a stale row a per-child reduce would have no reason to drop.
    assert not [row for row in gold_capture if row["source_item_id"] == "101"]
    assert not [row for row in gold_action if row["source_item_id"] == "101"]

    [added] = [row for row in gold_capture if row["source_item_id"] == "102"]
    assert added["field_key"] == "field-added"


def test_the_winning_observation_settles_gold_conversation_message_and_appeal(
    base_dir,
):
    # conversation_message's key is positional (seq), not a JSON map key or a
    # minted id, so an observation-spanning superset collides on the grain
    # itself -- without the semi-join, UniqueValidator would abort the build, so
    # a weakened reduction fails loudly here, not silently.
    message_1 = {
        "author": {"loginName": "a.khan", "displayName": "Amira Khan"},
        "timestamp": "2026-08-04T16:02:00Z",
        "body": "Please confirm the call date.",
    }
    message_2 = {
        "author": {"loginName": "b.okafor", "displayName": "Bola Okafor"},
        "timestamp": "2026-08-04T18:47:12.000Z",
        "body": "Confirmed -- the call was on the 30th.",
    }
    message_3 = {
        "author": {"loginName": "a.khan", "displayName": "Amira Khan"},
        "timestamp": "2026-08-05T08:00:00.000Z",
        "body": "Thanks, closing this out.",
    }
    # Companion: an Appeal in the shape resolveAppeal() writes in the real app.
    raised = {
        "id": "appeal-1",
        "appellant": "e.novak",
        "at": "2026-08-04T09:00:00Z",
        "rationale": "Reconsider the outcome.",
        "state": "raised",
    }
    resolved = {
        **raised,
        "state": "resolved",
        "resolution": {
            "verdict": "agreed",
            "rationale": "The amended statement changes the outcome.",
            "resolver": "d.reid",
            "at": "2026-08-05T08:44:00Z",
        },
    }

    early_thread, late_thread = (
        [message_1, message_2],
        [message_1, message_2, message_3],
    )
    two_polls(
        base_dir,
        [item(Conversation=json.dumps(early_thread), Appeals=json.dumps([raised]))],
        [
            later_item(
                Conversation=json.dumps(late_thread),
                Appeals=json.dumps([resolved]),
                Status="Completed",
            )
        ],
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.silver, "conversation_message")) == len(
        early_thread
    ) + len(late_thread)

    gold_messages = read_rows(med.gold, "conversation_message")
    assert [row["seq"] for row in gold_messages] == list(range(len(late_thread)))
    assert {row["source_observation_id"] for row in gold_messages} == {
        winning_observation(med)
    }

    # Gold holds the Appeal once, resolved, with the resolution lifted onto it.
    assert len(read_rows(med.silver, "appeal")) == 2
    [gold_appeal] = read_rows(med.gold, "appeal")
    assert gold_appeal["appeal_id"] == resolved["id"]
    assert gold_appeal["state"] == resolved["state"]
    for key, value in resolved["resolution"].items():
        assert gold_appeal[f"resolution_{key}"] == value, key


def test_the_winning_observation_settles_gold_case_detail_and_drops_the_others(
    base_dir,
):
    # The composite AppendOnly key (source_observation_id, field_key) is under
    # test -- no other end-to-end test exercises this table otherwise, since
    # item()'s default Details cell falls into the absent -> None sweep.
    early = {"complaintRef": "CMP-000101", "customerName": "Priya Shah"}
    late = {"customerName": "Priya Shah", "sourceSystem": "legacy-crm"}
    two_polls(
        base_dir,
        [item(Details=json.dumps(early))],
        [later_item(Details=json.dumps(late), Status="Completed")],
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.silver, "case_detail")) == len(early) + len(late)

    gold_case_detail = read_rows(med.gold, "case_detail")
    assert {row["field_key"] for row in gold_case_detail} == set(late)
    assert {row["source_observation_id"] for row in gold_case_detail} == {
        winning_observation(med)
    }


@pytest.mark.parametrize("cell", [None, "misfiled", "complaints"])
def test_gold_answer_derives_the_same_case_id_as_the_settled_case_type(base_dir, cell):
    # Mirrors test_silver_settles_the_case_type_to_the_polled_lists_declared_one:
    # OTHER's declared case_type is "other", never whatever this raw cell says.
    client = FakeListClient(items(item(CaseType=cell)))

    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=client,
        case_lists=(OTHER,),
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    [case] = read_rows(med.gold, "case_current")
    [row] = read_rows(med.gold, "answer")
    # Fails with zero rows (the semi-join matches nothing) or an IdentityError
    # if ``to_silver_answer`` ever reads raw's own CaseType cell instead of the one
    # silver settled.
    assert row["case_id"] == case["case_id"]
    assert row["case_type"] == OTHER.case_type


def test_an_overlap_reread_does_not_double_count_gold(base_dir):
    # The overlap re-presents rows that did not change. Silver no-ops them; gold
    # must not count the Case twice either.
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    details = {"complaintRef": "CMP-000101", "customerName": "Priya Shah"}
    client = FakeListClient(
        items(item(Details=json.dumps(details))),
        advance=NEXT_POLL,
    )

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.gold, "case_current")) == 1
    assert [
        row["case_count"] for row in read_rows(med.gold, "case_counts_current")
    ] == [1]
    assert len(read_rows(med.silver, "answer")) == 1
    # Proves the composite (source_observation_id, field_key) key: a wrong
    # single-column key would raise an AppendOnly conflict here instead of a
    # clean no-op.
    assert len(read_rows(med.silver, "case_detail")) == len(details)

```
