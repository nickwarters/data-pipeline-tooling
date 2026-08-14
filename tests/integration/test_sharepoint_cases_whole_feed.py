"""Whole-feed proof for ``sharepoint_cases``: raw -> silver fan-out -> gold, as
one system.

``tests/pipelines/test_sharepoint_cases.py`` already covers every hop and every
Detail Table in isolation -- one blob changing at a time, one table's assertions
at a time. This module is the sibling `tests/integration/` promises for a feed
this shaped (see `test_fan_out.py` for the generic fan-out pattern and
`test_public_api.py` for the boundary convention this package follows): it
drives the real `run()` -- never a hand-wired builder -- against one fixture
Case whose every nest is populated at once, polled twice, and asserts the
properties that only hold *across* the whole fan-out:

- every Detail Table's row counts, read off the fixture rather than restated
  as bare integers, over the exact table set `DETAIL_GRAIN` declares;
- that every gold Detail row for the Case carries the *one* observation
  `case_current` picked as the winner (ADR-0015's guarantee, asserted over
  every table in one pass rather than one table at a time);
- the accumulate-then-reduce shape end to end: two polls leave silver holding
  both observations for every table while gold holds one coherent snapshot,
  including two children -- an `answer_action` and an `answer_capture` row --
  dropped between observations and absent from gold without a trace in the
  child table alone.

The `question_definition` dimension join is not exercised here: no dimension
feed exists to join against yet.
"""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import (
    CURRENT_TABLE,
    DETAIL_GRAIN,
    DETAIL_TABLES,
    GOLD_TABLES,
)
from pipelines.sharepoint_cases.pipeline import FEED_NAME, run
from pipelines.sharepoint_cases.schema import CASE_LISTS
from tests._sharepoint_cases_fixtures import FakeListClient, item
from tests.framework_testing import read_rows
from tools.medallion import medallion
from tools.store import StoreRegistry

COMPLAINTS = CASE_LISTS[0]
SERVER_NOW = dt.datetime(2026, 8, 5, 9, 0, 0, tzinfo=dt.timezone.utc)
NEXT_POLL = dt.timedelta(minutes=10)


# --- the fixture Case: every nest populated, then changed between two polls -

# Observation 1 -- q-root-cause fails and carries a capture map (two fields)
# and two Remediation Actions; one General Question answered; a Conversation
# of two messages; one resolved Appeal and one still raised; three Case
# Details fields; no AmendedOutcome yet.
ANSWERS_1 = {
    "q-outcome": {"value": "Not upheld"},
    "q-root-cause": {
        "value": ["Process", "Training"],
        "justification": "Multiple factors contributed to the delay.",
        "remediationRequired": "yes",
        "remediationActions": [
            {"id": "ra-0", "text": "Retrain the branch team on call handling."},
            {"id": "ra-1", "text": "Escalate to the process owner."},
        ],
        "remediationStatus": {
            "status": "partial",
            "details": "Training scheduled for next quarter.",
        },
        "capture": {
            "field-note": "Called back within SLA.",
            "field-owner": {"loginName": "user-rp", "displayName": "Bola Okafor"},
        },
    },
    "general:complaint-channel": {"value": "Phone"},
}
MESSAGE_1 = {
    "author": {"loginName": "a.khan", "displayName": "Amira Khan"},
    "timestamp": "2026-08-04T16:02:00Z",
    "body": "Please confirm the call date.",
}
MESSAGE_2 = {
    "author": {"loginName": "b.okafor", "displayName": "Bola Okafor"},
    "timestamp": "2026-08-04T18:47:12.000Z",
    "body": "Confirmed -- the call was on the 30th.",
}
CONVERSATION_1 = [MESSAGE_1, MESSAGE_2]
APPEAL_RESOLVED = {
    "id": "appeal-1",
    "appellant": "e.novak",
    "at": "2026-08-01T09:00:00.000Z",
    "rationale": "The outcome was reached before the amended statement was on file.",
    "citedAnswerKeys": ["q-outcome"],
    "state": "resolved",
    "resolution": {
        "verdict": "agreed",
        "rationale": "The amended statement changes the timeliness answer.",
        "resolver": "d.reid",
        "at": "2026-08-02T10:15:00Z",
    },
}
APPEAL_OPEN = {
    "id": "appeal-2",
    "appellant": "e.novak",
    "at": "2026-08-05T08:05:00Z",
    "rationale": "Raising a second appeal on behalf of the manager.",
    "state": "raised",
}
APPEALS_1 = [APPEAL_RESOLVED, APPEAL_OPEN]
DETAILS_1 = {
    "complaintRef": "CMP-000101",
    "customerName": "Priya Shah",
    "complaintDate": "2026-06-18",
}

EARLY = item(
    Answers=json.dumps(ANSWERS_1),
    Conversation=json.dumps(CONVERSATION_1),
    Appeals=json.dumps(APPEALS_1),
    Details=json.dumps(DETAILS_1),
)

# Observation 2 (the winner: later Modified, higher version). Between the two
# polls the Reviewer completes the Case and edits three of the five blobs at
# once: ra-1 is untucked and field-owner cleared from q-root-cause's capture
# (two independent deletions, in two different Detail Tables, in the one
# poll -- the ADR-0015 scenario, exercised across the whole fan-out rather
# than isolated to one table); a second question is answered for the first
# time, so the two observations' question sets genuinely differ rather than
# happening to coincide; the General answer's value changes; the Conversation
# grows by one message (append-only, as the app guarantees); a Case Details
# field is added; and AmendedOutcome is populated for the first time. The
# Appeals blob and its two Appeals are carried through unchanged.
ANSWERS_2 = {
    "q-outcome": {"value": "Not upheld"},
    "q-root-cause": {
        "value": ["Process", "Training"],
        "justification": "Multiple factors contributed to the delay.",
        "remediationRequired": "yes",
        "remediationActions": [
            {"id": "ra-0", "text": "Retrain the branch team on call handling."},
        ],
        "remediationStatus": {"status": "complete", "details": "Training finished."},
        "capture": {"field-note": "Called back within SLA."},
    },
    "q-timeliness": {"value": "Yes"},
    "general:complaint-channel": {"value": "Email"},
}
MESSAGE_3 = {
    "author": {"loginName": "a.khan", "displayName": "Amira Khan"},
    "timestamp": "2026-08-05T08:40:00.000Z",
    "body": "Closing this out.",
}
CONVERSATION_2 = [MESSAGE_1, MESSAGE_2, MESSAGE_3]
APPEALS_2 = APPEALS_1
DETAILS_2 = {**DETAILS_1, "resolutionNote": "Retraining completed."}
AMENDED_OUTCOME_2 = {"outcome": "Upheld", "hadRemediation": True}

LATER = item(
    Status="Completed",
    CompletedAt="2026-08-05T08:45:00Z",
    ReportableAt="2026-08-05T08:45:00Z",
    Answers=json.dumps(ANSWERS_2),
    Conversation=json.dumps(CONVERSATION_2),
    Appeals=json.dumps(APPEALS_2),
    AmendedOutcome=json.dumps(AMENDED_OUTCOME_2),
    Details=json.dumps(DETAILS_2),
)
LATER["Modified"] = "2026-08-05T08:45:00Z"
LATER["odata.etag"] = '"4"'


# What each observation contributes, per Detail Table -- the counts every
# assertion below derives from, rather than restating as bare integers.
# Computed per observation, never assumed equal: the two answer maps carry
# different question sets (see ANSWERS_2 above), so a silver count must sum
# the two independently and a gold count must read observation 2's alone.
def _question_ids(answers: dict) -> list[str]:
    return [key for key in answers if not key.startswith("general:")]


def _general_keys(answers: dict) -> list[str]:
    return [key.split(":", 1)[1] for key in answers if key.startswith("general:")]


SILVER_COUNTS = {
    "answer": len(_question_ids(ANSWERS_1)) + len(_question_ids(ANSWERS_2)),
    "answer_capture": len(ANSWERS_1["q-root-cause"]["capture"])
    + len(ANSWERS_2["q-root-cause"]["capture"]),
    "answer_action": len(ANSWERS_1["q-root-cause"]["remediationActions"])
    + len(ANSWERS_2["q-root-cause"]["remediationActions"]),
    "general_answer": len(_general_keys(ANSWERS_1)) + len(_general_keys(ANSWERS_2)),
    "conversation_message": len(CONVERSATION_1) + len(CONVERSATION_2),
    "appeal": len(APPEALS_1) + len(APPEALS_2),
    "case_detail": len(DETAILS_1) + len(DETAILS_2),
}
# Gold reduces to observation 2 alone (the winner), so the gold count of every
# Detail Table is exactly what observation 2 itself carries.
GOLD_COUNTS = {
    "answer": len(_question_ids(ANSWERS_2)),
    "answer_capture": len(ANSWERS_2["q-root-cause"]["capture"]),
    "answer_action": len(ANSWERS_2["q-root-cause"]["remediationActions"]),
    "general_answer": len(_general_keys(ANSWERS_2)),
    "conversation_message": len(CONVERSATION_2),
    "appeal": len(APPEALS_2),
    "case_detail": len(DETAILS_2),
}
assert set(SILVER_COUNTS) == set(GOLD_COUNTS) == set(DETAIL_GRAIN), (
    "the fixture must cover every declared Detail Table, no more and no less"
)


def test_the_whole_feed_refines_one_full_nest_case_to_gold_across_two_polls(tmp_path):
    client = FakeListClient(
        pd.DataFrame([EARLY]),
        pd.DataFrame([LATER]),
        server_now=SERVER_NOW,
        advance=NEXT_POLL,
    )
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    [poll_1] = run(context, client=client, case_lists=(COMPLAINTS,))
    [poll_2] = run(context, client=client, case_lists=(COMPLAINTS,))

    assert poll_1.window.end < poll_2.window.end  # sanity: two distinct real polls
    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    # --- silver: both observations survive, in full, in every table ---------
    assert len(read_rows(med.silver, "case_version")) == 2
    for table, expected in SILVER_COUNTS.items():
        assert len(read_rows(med.silver, table)) == expected, table

    # --- gold: one Case, one winning observation -----------------------------
    [case] = read_rows(med.gold, CURRENT_TABLE)
    winner = (case["case_id"], case["source_observation_id"])

    for table in DETAIL_TABLES:
        rows = read_rows(med.gold, table)
        # Row count comes from the fixture / the declaration, never a
        # restated literal. Grain uniqueness itself is not re-asserted here:
        # gold_detail_builder runs a UniqueValidator over DETAIL_GRAIN[table]
        # before its Writer, so a duplicate would already have failed run().
        assert len(rows) == GOLD_COUNTS[table], table
        # ADR-0015's guarantee, over every table in one pass: every child row
        # of this Case carries the one observation that won for it.
        assert rows, f"{table} unexpectedly published nothing"
        assert {(row["case_id"], row["source_observation_id"]) for row in rows} == {
            winner
        }

    # --- the two deletions: present in silver, gone from gold ---------------
    assert {row["action_id"] for row in read_rows(med.silver, "answer_action")} == {
        "ra-0",
        "ra-1",
    }
    assert {row["action_id"] for row in read_rows(med.gold, "answer_action")} == {
        "ra-0"
    }
    assert {row["field_key"] for row in read_rows(med.silver, "answer_capture")} == {
        "field-note",
        "field-owner",
    }
    assert {row["field_key"] for row in read_rows(med.gold, "answer_capture")} == {
        "field-note"
    }

    # --- the general answer's value follows the winner, not the first poll --
    [general] = read_rows(med.gold, "general_answer")
    assert general["value_text"] == "Email"

    # --- amended_outcome: no Detail Table, landed as text on the winner ------
    assert "amended_outcome" not in DETAIL_GRAIN
    assert "amended_outcome" not in GOLD_TABLES
    winning_version = next(
        row
        for row in read_rows(med.silver, "case_version")
        if row["source_observation_id"] == case["source_observation_id"]
    )
    assert winning_version["amended_outcome"] == json.dumps(AMENDED_OUTCOME_2)

    # The two Detail-Table-sourced aggregates still total to their source
    # table here, over a two-poll reduce rather than the single poll
    # `tests/pipelines/test_sharepoint_cases.py` already covers.
    assert sum(
        row["answer_count"] for row in read_rows(med.gold, "answer_remediation_current")
    ) == len(read_rows(med.gold, "answer"))
    assert sum(
        row["appeal_count"] for row in read_rows(med.gold, "appeal_outcomes_current")
    ) == len(read_rows(med.gold, "appeal"))
    # The Case completed on the second poll, so throughput counts it once.
    [throughput] = read_rows(med.gold, "case_throughput_daily")
    assert throughput["terminal_status"] == "Completed"
    assert throughput["case_count"] == 1
