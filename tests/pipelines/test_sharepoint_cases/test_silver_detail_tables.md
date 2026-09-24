```python
"""The Detail Table explodes: one silver observation's JSON blobs fanned out
into one row per question / capture field / message / appeal / detail.

Six tables, one shape of test: drive the builder over a single ``version()``
whose blob a test names, and read what it would have written. ``exploded()``
owns the wiring so each test is its blob and its claim, and
``assert_carries_the_five_stamps`` owns the rule every one of the six shares —
a child row is exactly its declared columns, stamped with the parent
observation it came from.
"""

from __future__ import annotations

import json
from dataclasses import fields
from functools import partial

import pandas as pd
import pytest

from framework.run import RunContext, RunLog, active_context
from pipelines.sharepoint_cases.pipeline import (
    FEED_NAME,
    to_silver_answer,
    to_silver_answer_capture,
    to_silver_appeal,
    to_silver_case_detail,
    to_silver_conversation_message,
    to_silver_general_answer,
)
from pipelines.sharepoint_cases.schema import (
    DETAIL_ID_VARS,
    AnswerCaptureRow,
    AnswerRow,
    AppealRow,
    CaseDetailRow,
    CaseList,
    ConversationMessageRow,
    GeneralAnswerRow,
)
from tests._sharepoint_cases_fixtures import COMPLAINTS, appeal, version
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    rows_of,
)


def exploded(
    builder,
    blob_column: str,
    blob: str | None,
    *,
    case_list: CaseList = COMPLAINTS,
    rejects: RecordingWriter | None = None,
    run_log: RunLog | None = None,
) -> list[dict]:
    """Drive one Detail Table explode, in memory, over one observation's blob."""
    writer = RecordingWriter()

    def drive() -> None:
        builder(
            given_rows([version(**{blob_column: blob})]),
            writer,
            case_list,
            rejects or RecordingWriter(),
        )

    # The steps record against the ambient context, so a test that wants the
    # records makes one active rather than handing the step a run log. Without
    # one it still runs and simply records nothing.
    if run_log is None:
        drive()
    else:
        with active_context(RunContext(pipeline=FEED_NAME, run_log=run_log)):
            drive()
    return rows_of(writer)


silver_answers = partial(exploded, to_silver_answer, "answers")
silver_captures = partial(exploded, to_silver_answer_capture, "answers")
silver_general_answers = partial(exploded, to_silver_general_answer, "answers")
silver_conversation_messages = partial(
    exploded, to_silver_conversation_message, "conversation"
)
silver_appeals = partial(exploded, to_silver_appeal, "appeals")
silver_case_details = partial(exploded, to_silver_case_detail, "details")


# What ``version()``'s defaults say about the observation every child came from:
# the declared id vars, in the type each reaches a Detail Table as (the batch
# arrives typed, so the parent's modified instant is a Timestamp, not text).
PARENT = version()
STAMPS = {
    column: pd.Timestamp(PARENT[column])
    if column == "source_modified_at"
    else PARENT[column]
    for column in DETAIL_ID_VARS
}


def assert_carries_the_five_stamps(rows: list[dict], row_type: type) -> None:
    """Every row is exactly ``row_type``'s columns, stamped with its parent.

    The six Detail Tables differ in what they explode, not in how a child is
    tied back to its Case version -- so the rule is stated here once and each
    table's test names only the shape it is proving.
    """
    assert rows
    for row in rows:
        assert set(row) == {field.name for field in fields(row_type)}
        assert {column: row[column] for column in STAMPS} == STAMPS


# --- answer ------------------------------------------------------------------


def test_an_answer_map_becomes_one_row_per_question_carrying_the_five_stamps():
    # general:complaint-channel must not survive the explode -- it belongs to
    # the General Question table.
    rows = silver_answers(
        json.dumps(
            {
                "q1": {"value": "A"},
                "q2": {"value": "B"},
                "general:complaint-channel": {"value": "Phone"},
            }
        )
    )

    assert {row["question_id"] for row in rows} == {"q1", "q2"}
    assert_carries_the_five_stamps(rows, AnswerRow)


@pytest.mark.parametrize(
    "answers_json, expected",
    [
        ('{"q1":{"value":"A","remediationRequired":"yes"}}', "yes"),
        ('{"q1":{"value":"A","remediationRequired":"no"}}', "no"),
        ('{"q1":{"value":"A"}}', None),
    ],
)
def test_remediation_required_is_tri_state_and_survives_the_explode(
    answers_json, expected
):
    [row] = silver_answers(answers_json)

    assert row["remediation_required"] == expected


def test_a_multi_select_answer_joins_value_text_on_the_separator():
    [row] = silver_answers('{"q1":{"value":["Process","Training"]}}')

    assert row["value_text"] == "Process|Training"
    assert json.loads(row["value_json"]) == ["Process", "Training"]


def test_a_scalar_answer_has_matching_value_text_and_value_json():
    [row] = silver_answers('{"q1":{"value":"Not upheld"}}')

    assert row["value_text"] == row["value_json"] == "Not upheld"


def test_an_unknown_remediation_status_quarantines_while_the_good_answer_lands():
    rejects = RecordingWriter()

    rows = silver_answers(
        json.dumps(
            {
                "q1": {"value": "A"},
                "q2": {
                    "value": "B",
                    "remediationStatus": {"status": "resolved"},
                },
            }
        ),
        rejects=rejects,
    )

    assert [row["question_id"] for row in rows] == ["q1"]
    [rejected] = rows_of(rejects)
    assert rejected["question_id"] == "q2"
    assert "remediation_status" in rejected["failed_rule"]


# --- answer_capture ----------------------------------------------------------


def test_a_capture_map_becomes_one_row_per_field_carrying_the_five_stamps():
    # raw_value and capture_json must never reach the writer.
    rows = silver_captures(
        json.dumps(
            {
                "q1": {
                    "value": "A",
                    "capture": {
                        "field-note": "Called back within SLA.",
                        "field-owner": {
                            "loginName": "user-rp",
                            "displayName": "Bola Okafor",
                        },
                    },
                }
            }
        )
    )

    assert {row["field_key"] for row in rows} == {"field-note", "field-owner"}
    assert {row["question_id"] for row in rows} == {"q1"}
    assert_carries_the_five_stamps(rows, AnswerCaptureRow)


# A sentinel for the null-capture-value param below: pandas lands a wholly-null
# object column as NaN rather than None, and NaN != NaN, so equality can't
# carry the expectation the way it does for every other shape.
_REJECTED_AS_NAN = object()


@pytest.mark.parametrize(
    "capture_value, expected, rejected_raw_value",
    [
        pytest.param(
            {"loginName": "user-rp", "displayName": "Bola Okafor"},
            ("person", None, "user-rp", "Bola Okafor"),
            None,
            id="a-whole-person",
        ),
        pytest.param(
            "Called back within SLA.",
            ("text", "Called back within SLA.", None, None),
            None,
            id="text",
        ),
        pytest.param(
            "user-rp",
            ("text", "user-rp", None, None),
            None,
            id="a-person-field-holding-a-bare-string",
        ),
        pytest.param(
            {"loginName": "user-rp"},
            None,
            json.dumps({"loginName": "user-rp"}),
            id="a-half-filled-person",
        ),
        pytest.param(
            [{"id": "legacy-action-0", "text": "Old-style action"}],
            None,
            json.dumps([{"id": "legacy-action-0", "text": "Old-style action"}]),
            id="a-legacy-action-array",
        ),
        pytest.param(
            None,
            None,
            # A JSON null lands as pandas NaN, not the string "null" -- hence
            # the sentinel rather than a plain equality expectation.
            _REJECTED_AS_NAN,
            id="a-json-null",
        ),
        pytest.param(
            42,
            None,
            42,
            id="a-bare-json-number",
        ),
    ],
)
def test_discriminate_capture_value_places_every_shape(
    capture_value, expected, rejected_raw_value
):
    # field-control proves a quarantined sibling doesn't abort the whole answer.
    rejects = RecordingWriter()
    run_log = RecordingRunLog()
    rows = silver_captures(
        json.dumps(
            {
                "q1": {
                    "value": "A",
                    "capture": {
                        "field-control": "Always fine.",
                        "field-target": capture_value,
                    },
                }
            }
        ),
        rejects=rejects,
        run_log=run_log,
    )

    if expected is None:
        [control] = [row for row in rows if row["field_key"] == "field-control"]
        assert control["value_kind"] == "text"
        assert {row["field_key"] for row in rows} == {"field-control"}
        [rejected] = rows_of(rejects)
        assert rejected["field_key"] == "field-target"
        assert "value_kind" in rejected["failed_rule"]
        # raw_value must survive quarantine to diagnose; carried explicitly
        # rather than json.dumps(capture_value) since a null lands as NaN and
        # a number stays a Python scalar -- see discriminate_capture_value.
        if rejected_raw_value is _REJECTED_AS_NAN:
            assert pd.isna(rejected["raw_value"])
        else:
            assert rejected["raw_value"] == rejected_raw_value
        quarantine = next(
            r for r in run_log.records if r["step"].endswith(":quarantine")
        )
        assert quarantine["rows_quarantined"] >= 1
    else:
        kind, value_text, login, display = expected
        [target] = [row for row in rows if row["field_key"] == "field-target"]
        assert target["value_kind"] == kind
        assert target["value_text"] == value_text
        assert target["person_login"] == login
        assert target["person_display"] == display


# --- general_answer ----------------------------------------------------------


def test_the_answer_and_general_answer_tables_tile_one_blob_with_no_loss_or_overlap():
    # Driving one blob through both builders must partition its keys exactly.
    # A plain "general" key (no colon) belongs to the catch-all (answer); the
    # edge case "general:" (empty key) is included, landing as general_key == "".
    blob = {
        "q1": {"value": "A"},
        "q2": {"value": "B"},
        "general": {"value": "no prefix here"},
        "general:complaint-channel": {"value": "Phone"},
        "general:relationship": {"value": "Customer"},
        "general:": {"value": "empty key"},
    }
    answers_json = json.dumps(blob)

    question_ids = {row["question_id"] for row in silver_answers(answers_json)}
    general_rows = silver_general_answers(answers_json)
    assert_carries_the_five_stamps(general_rows, GeneralAnswerRow)
    # Re-prefixed, to compare in the blob's own vocabulary rather than the
    # stripped one the general_answer table stores.
    general_keys = {f"general:{row['general_key']}" for row in general_rows}

    assert "general" in question_ids
    assert question_ids & general_keys == set()
    assert question_ids | general_keys == set(blob)


def test_an_array_general_answer_is_canonicalised_rather_than_refused():
    [row] = silver_general_answers(
        json.dumps({"general:products": {"value": ["Current account", "Savings"]}})
    )

    assert row["value_text"] == "Current account|Savings"
    assert json.loads(row["value_json"]) == ["Current account", "Savings"]


# --- conversation_message ----------------------------------------------------


def test_a_conversation_becomes_one_row_per_message_carrying_the_five_stamps():
    messages = [
        {
            "author": {"loginName": "a.khan", "displayName": "Amira Khan"},
            "timestamp": "2026-08-04T16:02:00Z",
            "body": "Please confirm the call date.",
        },
        {
            "author": {"loginName": "b.okafor", "displayName": "Bola Okafor"},
            "timestamp": "2026-08-04T18:47:12.000Z",
            "body": "Confirmed -- the call was on the 30th.",
        },
    ]

    rows = silver_conversation_messages(json.dumps(messages))

    # seq is the message's position in the list -- the only key it has.
    assert [row["seq"] for row in rows] == list(range(len(messages)))
    # author is a nested object, lifted by two dotted paths rather than landed
    # as a JSON blob.
    for row, message in zip(rows, messages):
        assert row["author_login"] == message["author"]["loginName"]
        assert row["author_display_name"] == message["author"]["displayName"]
        assert row["body"] == message["body"]
    assert_carries_the_five_stamps(rows, ConversationMessageRow)


# --- appeal ------------------------------------------------------------------


def test_an_appeal_becomes_one_row_keyed_by_its_own_id_with_appeal_seq():
    rows = silver_appeals(json.dumps([appeal(id="appeal-1"), appeal(id="appeal-2")]))

    assert {row["appeal_id"] for row in rows} == {"appeal-1", "appeal-2"}
    assert {row["appeal_seq"] for row in rows} == {0, 1}
    assert_carries_the_five_stamps(rows, AppealRow)


def test_an_unresolved_appeal_carries_nulls_in_every_resolution_column():
    [row] = silver_appeals(json.dumps([appeal(state="raised")]))

    resolution_columns = [
        f.name for f in fields(AppealRow) if f.name.startswith("resolution_")
    ]
    assert resolution_columns
    assert all(row[column] is None for column in resolution_columns)


def test_cited_answer_keys_is_json_text_null_only_when_the_key_is_omitted():
    # Feed semantics, not the encoding mechanism (covered by ExplodeJsonList's
    # own suite): an omitted key is null, never "[]", which the app never writes.
    omitted, present = silver_appeals(
        json.dumps(
            [
                appeal(id="appeal-1"),
                appeal(
                    id="appeal-2",
                    citedAnswerKeys=["q-outcome", "q-timeliness"],
                ),
            ]
        )
    )

    # A mixed column lands the null as NaN, not None -- same quirk as
    # _REJECTED_AS_NAN above.
    assert pd.isna(omitted["cited_question_ids_json"])
    assert json.loads(present["cited_question_ids_json"]) == [
        "q-outcome",
        "q-timeliness",
    ]


def test_an_unknown_appeal_state_quarantines_while_the_good_appeal_lands():
    rejects = RecordingWriter()

    rows = silver_appeals(
        json.dumps([appeal(id="appeal-1"), appeal(id="appeal-2", state="withdrawn")]),
        rejects=rejects,
    )

    assert [row["appeal_id"] for row in rows] == ["appeal-1"]
    [rejected] = rows_of(rejects)
    assert rejected["appeal_id"] == "appeal-2"
    assert "state" in rejected["failed_rule"]


# --- case_detail -------------------------------------------------------------


def test_a_details_map_becomes_one_row_per_field_carrying_the_five_stamps():
    rows = silver_case_details(
        json.dumps({"complaintRef": "CMP-000101", "customerName": "Priya Shah"})
    )

    assert {row["field_key"] for row in rows} == {"complaintRef", "customerName"}
    assert_carries_the_five_stamps(rows, CaseDetailRow)


def test_an_empty_details_map_survives_every_step_as_a_zero_row_frame():
    # ExplodeJsonMap's own suite covers the zero-row output; only this feed's
    # test shows every step below tolerates that zero-row frame.
    assert silver_case_details("{}") == []


@pytest.mark.parametrize(
    "value",
    [
        pytest.param(3, id="an-int"),
        pytest.param(1.5, id="a-float"),
        pytest.param(True, id="a-bool"),
        pytest.param({"n": 1}, id="an-object"),
        pytest.param(["x"], id="an-array"),
    ],
)
def test_a_non_string_detail_value_lands_as_its_json_encoding(value):
    # Without encode_detail_value, the int/float/bool arms land value_text as
    # a non-string dtype and abort at SchemaValidator's is_string_dtype check.
    [row] = silver_case_details(json.dumps({"k": value}))

    assert isinstance(row["value_text"], str)
    assert json.loads(row["value_text"]) == value


def test_a_json_null_detail_value_lands_as_a_null_not_the_text_null():
    [row] = silver_case_details(json.dumps({"k": None}))

    assert row["value_text"] is None

```
