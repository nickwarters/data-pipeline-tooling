```python
"""Whole-feed proof for ``sharepoint_cases``: raw -> silver fan-out -> gold,
driven through the real `run()` over one fixture Case with every nest
populated, polled twice.

Proves what `tests/pipelines/test_sharepoint_cases.py`'s per-step suites
cannot: that every gold Detail Table agrees on the one winning observation for
one Case, all at once.

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
    UNKNOWN_BRAND,
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

    assert poll_1.window.end < poll_2.window.end
    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    assert len(read_rows(med.silver, "case_version")) == 2
    for table, expected in SILVER_COUNTS.items():
        assert len(read_rows(med.silver, table)) == expected, table

    [case] = read_rows(med.gold, CURRENT_TABLE)
    winner = (case["case_id"], case["source_observation_id"])

    for table in DETAIL_TABLES:
        rows = read_rows(med.gold, table)
        assert len(rows) == GOLD_COUNTS[table], table
        assert rows, f"{table} unexpectedly published nothing"
        assert {(row["case_id"], row["source_observation_id"]) for row in rows} == {
            winner
        }

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

    [general] = read_rows(med.gold, "general_answer")
    assert general["value_text"] == "Email"

    assert "amended_outcome" not in DETAIL_GRAIN
    assert "amended_outcome" not in GOLD_TABLES
    winning_version = next(
        row
        for row in read_rows(med.silver, "case_version")
        if row["source_observation_id"] == case["source_observation_id"]
    )
    assert winning_version["amended_outcome"] == json.dumps(AMENDED_OUTCOME_2)

    assert sum(
        row["answer_count"] for row in read_rows(med.gold, "answer_remediation_current")
    ) == len(read_rows(med.gold, "answer"))
    assert sum(
        row["appeal_count"] for row in read_rows(med.gold, "appeal_outcomes_current")
    ) == len(read_rows(med.gold, "appeal"))
    [throughput] = read_rows(med.gold, "case_throughput_daily")
    assert throughput["terminal_status"] == "Completed"
    assert throughput["case_count"] == 1
    assert (throughput["brand"], throughput["case_type"]) == (
        UNKNOWN_BRAND,
        case["case_type"],
    )
    assert throughput["assigned_reviewer_name"] == case["assigned_reviewer_name"]

    # The item fixture carries no AssignedAt, so the winning Case's
    # age-from-assigned row lands in the unknown bucket -- "never assigned",
    # not corruption.
    [age_from_assigned] = read_rows(med.gold, "case_age_from_assigned_buckets_current")
    assert age_from_assigned["age_bucket"] == "unknown"
    assert age_from_assigned["case_count"] == 1

```
