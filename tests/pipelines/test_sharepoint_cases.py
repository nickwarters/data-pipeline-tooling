"""Tests for the ``sharepoint_cases`` SharePoint list ingest.

Most of these drive a builder directly, in memory: a fake list client behind the
real Reader, `RecordingWriter` as the Writer, no SQLite and no filesystem. Only
the behaviours that *are* the store — append-only idempotence, a conflicting
re-observation, the checkpoint being left alone — go end to end under `tmp_path`.

No network, no tenant, no auth: the organisational SharePoint client is a seam,
so every test here hands the Reader a fake that replays frames.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from dataclasses import fields
from functools import partial
from uuid import UUID

import pandas as pd
import pytest

from framework.core import Dataset, ErrorCategory, Reader, ValidationError
from framework.io import AppendOnlyConflictError, DatasetReader
from framework.run import Pipeline, RunContext, RunLog, dry_run_pipeline
from framework.transform import JsonShapeError, Stamp
from pipelines.sharepoint_cases import gold
from pipelines.sharepoint_cases.gold import (
    ANSWER_REMEDIATION_DIMENSIONS,
    DETAIL_GRAIN,
    DETAIL_TABLES,
    GOLD_TABLES,
    UNASSIGNED,
    UNDECIDED,
    UNRESOLVED,
    UNSTAMPED,
    UNSTATED,
    age_buckets,
    answer_remediation,
    appeal_outcomes,
    case_counts,
    case_current_builder,
    gold_detail_builder,
)
from pipelines.sharepoint_cases.gold import throughput as throughput_transform
from pipelines.sharepoint_cases.pipeline import (
    EXPAND_FIELDS,
    FEED_NAME,
    RAW_FEED_COLUMNS,
    RENAME,
    SAFETY_LAG,
    SOURCE_COLUMNS,
    LocalJsonListClient,
    NoClientError,
    main,
    raw_builder,
    run,
    silver_answer_action_builder,
    silver_answer_builder,
    silver_answer_capture_builder,
    silver_appeal_builder,
    silver_builder,
    silver_case_detail_builder,
    silver_conversation_message_builder,
    silver_general_answer_builder,
    snake_case,
)
from pipelines.sharepoint_cases.schema import (
    CASE_LISTS,
    CASE_STATUSES,
    SITE,
    AnswerCaptureRow,
    AnswerRow,
    AppealRow,
    CaseDetailRow,
    CaseList,
    ConversationMessageRow,
    GeneralAnswerRow,
)
from tests._sharepoint_cases_fixtures import FakeListClient, item, items
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    read_rows,
    read_run_log,
    rows_of,
)
from tools.integrations.sharepoint_checkpoint import (
    SharePointCheckpointStore,
    SharePointSource,
)
from tools.integrations.sharepoint_rest import (
    ModifiedWindow,
    SharePointFeedError,
    SharePointModifiedReader,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

# Every column silver holds, in the order it holds them — which is exactly the
# feed's rename map read the other way round.
SILVER_COLUMNS = tuple(RENAME.values())

# Every column the silver answer hop lands, straight off AnswerRow's own fields.
ANSWER_COLUMNS = tuple(f.name for f in fields(AnswerRow))
# Likewise for the capture Detail Table one level further down.
CAPTURE_COLUMNS = tuple(f.name for f in fields(AnswerCaptureRow))
# Likewise for the general-answer Detail Table.
GENERAL_ANSWER_COLUMNS = tuple(f.name for f in fields(GeneralAnswerRow))
# Likewise for the two list-shaped Detail Tables.
CONVERSATION_MESSAGE_COLUMNS = tuple(f.name for f in fields(ConversationMessageRow))
APPEAL_COLUMNS = tuple(f.name for f in fields(AppealRow))
# Likewise for the case-detail Detail Table, exploded from `details`.
CASE_DETAIL_COLUMNS = tuple(f.name for f in fields(CaseDetailRow))

SERVER_NOW = dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc)
WINDOW = ModifiedWindow(start=None, end=SERVER_NOW - SAFETY_LAG)

COMPLAINTS = CASE_LISTS[0]
# A second list, declared here rather than in CASE_LISTS: only one Case Type is
# provisioned today, and multi-list behaviour still has to be proven.
OTHER = CaseList("other", "Cases-Other", SITE, UUID(int=7))
TWO_LISTS = (COMPLAINTS, OTHER)

SOURCE = SharePointSource(COMPLAINTS.site, COMPLAINTS.list_id)
OTHER_SOURCE = SharePointSource(OTHER.site, OTHER.list_id)

# How far a multi-run client's clock moves between polls. A successful run now
# commits the watermark, and `window()` answers `None` when the safe upper bound
# has not advanced past it — so a second `run()` against a *frozen* clock returns
# before it reaches the list, and a test meaning to poll twice must let time pass.
NEXT_POLL = dt.timedelta(minutes=10)

# The instant gold is published as of: the candidate window end of a first poll.
AS_OF = SERVER_NOW - SAFETY_LAG

# Every pipeline one poll of one list runs, in the run log's vocabulary.
EVERY_HOP = {
    f"{FEED_NAME}:raw:{COMPLAINTS.case_type}",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}:answer",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}:answer_capture",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}:answer_action",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}:general_answer",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}:conversation_message",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}:appeal",
    f"{FEED_NAME}:silver:{COMPLAINTS.case_type}:case_detail",
    *(f"{FEED_NAME}:gold:{table}" for table in GOLD_TABLES),
}


def source_reader(
    client: FakeListClient, case_list: CaseList = COMPLAINTS
) -> SharePointModifiedReader:
    """The feed's real Reader over a fake client."""
    return SharePointModifiedReader(
        case_list.site,
        case_list.list_name,
        SOURCE_COLUMNS,
        WINDOW,
        expand_fields=EXPAND_FIELDS,
        client=client,
    )


def landed(client: FakeListClient, case_list: CaseList = COMPLAINTS) -> list[dict]:
    """The rows the raw hop would store for ``client``'s response."""
    writer = RecordingWriter()
    raw_builder(source_reader(client, case_list), writer, case_list).run()
    return rows_of(writer)


# --- the declared lists -----------------------------------------------------


def test_the_declared_lists_are_distinct():
    # A shared case_type would silently merge two lists' Cases in gold, which
    # keys on it; a shared list_name would mint the same observation ids; and a
    # shared (site, list_id) would share one watermark. The GUIDs are all
    # placeholders today, so the last is a live mistake to make.
    assert len({case_list.case_type for case_list in CASE_LISTS}) == len(CASE_LISTS)
    assert len({case_list.list_name for case_list in CASE_LISTS}) == len(CASE_LISTS)
    assert len({(c.site, c.list_id) for c in CASE_LISTS}) == len(CASE_LISTS)


# --- the rename ------------------------------------------------------------


@pytest.mark.parametrize(
    "source, canonical",
    [
        ("Id", "id"),
        ("DueDate", "due_date"),
        ("AssignedReviewerId", "assigned_reviewer_id"),
        ("HasOpenAppeal", "has_open_appeal"),
        ("ResponsibleParty/Title", "responsible_party_title"),
        # Already canonical: the stamped provenance columns need no special case.
        ("source_observation_id", "source_observation_id"),
    ],
)
def test_the_rename_is_one_mechanical_rule(source, canonical):
    assert snake_case(source) == canonical


def test_every_stored_column_has_a_canonical_name():
    assert set(RENAME) == set(RAW_FEED_COLUMNS)


# --- raw -------------------------------------------------------------------


def test_raw_keeps_the_source_names_and_the_stamped_observation():
    [row] = landed(FakeListClient())

    assert row["Title"] == "CMP-000101"
    assert row["Status"] == "In-progress"
    assert row["Details"] is None
    assert row["source_list_name"] == COMPLAINTS.list_name
    assert row["source_item_id"] == "101"
    assert row["source_version"] == '"3"'
    assert len(row["source_observation_id"]) == 64
    # source_modified_at and source_version say what Modified and the etag said,
    # so raw does not also carry them -- nor when we happened to look.
    assert not {"Modified", "odata.etag", "observed_at"} & set(row)


def test_an_expanded_person_is_flattened_onto_its_selected_sub_fields():
    # SharePoint answers an expanded lookup as a nested object on the property.
    # A tabular carrier has nowhere to put that, so the feed undoes the nesting
    # -- and only for the sub-fields the read actually selected.
    [row] = landed(FakeListClient())

    assert row["AssignedReviewer/Name"] == "i:0#.w|CONTOSO\\a.khan"
    assert row["ResponsibleParty/Name"] == "i:0#.w|CONTOSO\\b.okafor"
    assert row["ResponsibleParty/Title"] == "Bola Okafor"
    assert row["ResponsiblePartyManager/Name"] == "i:0#.w|CONTOSO\\e.novak"
    # The nested property itself does not survive into raw.
    assert "ResponsibleParty" not in row


def test_a_role_nobody_holds_lands_as_nulls_rather_than_failing():
    # The nobody case is a plain null on the property, not an object of nulls.
    client = FakeListClient(items(item(AssignedReviewer=None, ResponsibleParty=None)))

    [row] = landed(client)

    assert row["AssignedReviewer/Name"] is None
    assert row["ResponsibleParty/Name"] is None
    assert row["ResponsibleParty/Title"] is None
    assert row["VoidedBy/Name"] is None


def test_a_person_column_that_is_neither_an_object_nor_null_is_refused():
    client = FakeListClient(items(item(ResponsibleParty="i:0#.w|CONTOSO\\b.okafor")))

    with pytest.raises(SharePointFeedError, match="item 101.*'ResponsibleParty'"):
        raw_builder(source_reader(client), RecordingWriter(), COMPLAINTS).run()


def test_a_person_with_no_display_name_keeps_the_identity_the_read_returned():
    # A directory display name is optional; the claims login is not. Refusing the
    # row for a missing Title would abort a poll over a shape the list really holds.
    client = FakeListClient(
        items(item(ResponsibleParty={"Name": "i:0#.w|CONTOSO\\b.okafor"}))
    )

    [row] = landed(client)

    assert row["ResponsibleParty/Name"] == "i:0#.w|CONTOSO\\b.okafor"
    assert row["ResponsibleParty/Title"] is None


def test_an_unexpanded_person_is_refused_rather_than_read_as_nobody():
    # Some metadata modes answer an unexpanded lookup with a reference envelope
    # rather than omitting the property; taking that object at face value would
    # report a broken $expand as a role nobody holds.
    deferred = {"__deferred": {"uri": "https://sp.example.com/_api/Web/Lists(1)"}}
    client = FakeListClient(items(item(ResponsibleParty=deferred)))

    with pytest.raises(SharePointFeedError, match="was not expanded"):
        raw_builder(source_reader(client), RecordingWriter(), COMPLAINTS).run()


def test_the_read_asks_for_the_star_and_expands_every_person():
    # The star is load-bearing: naming a person's sub-field turns the read into
    # a projection, and every other column silently stops coming back.
    client = FakeListClient()

    landed(client)

    assert client.calls[0]["select_fields"][:3] == ["Id", "Modified", "*"]
    assert client.calls[0]["expand_fields"] == [
        "AssignedReviewer",
        "ResponsibleParty",
        "AssignedReviewerManager",
        "ResponsiblePartyManager",
        "VoidedBy",
    ]


def test_raw_reads_a_quiet_window_as_the_declared_shape():
    # Almost every column arrives because the client expanded the star, so none
    # of them can be there when there are no rows; the shape is declared anyway.
    writer = RecordingWriter()

    raw_builder(source_reader(FakeListClient(pd.DataFrame())), writer, COMPLAINTS).run()

    assert rows_of(writer) == []
    assert list(writer.writes[0].to_pandas().columns) == list(RAW_FEED_COLUMNS)


def test_a_populated_response_missing_a_stored_column_is_refused():
    # The projection has to select every stored column to build the row at all,
    # so this is where a broken promise surfaces -- named, and before anything
    # lands.
    client = FakeListClient(items(item()).drop(columns=["Status"]))

    with pytest.raises(SharePointFeedError, match="Status"):
        raw_builder(source_reader(client), RecordingWriter(), COMPLAINTS).run()


# --- silver ----------------------------------------------------------------


def test_silver_snake_cases_coerces_and_keeps_the_provenance():
    writer = RecordingWriter()

    silver_builder(given_rows(landed(FakeListClient())), writer, COMPLAINTS).run()

    [row] = rows_of(writer)
    assert row["id"] == 101
    assert row["title"] == "CMP-000101"
    assert row["case_type"] == "complaints"
    assert row["responsible_party_title"] == "Bola Okafor"
    assert row["due_date"] == pd.Timestamp("2026-08-14T00:00:00Z")
    assert row["has_open_appeal"] is False
    assert row["source_item_id"] == "101"
    assert row["source_version"] == '"3"'


@pytest.mark.parametrize("cell", [None, "misfiled", "complaints"])
def test_silver_settles_the_case_type_to_the_polled_lists_declared_one(cell):
    # The list's own CaseType cell is nullable and editable by hand, and gold
    # keys a Case on it, so silver replaces it with the declared value. Raw
    # keeps the cell as the list holds it.
    raw = landed(
        FakeListClient(items(item(CaseType=cell))),
        OTHER,
    )
    writer = RecordingWriter()

    silver_builder(given_rows(raw), writer, OTHER).run()

    assert raw[0]["CaseType"] == cell
    assert rows_of(writer)[0]["case_type"] == "other"


def test_silver_accepts_a_case_with_no_reference_and_nobody_assigned():
    # Title is the human Case Reference: nullable, and carrying no format any
    # part of the application enforces. A row without one is an ordinary row.
    client = FakeListClient(items(item(Title=None, AssignedReviewer=None)))
    writer = RecordingWriter()

    silver_builder(given_rows(landed(client)), writer, COMPLAINTS).run()

    [row] = rows_of(writer)
    assert row["title"] is None
    assert row["assigned_reviewer_name"] is None


@pytest.mark.parametrize("status", CASE_STATUSES)
def test_silver_accepts_every_real_status(status):
    writer = RecordingWriter()

    silver_builder(
        given_rows(landed(FakeListClient(items(item(Status=status))))),
        writer,
        COMPLAINTS,
    ).run()

    assert rows_of(writer)[0]["status"] == status


def test_silver_quarantines_an_unknown_status_while_raw_keeps_every_row():
    # The one closed vocabulary this list has. A fifth value means the Choice
    # column changed under us, which should surface rather than reach a report.
    client = FakeListClient(items(item(), item(Id=102, Status="Closed")))
    raw = landed(client)
    writer, rejects = RecordingWriter(), RecordingWriter()
    run_log = RecordingRunLog()

    silver_builder(given_rows(raw), writer, COMPLAINTS, rejects, run_log=run_log).run()

    quarantine = next(r for r in run_log.records if r["step"] == "quarantine")
    assert quarantine["rows_in"] == 2
    assert quarantine["rows_out"] == 1
    assert quarantine["rows_quarantined"] == 1

    assert len(raw) == 2
    assert [row["source_item_id"] for row in rows_of(writer)] == ["101"]
    [rejected] = rows_of(rejects)
    assert rejected["source_item_id"] == "102"
    assert rejected["failed_rule"] == (
        "column 'status' has value(s) outside "
        "{'Actions In Progress', 'Completed', 'In-progress', 'Void'}"
    )


def test_silver_aborts_when_the_id_is_missing():
    # Structural, not a value rule: a Case with no id cannot be a Case version.
    writer = RecordingWriter()
    reader = given_rows([{column: None for column in RAW_FEED_COLUMNS}])

    with pytest.raises(ValidationError, match="'id'"):
        silver_builder(reader, writer, COMPLAINTS).run()

    assert writer.writes == []


# --- silver: the answer explode ----------------------------------------------

# One silver CaseVersion-shaped row carrying the given `answers` blob, for the
# answer hop's own builder-level tests. Reuses `version()`, defined below: its
# stamps (case_type, source_item_id, ...) are exactly DETAIL_ID_VARS, which is
# the point being tested.


def silver_answers(
    answers_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive the silver answer hop, in memory, over one observation's `answers`."""
    writer = RecordingWriter()
    silver_answer_builder(
        given_rows([version(answers=answers_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    ).run()
    return rows_of(writer)


def test_an_answer_map_becomes_one_row_per_question_carrying_the_five_stamps():
    # general:complaint-channel belongs to the General Question table, not this
    # one, and must not survive the explode.
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
    for row in rows:
        assert set(row) == set(ANSWER_COLUMNS)
        assert row["case_type"] == COMPLAINTS.case_type
        assert row["source_item_id"] == "101"
        assert row["source_version"] == '"3"'
        assert row["source_modified_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
        assert len(row["source_observation_id"]) > 0


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
        reject_writer=rejects,
    )

    assert [row["question_id"] for row in rows] == ["q1"]
    [rejected] = rows_of(rejects)
    assert rejected["question_id"] == "q2"
    assert "remediation_status" in rejected["failed_rule"]


# --- silver: the capture and action explodes ---------------------------------

# Reuses version(), defined below: its stamps (case_type, source_item_id, ...)
# are exactly DETAIL_ID_VARS, which is the point being tested.


def silver_captures(
    answers_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
    run_log: RunLog | None = None,
) -> list[dict]:
    """Drive the silver answer-capture hop, in memory, over one observation's
    `answers`."""
    writer = RecordingWriter()
    silver_answer_capture_builder(
        given_rows([version(answers=answers_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
        run_log,
    ).run()
    return rows_of(writer)


def test_a_capture_map_becomes_one_row_per_field_carrying_the_five_stamps():
    # The two-level chain: the answers map's own explode, then the capture
    # map's -- raw_value and capture_json must never reach the writer.
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
    for row in rows:
        assert set(row) == set(CAPTURE_COLUMNS)
        assert row["question_id"] == "q1"
        assert row["case_type"] == COMPLAINTS.case_type
        assert row["source_item_id"] == "101"
        assert row["source_version"] == '"3"'
        assert row["source_modified_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
        assert len(row["source_observation_id"]) > 0


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
            # A JSON null lands as a pandas NaN, not the string "null" a
            # json.dumps-derived expectation would assume -- and NaN != NaN,
            # so the assertion below special-cases this marker with pd.isna().
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
    # A control field alongside the field under test, so a quarantined shape
    # is proven to leave its sibling field landing rather than aborting the
    # whole answer.
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
        reject_writer=rejects,
        run_log=run_log,
    )

    if expected is None:
        [control] = [row for row in rows if row["field_key"] == "field-control"]
        assert control["value_kind"] == "text"
        assert {row["field_key"] for row in rows} == {"field-control"}
        [rejected] = rows_of(rejects)
        assert rejected["field_key"] == "field-target"
        assert "value_kind" in rejected["failed_rule"]
        # Pins DropColumns sitting after quarantine: the offending value must
        # still be there to diagnose. Carried explicitly rather than derived
        # with json.dumps(capture_value): a JSON null lands as NaN, not the
        # text "null", and a bare number lands as its own Python scalar, not
        # stringified -- see discriminate_capture_value.
        if rejected_raw_value is _REJECTED_AS_NAN:
            assert pd.isna(rejected["raw_value"])
        else:
            assert rejected["raw_value"] == rejected_raw_value
        quarantine = next(r for r in run_log.records if r["step"] == "quarantine")
        assert quarantine["rows_quarantined"] >= 1
    else:
        kind, value_text, login, display = expected
        [target] = [row for row in rows if row["field_key"] == "field-target"]
        assert target["value_kind"] == kind
        assert target["value_text"] == value_text
        assert target["person_login"] == login
        assert target["person_display"] == display


# --- silver: the general answer explode ---------------------------------------


def silver_general_answers(
    answers_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive the silver general-answer hop, in memory, over one observation's
    `answers`."""
    writer = RecordingWriter()
    silver_general_answer_builder(
        given_rows([version(answers=answers_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    ).run()
    return rows_of(writer)


def test_the_answer_and_general_answer_tables_tile_one_blob_with_no_loss_or_overlap():
    # The central invariant this slice exists for: driving one blob through
    # both builders must partition its keys exactly, catch-all side included.
    # A plain "general" key (no colon) carries no prefix and belongs to the
    # catch-all -- answer, the exclude side. "general:" (empty key) is the
    # other edge -- included, and lands with general_key == "".
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
    assert set(general_rows[0]) == set(GENERAL_ANSWER_COLUMNS)
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


# --- silver: the conversation-message explode ---------------------------------


def silver_conversation_messages(
    conversation_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive the silver conversation-message hop, in memory, over one
    observation's `conversation`."""
    writer = RecordingWriter()
    silver_conversation_message_builder(
        given_rows([version(conversation=conversation_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    ).run()
    return rows_of(writer)


def test_a_conversation_becomes_one_row_per_message_carrying_the_five_stamps():
    rows = silver_conversation_messages(
        json.dumps(
            [
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
        )
    )

    assert [row["seq"] for row in rows] == [0, 1]
    # author is a nested object ({loginName, displayName}); landing it whole
    # would put a JSON blob in the table built to remove them, so it is
    # lifted by two dotted paths instead.
    assert rows[0]["author_login"] == "a.khan"
    assert rows[0]["author_display_name"] == "Amira Khan"
    for row in rows:
        assert set(row) == set(CONVERSATION_MESSAGE_COLUMNS)
        assert row["case_type"] == COMPLAINTS.case_type
        assert row["source_item_id"] == "101"
        assert row["source_version"] == '"3"'
        assert row["source_modified_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
        assert len(row["source_observation_id"]) > 0


# --- silver: the appeal explode ------------------------------------------------


def silver_appeals(
    appeals_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive the silver appeal hop, in memory, over one observation's `appeals`."""
    writer = RecordingWriter()
    silver_appeal_builder(
        given_rows([version(appeals=appeals_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    ).run()
    return rows_of(writer)


def appeal(**overrides: object) -> dict[str, object]:
    """One Appeal element in the shape the app writes it: raised, no
    citations, no resolution -- overridden per test."""
    row: dict[str, object] = {
        "id": "appeal-1754040000000",
        "appellant": "e.novak",
        "at": "2026-08-01T09:00:00Z",
        "rationale": "The redress figure had already been paid directly.",
        "state": "raised",
    }
    row.update(overrides)
    return row


def test_an_appeal_becomes_one_row_keyed_by_its_own_id_with_appeal_seq():
    rows = silver_appeals(json.dumps([appeal(id="appeal-1"), appeal(id="appeal-2")]))

    assert {row["appeal_id"] for row in rows} == {"appeal-1", "appeal-2"}
    assert {row["appeal_seq"] for row in rows} == {0, 1}
    for row in rows:
        assert set(row) == set(APPEAL_COLUMNS)


def test_an_unresolved_appeal_carries_nulls_in_every_resolution_column():
    # Absent, not a missing row: an Appeal without a resolution key must not
    # crash the coercion, and must still land as a row.
    [row] = silver_appeals(json.dumps([appeal(state="raised")]))

    assert row["resolution_verdict"] is None
    assert row["resolution_rationale"] is None
    assert row["resolution_resolver"] is None
    assert row["resolution_at"] is None


def test_cited_answer_keys_is_json_text_null_only_when_the_key_is_omitted():
    # The mechanism (ExplodeJsonList's JSON encoding) is proven by its own
    # suite -- what this pins is feed semantics: an omitted key is null, not
    # "no citations" spelled "[]", which the app never writes.
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

    # A mixed column (one row null, one populated) lands the null as NaN
    # rather than None -- see the _REJECTED_AS_NAN sentinel above for the same
    # pandas quirk.
    assert pd.isna(omitted["cited_question_ids_json"])
    assert json.loads(present["cited_question_ids_json"]) == [
        "q-outcome",
        "q-timeliness",
    ]


def test_an_unknown_appeal_state_quarantines_while_the_good_appeal_lands():
    rejects = RecordingWriter()

    rows = silver_appeals(
        json.dumps([appeal(id="appeal-1"), appeal(id="appeal-2", state="withdrawn")]),
        reject_writer=rejects,
    )

    assert [row["appeal_id"] for row in rows] == ["appeal-1"]
    [rejected] = rows_of(rejects)
    assert rejected["appeal_id"] == "appeal-2"
    assert "state" in rejected["failed_rule"]


# --- silver: the case-detail explode -----------------------------------------


def silver_case_details(
    details_json: str | None,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive the silver case-detail hop, in memory, over one observation's
    `details`."""
    writer = RecordingWriter()
    silver_case_detail_builder(
        given_rows([version(details=details_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    ).run()
    return rows_of(writer)


def test_a_details_map_becomes_one_row_per_field_carrying_the_five_stamps():
    rows = silver_case_details(
        json.dumps({"complaintRef": "CMP-000101", "customerName": "Priya Shah"})
    )

    assert {row["field_key"] for row in rows} == {"complaintRef", "customerName"}
    for row in rows:
        assert set(row) == set(CASE_DETAIL_COLUMNS)
        assert row["case_type"] == COMPLAINTS.case_type
        assert row["source_item_id"] == "101"
        assert row["source_version"] == '"3"'
        # A str declaration would abort here if this arrived untyped.
        assert row["source_modified_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
        assert len(row["source_observation_id"]) > 0


def test_an_empty_details_map_survives_the_whole_hop_as_a_zero_row_frame():
    # ExplodeJsonMap contributing no rows for an absent/null/blank/empty blob
    # is covered by the framework's own suite; what only this feed's test can
    # show is that the whole hop -- explode, encode_detail_value, coerce,
    # quarantine, validate -- tolerates the zero-row frame that falls out the
    # other end.
    assert silver_case_details("{}") == []


@pytest.mark.parametrize(
    "value, expected",
    [
        pytest.param(3, "3", id="an-int"),
        pytest.param(1.5, "1.5", id="a-float"),
        pytest.param(True, "true", id="a-bool"),
        pytest.param({"n": 1}, '{"n": 1}', id="an-object"),
        pytest.param(["x"], '["x"]', id="an-array"),
        pytest.param(None, None, id="a-json-null"),
    ],
)
def test_a_non_string_detail_value_lands_as_its_json_encoding(value, expected):
    # One key per map, so each case is also an all-one-type batch. Without
    # encode_detail_value, the int/float/bool arms land value_text as a
    # non-string dtype and abort the whole poll at SchemaValidator's
    # is_string_dtype check -- only the object/null arms would happen to
    # survive by accident.
    [row] = silver_case_details(json.dumps({"k": value}))

    assert row["value_text"] == expected


# --- gold: the current-state rule -------------------------------------------


def version(**overrides: object) -> dict[str, object]:
    """One silver row — one observation of a Case — in gold's own vocabulary.

    Every silver column is present, because gold reads a landed table and not a
    tidy projection of one. The observation id is derived from the item and the
    version, as the Reader derives it, unless a test names its own.
    """
    row: dict[str, object] = dict.fromkeys(SILVER_COLUMNS)
    row.update(
        {
            "id": 101,
            "status": "In-progress",
            "assigned_reviewer_name": "i:0#.w|CONTOSO\\p.shah",
            "assigned_reviewer_manager_name": "i:0#.w|CONTOSO\\d.reid",
            "case_type": COMPLAINTS.case_type,
            "created": "2026-07-01 09:14:00+00:00",
            "source_list_name": COMPLAINTS.list_name,
            "source_item_id": "101",
            "source_version": '"3"',
            "source_modified_at": "2026-08-05 08:10:00+00:00",
        }
    )
    row.update(overrides)
    if row["source_observation_id"] is None:
        row["source_observation_id"] = (
            f"{row['source_item_id']}@{row['source_version']}"
        )
    return row


def gold_rows(builder, rows: list[dict], *, as_of: dt.datetime = AS_OF) -> list[dict]:
    """Drive one gold hop in memory and hand back what it would have written."""
    writer = RecordingWriter()
    builder(given_rows(rows), writer, as_of=as_of).run()
    return rows_of(writer)


def current(*rows: dict) -> list[dict]:
    """The ``case_current`` rows for a silver history."""
    return gold_rows(case_current_builder, list(rows))


def test_two_versions_of_one_case_reduce_to_the_later_status():
    rows = current(
        version(source_version='"3"', source_modified_at="2026-08-05 08:10:00+00:00"),
        version(
            source_version='"4"',
            source_modified_at="2026-08-05 08:45:00+00:00",
            status="Completed",
        ),
    )

    assert [(row["source_item_id"], row["status"]) for row in rows] == [
        ("101", "Completed")
    ]


def test_two_cases_stay_two_current_rows_with_distinct_ids():
    rows = current(version(), version(id=102, source_item_id="102"))

    # Ordered by the derived case_id, which is deterministic but not the item
    # order: the reduction sorts by key, and the key is a uuid5.
    assert {row["source_item_id"] for row in rows} == {"101", "102"}
    assert len({row["case_id"] for row in rows}) == 2


@pytest.mark.parametrize(
    "earlier, later",
    [
        # An ETag, and the reason not to compare these as text: "10" sorts
        # before "9" lexically, so a text tie-break would resolve backwards.
        ('"9"', '"10"'),
        # The weak-ETag form, which carries a W/ prefix as well as the quotes.
        ('W/"9"', 'W/"10"'),
        # The comma form SharePoint uses for a major,minor ETag.
        ('"4,1"', '"4,2"'),
        # The dotted UI version, which is a different shape of the same idea.
        ("3.0", "10.0"),
        ("512.0", "512.1"),
    ],
)
def test_a_same_modified_tie_is_broken_by_the_parsed_version(earlier, later):
    # Two versions of one item really can share a Modified to the second, and
    # append-only silver keeps both, so this tie is reachable.
    tied = "2026-08-05 08:10:00+00:00"
    rows = current(
        version(source_version=later, source_modified_at=tied, status="Completed"),
        version(source_version=earlier, source_modified_at=tied),
    )

    assert [row["status"] for row in rows] == ["Completed"]


def test_a_versionless_observation_loses_to_a_versioned_one_at_the_same_modified():
    # A row that arrived with no version at all falls back to a sha256 digest,
    # which is not a version and must not out-sort one. It sorts at -1 rather
    # than NA, because pandas sorts NA *last*.
    tied = "2026-08-05 08:10:00+00:00"
    rows = current(
        version(source_version='"3"', source_modified_at=tied, status="Completed"),
        version(source_version="a" * 64, source_modified_at=tied),
    )

    assert [row["status"] for row in rows] == ["Completed"]


def test_two_versionless_observations_are_separated_by_the_observation_id():
    # Both sit in the same unparseable bucket, so only the deterministic
    # observation id is left. Which one wins is arbitrary; that it is the same
    # one every time is the guarantee.
    tied = "2026-08-05 08:10:00+00:00"
    args = (
        version(
            source_version="a" * 64,
            source_modified_at=tied,
            source_observation_id="aaa",
        ),
        version(
            source_version="b" * 64,
            source_modified_at=tied,
            source_observation_id="bbb",
            status="Completed",
        ),
    )

    assert [row["source_observation_id"] for row in current(*args)] == ["bbb"]
    assert [row["source_observation_id"] for row in current(*reversed(args))] == ["bbb"]


def test_an_unparseable_modified_stamp_stops_the_reduction():
    # Silver declares source_modified_at non-null and typed, so this cannot
    # honestly arrive — and coercing it to NaT would sort the bad row *last* and
    # hand it the Case, which is exactly the trap the version parse avoids.
    with pytest.raises(ValueError):
        current(
            version(),
            version(source_version='"4"', source_modified_at="not a timestamp"),
        )


def test_every_current_row_carries_the_candidate_window_end():
    [row] = current(version())

    assert row["as_of_utc"] == AS_OF.isoformat()


def test_current_gold_republishes_every_silver_column():
    [row] = current(version())

    assert set(SILVER_COLUMNS) <= set(row)
    assert set(row) - set(SILVER_COLUMNS) == {"case_id", "as_of_utc"}


# --- gold: the Detail Table reduction ----------------------------------------

# One representative grain: the builder is generic over DETAIL_GRAIN, and these
# tests exercise the composition, not a per-table peculiarity.
DETAIL_TABLE = "answer"


def winning_reader(*rows: dict) -> Reader:
    """The gold ``case_current`` a parent observation history would produce.

    Composes the real ``case_current_builder`` rather than hand-building the
    winning pairs: the invariant worth testing is that a Detail row agrees with
    whichever observation the parent's own reduction picked, not that an inner
    join drops non-matching rows.
    """
    return given_rows(current(*rows))


def child(
    *,
    source_item_id: str = "101",
    case_type: str = COMPLAINTS.case_type,
    source_observation_id: str,
    question_id: str = "q1",
) -> dict:
    """One row of a child history, in the shape a silver Detail Table would carry.

    ``case_type``/``source_item_id`` match ``version()``'s defaults, so the
    derived ``case_id`` lines up with the parent's for the same Case.
    """
    return {
        "source_item_id": source_item_id,
        "case_type": case_type,
        "source_observation_id": source_observation_id,
        "question_id": question_id,
        "field_value": "Not upheld",
    }


def details(
    children: list[dict],
    winners: Reader,
    *,
    grain: tuple[str, ...] = DETAIL_GRAIN[DETAIL_TABLE],
) -> list[dict]:
    """Drive ``gold_detail_builder`` over a child history, in memory."""
    return gold_rows(
        partial(
            gold_detail_builder,
            grain=grain,
            observations=winners,
            name=f"{FEED_NAME}:gold:detail:{DETAIL_TABLE}",
        ),
        children,
    )


def test_a_child_stripped_from_the_winning_observation_does_not_survive():
    # Two observations of one Case; the second strips question 2's child row
    # and adds question 3. Every surviving row must carry the winner's id.
    v1 = version(
        source_observation_id="obs-1",
        source_version='"3"',
        source_modified_at="2026-08-05 08:10:00+00:00",
    )
    v2 = version(
        source_observation_id="obs-2",
        source_version='"4"',
        source_modified_at="2026-08-05 08:45:00+00:00",
        status="Completed",
    )
    winners = winning_reader(v1, v2)
    children = [
        child(source_observation_id="obs-1", question_id="q1"),
        child(source_observation_id="obs-1", question_id="q2"),
        child(source_observation_id="obs-2", question_id="q1"),
        child(source_observation_id="obs-2", question_id="q3"),
    ]

    rows = details(children, winners)

    assert {row["question_id"] for row in rows} == {"q1", "q3"}
    assert {row["source_observation_id"] for row in rows} == {"obs-2"}


def _two_observations(item_id: str, prefix: str) -> tuple[dict, dict]:
    """An early and a winning observation of one Case, ids prefixed for a test."""
    early = version(
        id=int(item_id),
        source_item_id=item_id,
        source_observation_id=f"{prefix}-1",
        source_version='"3"',
        source_modified_at="2026-08-05 08:10:00+00:00",
    )
    late = version(
        id=int(item_id),
        source_item_id=item_id,
        source_observation_id=f"{prefix}-2",
        source_version='"4"',
        source_modified_at="2026-08-05 08:45:00+00:00",
        status="Completed",
    )
    return early, late


def test_two_cases_do_not_take_each_others_children():
    a1, a2 = _two_observations("101", "a")
    b1, b2 = _two_observations("102", "b")
    winners = winning_reader(a1, a2, b1, b2)
    children = [
        child(source_item_id="101", source_observation_id="a-1", question_id="stale"),
        child(source_item_id="101", source_observation_id="a-2", question_id="q1"),
        child(source_item_id="102", source_observation_id="b-1", question_id="stale"),
        child(source_item_id="102", source_observation_id="b-2", question_id="q1"),
    ]

    rows = details(children, winners)

    assert len(rows) == 2
    assert len({row["case_id"] for row in rows}) == 2
    assert {row["source_observation_id"] for row in rows} == {"a-2", "b-2"}


def test_a_gold_detail_row_is_the_childs_columns_plus_case_id_and_as_of():
    # The semi-join guarantee: a Detail row carries nothing from the parent
    # beyond the two winner columns it joined on.
    winners = winning_reader(version(source_observation_id="obs-1"))
    [row] = details([child(source_observation_id="obs-1")], winners)

    assert set(row) == set(child(source_observation_id="obs-1")) | {
        "case_id",
        "as_of_utc",
    }
    assert "status" not in row


def test_a_repeated_grain_value_in_the_winning_observation_aborts_the_hop():
    winners = winning_reader(version(source_observation_id="obs-1"))
    writer = RecordingWriter()
    children = [
        child(source_observation_id="obs-1", question_id="q1"),
        child(source_observation_id="obs-1", question_id="q1"),
    ]

    with pytest.raises(ValidationError, match="question_id"):
        gold_detail_builder(
            given_rows(children),
            writer,
            grain=DETAIL_GRAIN[DETAIL_TABLE],
            observations=winners,
            as_of=AS_OF,
            name=f"{FEED_NAME}:gold:detail:{DETAIL_TABLE}",
        ).run()

    assert writer.writes == []


def test_current_gold_carries_the_join_key_for_detail_tables():
    # Nothing else states this column is load-bearing for a second table:
    # winning_observations projects case_current down to it, so a future
    # change to latest_case_version that dropped it would silently break
    # every Detail Table's join with no error to catch it.
    [row] = current(version())

    assert "source_observation_id" in row


# --- gold: the current counts ------------------------------------------------


def given_columns(*names: str) -> Reader:
    """A zero-**row**, declared-column source -- what a quiet poll really hands
    an aggregate transform, unlike ``given_rows([])``'s zero-**column** frame,
    which no production path emits.
    """
    return DatasetReader(Dataset.from_pandas(pd.DataFrame(columns=list(names))))


def aggregate_pipeline(reader, writer, *, table: str, transform, step: str) -> Pipeline:
    """Wire one aggregate hop exactly as ``publish_gold``'s loop does."""
    p = Pipeline(f"{FEED_NAME}:gold:{table}")
    node = p.read(reader, name="read")
    node = p.transform(transform, node, name=step)
    node = p.transform(Stamp("as_of_utc", AS_OF.isoformat()), node, name="stamp-as-of")
    p.write(writer, node, name="write")
    return p


def aggregate(transform, step: str, rows: list[dict]) -> list[dict]:
    """Drive one aggregate hop, as ``publish_gold`` wires it, over ``rows``."""
    writer = RecordingWriter()
    aggregate_pipeline(
        given_rows(rows),
        writer,
        table="table",
        transform=transform,
        step=step,
    ).run()
    return rows_of(writer)


def counts(*rows: dict) -> list[dict]:
    return aggregate(case_counts, "count-by-reviewer-and-status", current(*rows))


def grain(rows: list[dict]) -> list[tuple]:
    return [
        (
            row["assigned_reviewer_name"],
            row["assigned_reviewer_manager_name"],
            row["status"],
            row["case_count"],
        )
        for row in rows
    ]


def test_current_counts_match_the_current_table():
    # Two Cases with one reviewer, split by status, and a third under a second
    # reviewer reporting to a different manager.
    rows = counts(
        version(),
        version(id=102, source_item_id="102", status="Completed"),
        version(
            id=103,
            source_item_id="103",
            assigned_reviewer_name="i:0#.w|CONTOSO\\r.okafor",
            assigned_reviewer_manager_name="i:0#.w|CONTOSO\\z.hale",
        ),
    )

    assert grain(rows) == [
        ("i:0#.w|CONTOSO\\p.shah", "i:0#.w|CONTOSO\\d.reid", "Completed", 1),
        ("i:0#.w|CONTOSO\\p.shah", "i:0#.w|CONTOSO\\d.reid", "In-progress", 1),
        ("i:0#.w|CONTOSO\\r.okafor", "i:0#.w|CONTOSO\\z.hale", "In-progress", 1),
    ]
    assert {row["as_of_utc"] for row in rows} == {AS_OF.isoformat()}


def test_the_reviewer_leads_the_grain_and_the_manager_rolls_it_up():
    # Two reviewers under one manager. The rows are per reviewer, and a count
    # per manager is their sum — one table, not two that could disagree.
    rows = counts(
        version(),
        version(
            id=102,
            source_item_id="102",
            assigned_reviewer_name="i:0#.w|CONTOSO\\r.okafor",
        ),
    )

    assert grain(rows) == [
        ("i:0#.w|CONTOSO\\p.shah", "i:0#.w|CONTOSO\\d.reid", "In-progress", 1),
        ("i:0#.w|CONTOSO\\r.okafor", "i:0#.w|CONTOSO\\d.reid", "In-progress", 1),
    ]
    assert sum(row["case_count"] for row in rows) == 2


def test_a_case_with_nobody_assigned_is_counted_as_unassigned():
    # A NULL group key is a hole in the grain that a reader may silently drop,
    # so this Case is counted under a literal instead — in a table whose whole
    # job is to add up to the number of current Cases. Both Person dimensions
    # are filled, because an unassigned Case has neither.
    rows = counts(
        version(assigned_reviewer_name=None, assigned_reviewer_manager_name=None)
    )

    assert grain(rows) == [(UNASSIGNED, UNASSIGNED, "In-progress", 1)]


# --- gold: the age profile ---------------------------------------------------


def aged(*rows: dict) -> list[dict]:
    return aggregate(partial(age_buckets, as_of=AS_OF), "bucket-by-age", current(*rows))


def created_days_before(age: int) -> str:
    """A ``created`` stamp exactly ``age`` local calendar days before ``as_of``."""
    return f"{AS_OF.date() - dt.timedelta(days=age)} 09:14:00+00:00"


@pytest.mark.parametrize(
    "age, label, order",
    [
        (0, "0-7 days", 0),
        (7, "0-7 days", 0),
        (8, "8-14 days", 1),
        (14, "8-14 days", 1),
        (15, "15-30 days", 2),
        (30, "15-30 days", 2),
        (31, "31-60 days", 3),
        (60, "31-60 days", 3),
        (61, "61+ days", 4),
    ],
)
def test_an_age_falls_in_exactly_one_declared_bucket(age, label, order):
    [row] = aged(version(created=created_days_before(age)))

    assert (row["age_bucket"], row["age_bucket_order"]) == (label, order)
    assert row["case_count"] == 1
    assert row["as_of_utc"] == AS_OF.isoformat()


def test_a_case_with_no_created_date_has_an_unknown_age():
    [row] = aged(version(created=None))

    assert (row["age_bucket"], row["age_bucket_order"]) == ("unknown", 5)


def test_a_case_created_after_the_as_of_instant_is_unknown_rather_than_clamped():
    # Impossible while created <= Modified < as_of, so if it happens it is
    # corruption and belongs somewhere visible.
    [row] = aged(version(created=created_days_before(-3)))

    assert row["age_bucket"] == "unknown"


def test_every_current_case_lands_in_exactly_one_age_bucket():
    # The docs claim the age profile totals to the number of current Cases —
    # every Case in one bucket, `unknown` catching the ones with no created date.
    history = (
        version(created=created_days_before(2)),
        version(id=102, source_item_id="102", created=created_days_before(40)),
        version(id=103, source_item_id="103", created=None, status="Completed"),
    )

    assert sum(row["case_count"] for row in aged(*history)) == len(current(*history))


# --- gold: daily throughput --------------------------------------------------


def ended(*rows: dict) -> list[dict]:
    return aggregate(throughput_transform, "count-by-terminal-date", current(*rows))


def test_a_case_observed_many_times_but_completed_once_counts_once():
    # Five observations across overlapping windows, one terminal transition.
    history = [
        version(
            source_version=f'"{n}"',
            source_modified_at=f"2026-08-05 08:{10 + n}:00+00:00",
        )
        for n in range(1, 5)
    ]
    history.append(
        version(
            source_version='"5"',
            source_modified_at="2026-08-05 08:45:00+00:00",
            status="Completed",
            completed_at="2026-08-05 08:44:00+00:00",
        )
    )

    assert [
        (row["terminal_date"], row["terminal_status"], row["case_count"])
        for row in ended(*history)
    ] == [("2026-08-05", "Completed", 1)]


def test_a_voided_case_counts_on_the_date_it_was_voided():
    rows = ended(
        version(status="Void", voided_at="2026-08-04 16:00:00+00:00"),
        version(
            id=102,
            source_item_id="102",
            status="Completed",
            completed_at="2026-08-05 08:44:00+00:00",
        ),
    )

    assert [(row["terminal_date"], row["terminal_status"]) for row in rows] == [
        ("2026-08-04", "Void"),
        ("2026-08-05", "Completed"),
    ]


def test_a_terminal_case_with_no_stamp_is_counted_as_unstamped():
    # Nothing enforces "terminal status implies a stamp" and the list row is
    # editable by hand, so the Case is counted under a literal key rather than
    # dropped out of a total.
    rows = ended(version(status="Completed", completed_at=None))

    assert [(row["terminal_date"], row["case_count"]) for row in rows] == [
        (UNSTAMPED, 1)
    ]


def test_throughput_totals_the_cases_currently_in_a_terminal_status():
    history = (
        version(),
        version(
            id=102,
            source_item_id="102",
            status="Completed",
            completed_at="2026-08-05 08:44:00+00:00",
        ),
        version(id=103, source_item_id="103", status="Void", voided_at=None),
        version(id=104, source_item_id="104", status="Actions In Progress"),
    )

    assert sum(row["case_count"] for row in ended(*history)) == 2


def test_throughput_is_empty_when_nothing_has_ended():
    assert ended(version()) == []


# --- gold: the answer remediation aggregate ----------------------------------

# Reuses winning_reader() and details(), defined above for the Detail Table
# reduction tests -- this aggregate reads gold `answer`, so proving it comes
# from the winning observation means driving the same reduction, not hand
# building already-reduced rows.


def answer_child(
    *,
    source_item_id: str = "101",
    case_type: str = COMPLAINTS.case_type,
    source_observation_id: str,
    question_id: str = "q1",
    remediation_required: str | None = None,
    remediation_status: str | None = None,
) -> dict:
    """One row of an ``answer`` Detail Table child history, remediation-shaped."""
    return {
        "source_item_id": source_item_id,
        "case_type": case_type,
        "source_observation_id": source_observation_id,
        "question_id": question_id,
        "remediation_required": remediation_required,
        "remediation_status": remediation_status,
    }


def gold_answer(children: list[dict], winners: Reader) -> list[dict]:
    """The gold ``answer`` Detail Table rows a child history reduces to."""
    return details(children, winners, grain=DETAIL_GRAIN["answer"])


def remediation(rows: list[dict]) -> list[dict]:
    return aggregate(answer_remediation, "count-by-remediation", rows)


def test_remediation_counts_come_from_the_winning_observation():
    # Two observations of one Case: the second clears q1's remediation
    # decision and status entirely -- the deleted-key tri-state case.
    v1 = version(
        source_observation_id="obs-1",
        source_version='"3"',
        source_modified_at="2026-08-05 08:10:00+00:00",
    )
    v2 = version(
        source_observation_id="obs-2",
        source_version='"4"',
        source_modified_at="2026-08-05 08:45:00+00:00",
        status="Completed",
    )
    winners = winning_reader(v1, v2)
    children = [
        answer_child(
            source_observation_id="obs-1",
            question_id="q1",
            remediation_required="yes",
            remediation_status="partial",
        ),
        answer_child(source_observation_id="obs-2", question_id="q1"),
    ]

    rows = remediation(gold_answer(children, winners))

    assert [
        (row["remediation_required"], row["remediation_status"], row["answer_count"])
        for row in rows
    ] == [(UNDECIDED, UNRESOLVED, 1)]


def test_an_undecided_remediation_is_counted_and_the_total_matches_gold_answer():
    winners = winning_reader(version(source_observation_id="obs-1"))
    children = [
        answer_child(source_observation_id="obs-1", question_id="q1"),
        answer_child(
            source_observation_id="obs-1",
            question_id="q2",
            remediation_required="yes",
            remediation_status="complete",
        ),
    ]
    answer_rows = gold_answer(children, winners)

    rows = remediation(answer_rows)

    assert (UNDECIDED, UNRESOLVED, 1) in [
        (row["remediation_required"], row["remediation_status"], row["answer_count"])
        for row in rows
    ]
    # sum(answer_count) is an answer count, not a Case count -- it equals gold
    # answer's own row count.
    assert sum(row["answer_count"] for row in rows) == len(answer_rows)


def test_a_decided_remediation_with_no_status_counts_as_unresolved():
    winners = winning_reader(version(source_observation_id="obs-1"))
    [row] = remediation(
        gold_answer(
            [
                answer_child(
                    source_observation_id="obs-1",
                    remediation_required="yes",
                    remediation_status=None,
                )
            ],
            winners,
        )
    )

    assert (row["remediation_required"], row["remediation_status"]) == (
        "yes",
        UNRESOLVED,
    )


def test_two_case_types_do_not_share_a_question_id():
    v1 = version(source_observation_id="obs-1")
    v2 = version(
        id=101,
        source_item_id="101",
        case_type=OTHER.case_type,
        source_observation_id="obs-2",
    )
    winners = winning_reader(v1, v2)
    children = [
        answer_child(source_observation_id="obs-1", case_type=COMPLAINTS.case_type),
        answer_child(source_observation_id="obs-2", case_type=OTHER.case_type),
    ]

    rows = remediation(gold_answer(children, winners))

    # Same source_item_id and question_id, distinct case_type -- summing them
    # as one question would be meaningless: ids are per-Case-Type bank.
    assert len(rows) == 2
    assert {row["case_type"] for row in rows} == {
        COMPLAINTS.case_type,
        OTHER.case_type,
    }
    assert all(row["answer_count"] == 1 for row in rows)


def test_remediation_is_empty_when_nothing_was_answered():
    writer = RecordingWriter()
    aggregate_pipeline(
        given_columns(*ANSWER_REMEDIATION_DIMENSIONS),
        writer,
        table="table",
        transform=answer_remediation,
        step="count-by-remediation",
    ).run()

    frame = writer.dataset.to_pandas()
    assert list(frame.columns) == [
        *ANSWER_REMEDIATION_DIMENSIONS,
        "answer_count",
        "as_of_utc",
    ]
    assert len(frame) == 0


# --- gold: the appeal outcomes aggregate --------------------------------------


def appeal_child(
    *,
    source_item_id: str = "101",
    case_type: str = COMPLAINTS.case_type,
    source_observation_id: str,
    appeal_id: str = "appeal-1",
    state: str | None = "raised",
    resolution_verdict: str | None = None,
) -> dict:
    """One row of an ``appeal`` Detail Table child history, outcome-shaped."""
    return {
        "source_item_id": source_item_id,
        "case_type": case_type,
        "source_observation_id": source_observation_id,
        "appeal_id": appeal_id,
        "state": state,
        "resolution_verdict": resolution_verdict,
    }


def gold_appeal(children: list[dict], winners: Reader) -> list[dict]:
    """The gold ``appeal`` Detail Table rows a child history reduces to."""
    return details(children, winners, grain=DETAIL_GRAIN["appeal"])


def outcomes(rows: list[dict]) -> list[dict]:
    return aggregate(appeal_outcomes, "count-by-outcome", rows)


def test_appeal_outcomes_come_from_the_winning_observation():
    # One Appeal, raised in the first observation and resolved in the second
    # -- gold appeal's semi-join has already picked the winner, so this must
    # count once, as resolved/agreed, never twice.
    v1 = version(
        source_observation_id="obs-1",
        source_version='"3"',
        source_modified_at="2026-08-05 08:10:00+00:00",
    )
    v2 = version(
        source_observation_id="obs-2",
        source_version='"4"',
        source_modified_at="2026-08-05 08:45:00+00:00",
        status="Completed",
    )
    winners = winning_reader(v1, v2)
    children = [
        appeal_child(
            source_observation_id="obs-1",
            appeal_id="appeal-1",
            state="raised",
            resolution_verdict=None,
        ),
        appeal_child(
            source_observation_id="obs-2",
            appeal_id="appeal-1",
            state="resolved",
            resolution_verdict="agreed",
        ),
    ]

    rows = outcomes(gold_appeal(children, winners))

    assert [
        (row["state"], row["resolution_verdict"], row["appeal_count"]) for row in rows
    ] == [("resolved", "agreed", 1)]


def test_an_unresolved_appeal_counts_under_a_literal_and_totals_to_gold_appeal():
    # Also proves a null state counts as unstated: both fills exercised on the
    # same single row.
    winners = winning_reader(version(source_observation_id="obs-1"))
    children = [
        appeal_child(
            source_observation_id="obs-1",
            appeal_id="appeal-1",
            state=None,
            resolution_verdict=None,
        )
    ]
    appeal_rows = gold_appeal(children, winners)

    rows = outcomes(appeal_rows)

    assert [
        (row["state"], row["resolution_verdict"], row["appeal_count"]) for row in rows
    ] == [(UNSTATED, UNRESOLVED, 1)]
    assert sum(row["appeal_count"] for row in rows) == len(appeal_rows)


# --- gold: declaration and publication order ----------------------------------


def test_an_aggregate_is_never_mistaken_for_a_detail_table():
    assert set(DETAIL_TABLES) == set(DETAIL_GRAIN)


# --- the composed plan -----------------------------------------------------


def test_all_nine_ingest_hops_plan_exactly_the_steps_they_always_have():
    reader, writer, rejects = given_rows([]), RecordingWriter(), RecordingWriter()

    # No column gate on the raw hop, unlike a file feed: the observation
    # transform projects onto exactly the stored columns, so a presence check
    # below it could never fire. Each hop is named for the list it polled.
    assert raw_builder(reader, writer, COMPLAINTS).describe().splitlines() == [
        "Pipeline: sharepoint_cases:raw:complaints",
        "  [Read] read",
        "  [Transform] observation (depends on: read)",
        "  [Write] write (depends on: observation)",
    ]
    assert silver_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints",
        "  [Read] read",
        "  [Transform] rename (depends on: read)",
        "  [Transform] case-type (depends on: rename)",
        "  [Transform] coerce (depends on: case-type)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert silver_answer_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints:answer",
        "  [Read] read",
        "  [Transform] explode (depends on: read)",
        "  [Transform] value-text (depends on: explode)",
        "  [Transform] coerce (depends on: value-text)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert silver_answer_capture_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints:answer_capture",
        "  [Read] read",
        "  [Transform] explode-answers (depends on: read)",
        "  [Transform] explode-capture (depends on: explode-answers)",
        "  [Transform] discriminate (depends on: explode-capture)",
        "  [Transform] coerce (depends on: discriminate)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Transform] drop-raw-value (depends on: quarantine)",
        "  [Validate] post-validate (depends on: drop-raw-value)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert silver_answer_action_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints:answer_action",
        "  [Read] read",
        "  [Transform] explode-answers (depends on: read)",
        "  [Transform] explode-actions (depends on: explode-answers)",
        "  [Transform] coerce (depends on: explode-actions)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert silver_general_answer_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints:general_answer",
        "  [Read] read",
        "  [Transform] explode (depends on: read)",
        "  [Transform] value-text (depends on: explode)",
        "  [Transform] coerce (depends on: value-text)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert silver_conversation_message_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints:conversation_message",
        "  [Read] read",
        "  [Transform] explode (depends on: read)",
        "  [Transform] coerce (depends on: explode)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert silver_appeal_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints:appeal",
        "  [Read] read",
        "  [Transform] explode (depends on: read)",
        "  [Transform] coerce (depends on: explode)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert silver_case_detail_builder(
        reader, writer, COMPLAINTS, rejects
    ).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver:complaints:case_detail",
        "  [Read] read",
        "  [Transform] explode (depends on: read)",
        "  [Transform] encode-value (depends on: explode)",
        "  [Transform] coerce (depends on: encode-value)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]


def test_the_gold_hops_plan_exactly_the_steps_they_always_have():
    reader, writer = given_rows([]), RecordingWriter()

    # Only the current hop carries a grain gate; see case_current_builder.
    assert case_current_builder(
        reader, writer, as_of=AS_OF
    ).describe().splitlines() == [
        f"Pipeline: {FEED_NAME}:gold:case_current",
        "  [Read] read",
        "  [Transform] derive-key (depends on: read)",
        "  [Transform] latest-version (depends on: derive-key)",
        "  [Transform] stamp-as-of (depends on: latest-version)",
        "  [Validate] unique-validate (depends on: stamp-as-of)",
        "  [Write] write (depends on: unique-validate)",
    ]
    assert gold_detail_builder(
        reader,
        writer,
        grain=DETAIL_GRAIN[DETAIL_TABLE],
        observations=reader,
        as_of=AS_OF,
        name=f"{FEED_NAME}:gold:detail",
    ).describe().splitlines() == [
        f"Pipeline: {FEED_NAME}:gold:detail",
        "  [Read] read",
        "  [Transform] derive-key (depends on: read)",
        "  [Transform] latest-observation (depends on: derive-key)",
        "  [Transform] stamp-as-of (depends on: latest-observation)",
        "  [Validate] unique-validate (depends on: stamp-as-of)",
        "  [Write] write (depends on: unique-validate)",
    ]
    for table, step in (
        ("case_counts_current", "count-by-reviewer-and-status"),
        ("case_age_buckets_current", "bucket-by-age"),
        ("case_throughput_daily", "count-by-terminal-date"),
        ("answer_remediation_current", "count-by-remediation"),
        ("appeal_outcomes_current", "count-by-outcome"),
    ):
        assert aggregate_pipeline(
            reader,
            writer,
            table=table,
            transform=case_counts,
            step=step,
        ).describe().splitlines() == [
            f"Pipeline: {FEED_NAME}:gold:{table}",
            "  [Read] read",
            f"  [Transform] {step} (depends on: read)",
            f"  [Transform] stamp-as-of (depends on: {step})",
            "  [Write] write (depends on: stamp-as-of)",
        ]


# --- end to end ------------------------------------------------------------


def test_the_bundled_sample_lands_every_item_across_both_pages(tmp_path, capsys):
    [poll] = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=LocalJsonListClient()
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    landed_raw = read_rows(med.raw, "case_observation")
    assert [row["source_item_id"] for row in landed_raw] == [
        "101",
        "102",
        "103",
        "104",
        "105",
    ]
    # One fixture Case carries no Case Reference at all, which is ordinary.
    assert [row["Title"] for row in landed_raw][:2] == ["CMP-000101", "CMP-000102"]
    assert pd.isna(landed_raw[2]["Title"])
    # Item 101 carries three questions (one a multi-select), 102 one and 104
    # two, 103 and 105 an empty answers map -- 6 answer rows in total. Only
    # item 101's q-root-cause carries a capture map (2 fields) and a
    # remediationActions list (1 action), so those tables land 2 and 1. Only
    # item 101 carries a General Question answer (general:complaint-channel),
    # so general_answer lands 1. Item 101 carries two Conversation messages
    # (deliberately mixed timestamp formats -- see cases_page_1.json) and item
    # 104 one, so conversation_message lands 3. Only item 104 carries any
    # Appeals -- one resolved with citations, one raised without, also with
    # deliberately mixed raised_at timestamp formats -- so appeal lands 2.
    # (resolution_at has only the one resolved appeal to draw from, so it
    # rides on raised_at's mixed-format demonstration rather than repeating
    # it.) Items 101, 102 and 105 carry the three declared complaintRef /
    # customerName / complaintDate keys (3 each); 104 carries those three plus
    # an undeclared sourceSystem (4); 103's details map is empty (0) -- 13
    # case_detail rows in total.
    assert (poll.raw_rows, poll.silver_rows) == (5, 5)
    assert poll.detail_rows == {
        "answer": 6,
        "answer_capture": 2,
        "answer_action": 1,
        "general_answer": 1,
        "conversation_message": 3,
        "appeal": 2,
        "case_detail": 13,
    }
    # The fixture exercises all four real statuses, so the whole vocabulary
    # passes the schema gate rather than only the one a happy path would use.
    assert {row["status"] for row in read_rows(med.silver, "case_version")} == set(
        CASE_STATUSES
    )
    # Both Detail Table aggregates total to their source table's row count --
    # a single poll, so every Case's only observation is its winning one.
    assert sum(
        row["answer_count"] for row in read_rows(med.gold, "answer_remediation_current")
    ) == len(read_rows(med.gold, "answer"))
    assert sum(
        row["appeal_count"] for row in read_rows(med.gold, "appeal_outcomes_current")
    ) == len(read_rows(med.gold, "appeal"))

    # main()'s per-poll line is derived from detail_rows and otherwise
    # unpinned; exercise the CLI path once, against a separate base dir, to
    # lock its shape down.
    exit_code = main(["prog", "--base-dir", str(tmp_path / "via-cli"), "--sample"])
    assert exit_code == 0
    assert (
        "5 observation(s) -> 5 case version(s), 6 answer row(s), "
        "2 answer_capture row(s), 1 answer_action row(s), "
        "1 general_answer row(s), 3 conversation_message row(s), "
        "2 appeal row(s), 13 case_detail row(s)."
    ) in capsys.readouterr().out


def test_a_repeated_observation_is_a_no_op_in_raw_and_silver(tmp_path):
    client = FakeListClient(advance=NEXT_POLL)
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_later_source_version_appends_a_second_case_version(tmp_path):
    later = item(Status="Completed")
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    client = FakeListClient(items(item()), items(later), advance=NEXT_POLL)
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert [
        (row["status"], row["source_version"])
        for row in read_rows(med.silver, "case_version")
    ] == [("In-progress", '"3"'), ("Completed", '"4"')]


def test_the_same_observation_carrying_a_different_payload_is_refused(tmp_path):
    # Same Id and same etag, so the same observation id -- but the row moved.
    client = FakeListClient(
        items(item()), items(item(Status="Completed")), advance=NEXT_POLL
    )
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)

    with pytest.raises(AppendOnlyConflictError, match="already present with different"):
        run(context, client=client)


def test_a_quiet_window_writes_cleanly_and_a_later_one_still_appends(tmp_path):
    # The common steady-state poll: nothing changed in the window.
    client = FakeListClient(pd.DataFrame(), items(item()), advance=NEXT_POLL)
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    [quiet] = run(context, client=client)
    [busy] = run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert (quiet.raw_rows, quiet.silver_rows) == (0, 0)
    assert (busy.raw_rows, busy.silver_rows) == (1, 1)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_quiet_first_window_still_types_the_columns_it_creates(tmp_path):
    # The steady-state poll is a quiet one, so a feed's *first* run is quite
    # likely to be empty -- and an empty write is what creates the silver table,
    # fixing each column's SQLite affinity for the life of the feed. A zero-row
    # frame carrying object columns would create `id` as TEXT and store every
    # later integer id as text, silently, for as long as nobody compared types.
    # So the id a quiet-first feed lands must be the id a busy-first one lands.
    quiet_first = FakeListClient(pd.DataFrame(), items(item()), advance=NEXT_POLL)
    busy_first = FakeListClient(items(item()), pd.DataFrame(), advance=NEXT_POLL)

    landed = []
    for order, client in (("quiet", quiet_first), ("busy", busy_first)):
        base = tmp_path / order
        context = RunContext(base_dir=base, pipeline=FEED_NAME)
        run(context, client=client)
        run(context, client=client)
        med = medallion(StoreRegistry(base), FEED_NAME)
        landed.append(read_rows(med.silver, "case_version")[0]["id"])

    assert landed[0] == landed[1]
    assert isinstance(landed[0], int)


def test_a_quiet_window_still_runs_and_records_every_hop(tmp_path):
    # A quiet poll is not a different pipeline: an operator reading the run log
    # still sees every hop, against every table, with zero rows.
    log_path = tmp_path / "runs.log"
    context = RunContext(
        base_dir=tmp_path, pipeline=FEED_NAME, run_log=RunLog(log_path)
    )

    run(context, client=FakeListClient(pd.DataFrame()))

    records = read_run_log(log_path)
    assert {record["pipeline"] for record in records} == EVERY_HOP
    locations = [
        location for record in records for location in record["data_locations"]
    ]
    assert {location["name"] for location in locations} == {
        COMPLAINTS.list_name,
        "case_observation",
        "case_version",
        *GOLD_TABLES,
    }
    # "answer" is a table in both silver.db (the exploded rows) and gold.db
    # (the Detail Table's reduction) -- the same name, two different bases.
    answer_namespaces = {
        location["namespace"] for location in locations if location["name"] == "answer"
    }
    assert any(ns.endswith("silver.db") for ns in answer_namespaces)
    assert any(ns.endswith("gold.db") for ns in answer_namespaces)
    assert {record["rows_out"] for record in records} == {0}

    # Gold publishes in the declared order: GOLD_TABLES ties the declaration
    # to what actually ran.
    gold_names = [
        record["pipeline"]
        for record in records
        if record["pipeline"].startswith(f"{FEED_NAME}:gold:")
    ]
    assert list(dict.fromkeys(gold_names)) == [
        f"{FEED_NAME}:gold:{table}" for table in GOLD_TABLES
    ]


def test_nothing_safe_to_poll_returns_nothing_and_writes_nothing(tmp_path):
    SharePointCheckpointStore(tmp_path).commit(
        SOURCE,
        window_end=SERVER_NOW,
        ingestion_batch_id="earlier",
        pipeline_run_id="earlier-run",
    )

    assert (
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient())
        == []
    )
    assert not (tmp_path / FEED_NAME).exists()


def test_the_run_log_identifies_the_list_and_every_table(tmp_path):
    log_path = tmp_path / "runs.log"
    context = RunContext(
        base_dir=tmp_path, pipeline=FEED_NAME, run_log=RunLog(log_path)
    )

    run(context, client=FakeListClient())

    located = [
        location
        for record in read_run_log(log_path)
        for location in record["data_locations"]
    ]
    assert {"namespace": COMPLAINTS.site, "name": COMPLAINTS.list_name} in located
    assert {location["name"] for location in located} == {
        COMPLAINTS.list_name,
        "case_observation",
        "case_version",
        *GOLD_TABLES,
    }


def test_running_with_no_client_refuses_as_an_operator_failure(tmp_path, capsys):
    # The documented default invocation without --sample. Forgetting the client
    # is an operator's mistake, and the message names the fix, so it is worth
    # more to print it than a stack trace.
    exit_code = main(["prog", "--base-dir", str(tmp_path)])

    assert exit_code == 1
    assert "--sample" in capsys.readouterr().err
    assert not (tmp_path / FEED_NAME).exists()


def test_run_with_no_client_refuses_as_a_wiring_failure(tmp_path):
    # How the operator CLI and the orchestrator both reach a feed: run(context),
    # with no way to pass a client. That must abort as a caught, categorised
    # failure rather than as a stack trace the operator has to read.
    with pytest.raises(NoClientError) as refused:
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    assert refused.value.category == ErrorCategory.CONFIG
    assert not (tmp_path / FEED_NAME).exists()


def test_the_sample_client_replays_both_pages_as_one_first_load():
    frame = LocalJsonListClient().fetch_items(COMPLAINTS.list_name, (), (), ())

    assert list(frame["Id"]) == [101, 102, 103, 104, 105]


def test_the_sample_client_names_a_list_it_has_no_pages_for():
    with pytest.raises(SharePointFeedError, match="Cases-Other"):
        LocalJsonListClient().fetch_items(OTHER.list_name, (), (), ())


# --- end to end: gold, and the checkpoint last -------------------------------


def landed_gold(tmp_path) -> set[str]:
    """Which tables actually exist in the gold database under ``tmp_path``.

    Reads ``sqlite_master`` directly rather than iterating ``GOLD_TABLES`` and
    probing each: probing the registry can only ever confirm the registry, and
    would never catch a table published without also being added to it. Empty
    when the database itself is absent (nothing published yet).
    """
    db_path = tmp_path / FEED_NAME / "gold.db"
    if not db_path.exists():
        return set()
    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    finally:
        connection.close()
    return {row[0] for row in rows}


def explode(*args: object, **kwargs: object):
    raise RuntimeError("boom")


def test_a_poll_publishes_every_gold_table_and_then_commits_the_watermark(tmp_path):
    [poll] = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient()
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert poll.window.end == SERVER_NOW - SAFETY_LAG
    assert poll.ingestion_batch_id == f"{COMPLAINTS.list_id}:first-load"
    assert landed_gold(tmp_path) == set(GOLD_TABLES)
    [case] = read_rows(med.gold, "case_current")
    assert (case["source_item_id"], case["status"]) == ("101", "In-progress")
    assert case["as_of_utc"] == (SERVER_NOW - SAFETY_LAG).isoformat()
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )


def test_the_winning_observation_settles_gold_answer_and_drops_the_others(tmp_path):
    # Two polls of one item: the second observation strips q2 and adds q3.
    early = item(Answers=json.dumps({"q1": {"value": "A"}, "q2": {"value": "X"}}))
    later = item(
        Answers=json.dumps({"q1": {"value": "B"}, "q3": {"value": "Y"}}),
        Status="Completed",
    )
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    client = FakeListClient(items(early), items(later), advance=NEXT_POLL)
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    # Silver accumulated both observations' answers: 2 questions + 2 questions.
    assert len(read_rows(med.silver, "answer")) == 4

    gold_answer = read_rows(med.gold, "answer")
    assert {row["question_id"] for row in gold_answer} == {"q1", "q3"}
    [winner] = read_rows(med.gold, "case_current")
    assert {row["source_observation_id"] for row in gold_answer} == {
        winner["source_observation_id"]
    }


def test_the_winning_observation_settles_gold_general_answer_and_drops_the_others(
    tmp_path,
):
    # Two polls of one item: the second observation changes general:a's value
    # and swaps general:b for general:c.
    early = item(
        Answers=json.dumps(
            {"general:a": {"value": "first"}, "general:b": {"value": "X"}}
        )
    )
    later = item(
        Answers=json.dumps(
            {"general:a": {"value": "second"}, "general:c": {"value": "Y"}}
        ),
        Status="Completed",
    )
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    client = FakeListClient(items(early), items(later), advance=NEXT_POLL)
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    # Silver accumulated both observations' general answers: 2 keys + 2 keys.
    assert len(read_rows(med.silver, "general_answer")) == 4

    gold_general_answer = read_rows(med.gold, "general_answer")
    assert {row["general_key"] for row in gold_general_answer} == {"a", "c"}
    [winner] = read_rows(med.gold, "case_current")
    assert {row["source_observation_id"] for row in gold_general_answer} == {
        winner["source_observation_id"]
    }


def test_the_winning_observation_settles_gold_capture_and_action_and_drops_the_others(
    tmp_path,
):
    # Item 101: q1 fails in poll 1, carrying a capture map and one action; poll
    # 2 sets remediationRequired to "no", the app's own trigger for deleting
    # both -- q1 stops failing and its capture/action rows must not survive
    # into gold, the exact case a child-keyed reduce is structurally blind to.
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
    stripped_later = item(
        Id=101,
        Answers=json.dumps({"q1": {"value": "A", "remediationRequired": "no"}}),
        Status="Completed",
    )
    stripped_later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})

    # Item 102: q1 fails in both polls, and poll 2 adds a genuinely new capture
    # field -- proves gold reflects an addition and is not just always empty.
    grown_early = item(
        Id=102, Answers=json.dumps({"q1": {"value": "A", "remediationRequired": "yes"}})
    )
    grown_later = item(
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
    grown_later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})

    client = FakeListClient(
        items(stripped_early, grown_early),
        items(stripped_later, grown_later),
        advance=NEXT_POLL,
    )
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    # Silver accumulated both observations' rows for both items: 101's
    # field-a/ra-0 from poll 1 plus 102's field-added from poll 2.
    assert len(read_rows(med.silver, "answer_capture")) == 2
    assert len(read_rows(med.silver, "answer_action")) == 1

    gold_capture = read_rows(med.gold, "answer_capture")
    gold_action = read_rows(med.gold, "answer_action")

    # Item 101's capture and action are gone: the winning (second) observation
    # carries neither, and the semi-join reads that absence correctly rather
    # than keeping a stale row a per-child reduce would have no reason to drop.
    assert not [row for row in gold_capture if row["source_item_id"] == "101"]
    assert not [row for row in gold_action if row["source_item_id"] == "101"]

    # Item 102's field added on the second poll is present.
    [added] = [row for row in gold_capture if row["source_item_id"] == "102"]
    assert added["field_key"] == "field-added"


def test_the_winning_observation_settles_gold_conversation_message_and_appeal(
    tmp_path,
):
    # The resurrection anchor: conversation_message's key is positional
    # (seq, the blob's own ordinal), not drawn from a JSON map key or a
    # minted id, so an observation-spanning superset collides on the grain
    # itself, with no deletion to read the way the answer-derived tables have.
    # Observation 1 has 2 messages, observation 2 appends a third -- 3
    # messages sharing seq 0 and 1 with observation 1's own. Without the
    # semi-join, gold would see (case_id, 0) and (case_id, 1) twice each, and
    # UniqueValidator would abort the hop -- so a weakened reduction fails
    # loudly here, not silently.
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
    early = item(Conversation=json.dumps([message_1, message_2]))
    later = item(
        Conversation=json.dumps([message_1, message_2, message_3]),
        Status="Completed",
    )
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})

    # Companion: one Appeal, raised in the first observation and resolved in
    # the second -- the shape resolveAppeal() writes in the real app.
    early["Appeals"] = json.dumps(
        [
            {
                "id": "appeal-1",
                "appellant": "e.novak",
                "at": "2026-08-04T09:00:00Z",
                "rationale": "Reconsider the outcome.",
                "state": "raised",
            }
        ]
    )
    later["Appeals"] = json.dumps(
        [
            {
                "id": "appeal-1",
                "appellant": "e.novak",
                "at": "2026-08-04T09:00:00Z",
                "rationale": "Reconsider the outcome.",
                "state": "resolved",
                "resolution": {
                    "verdict": "agreed",
                    "rationale": "The amended statement changes the outcome.",
                    "resolver": "d.reid",
                    "at": "2026-08-05T08:44:00Z",
                },
            }
        ]
    )
    client = FakeListClient(items(early), items(later), advance=NEXT_POLL)
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    # Silver accumulated both observations' messages: 2 + 3.
    assert len(read_rows(med.silver, "conversation_message")) == 5
    [winner] = read_rows(med.gold, "case_current")

    gold_messages = read_rows(med.gold, "conversation_message")
    assert [row["seq"] for row in gold_messages] == [0, 1, 2]
    assert {row["source_observation_id"] for row in gold_messages} == {
        winner["source_observation_id"]
    }

    # Companion: silver accumulated both observations of the one Appeal, but
    # gold holds it once, resolved, with every resolution_* column filled.
    assert len(read_rows(med.silver, "appeal")) == 2
    [gold_appeal] = read_rows(med.gold, "appeal")
    assert gold_appeal["appeal_id"] == "appeal-1"
    assert gold_appeal["state"] == "resolved"
    assert gold_appeal["resolution_verdict"] == "agreed"
    assert gold_appeal["resolution_resolver"] == "d.reid"


def test_the_winning_observation_settles_gold_case_detail_and_drops_the_others(
    tmp_path,
):
    # Two polls of one item: the second observation drops complaintRef and
    # adds sourceSystem. Two keys per observation, so the composite AppendOnly
    # key (source_observation_id, field_key) is under test -- item()'s default
    # Details cell falls into the absent -> None sweep, so no other end-to-end
    # test exercises this table at all otherwise.
    early = item(
        Details=json.dumps({"complaintRef": "CMP-000101", "customerName": "Priya Shah"})
    )
    later = item(
        Details=json.dumps(
            {"customerName": "Priya Shah", "sourceSystem": "legacy-crm"}
        ),
        Status="Completed",
    )
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    client = FakeListClient(items(early), items(later), advance=NEXT_POLL)
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    # Silver accumulated both observations' fields: 2 keys + 2 keys.
    assert len(read_rows(med.silver, "case_detail")) == 4

    gold_case_detail = read_rows(med.gold, "case_detail")
    assert {row["field_key"] for row in gold_case_detail} == {
        "customerName",
        "sourceSystem",
    }
    [winner] = read_rows(med.gold, "case_current")
    assert {row["source_observation_id"] for row in gold_case_detail} == {
        winner["source_observation_id"]
    }


@pytest.mark.parametrize("cell", [None, "misfiled", "complaints"])
def test_gold_answer_derives_the_same_case_id_as_the_settled_case_type(tmp_path, cell):
    # Mirrors test_silver_settles_the_case_type_to_the_polled_lists_declared_one:
    # OTHER's declared case_type is "other", never whatever this raw cell says.
    client = FakeListClient(items(item(CaseType=cell)))

    run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
        client=client,
        case_lists=(OTHER,),
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    [case] = read_rows(med.gold, "case_current")
    [row] = read_rows(med.gold, "answer")
    # Fails with zero rows (the semi-join matches nothing) or an IdentityError
    # if the answer hop ever reads raw's own CaseType cell instead of the one
    # silver settled.
    assert row["case_id"] == case["case_id"]
    assert row["case_type"] == OTHER.case_type


def test_a_malformed_answers_blob_raises_and_case_version_still_lands(tmp_path):
    client = FakeListClient(items(item(Answers="not json")))
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    with pytest.raises(JsonShapeError):
        run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert len(read_rows(med.silver, "case_version")) == 1
    assert landed_gold(tmp_path) == set()
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) is None


def test_a_malformed_details_blob_raises_and_case_version_details_still_holds_it(
    tmp_path,
):
    client = FakeListClient(items(item(Details="not json")))
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    with pytest.raises(JsonShapeError):
        run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert landed_gold(tmp_path) == set()
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) is None
    # The genuinely new claim versus every other blob's malformed-blob test:
    # the frontend's parse fallback for Details is undefined, so absent and
    # unparseable are indistinguishable once a Case reaches the app -- silver
    # is the only place the raw text survives.
    [case_version] = read_rows(med.silver, "case_version")
    assert case_version["details"] == "not json"


def test_a_quiet_first_window_commits_and_publishes_thirteen_empty_gold_tables(
    tmp_path,
):
    # Nothing to reduce is not nothing to publish: a consumer reading gold must
    # find the tables, empty, rather than a missing one it has to special-case.
    run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
        client=FakeListClient(pd.DataFrame()),
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert landed_gold(tmp_path) == set(GOLD_TABLES)
    assert all(read_rows(med.gold, table) == [] for table in GOLD_TABLES)
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )


def test_an_overlap_reread_does_not_double_count_gold(tmp_path):
    # The overlap re-presents rows that did not change. Silver no-ops them; gold
    # must not count the Case twice either.
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)
    client = FakeListClient(
        items(
            item(
                Details=json.dumps(
                    {"complaintRef": "CMP-000101", "customerName": "Priya Shah"}
                )
            )
        ),
        advance=NEXT_POLL,
    )

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert len(read_rows(med.gold, "case_current")) == 1
    assert [
        row["case_count"] for row in read_rows(med.gold, "case_counts_current")
    ] == [1]
    # The overlap re-presents the same observation, which is a no-op against
    # append-only silver; the answer rows must not double either.
    assert len(read_rows(med.silver, "answer")) == 1
    # Two field keys, so a wrong single-column key (e.g. source_observation_id
    # alone) would raise an AppendOnly conflict on the second key rather than
    # silently no-op; the composite (source_observation_id, field_key) key
    # must absorb the re-presented observation cleanly.
    assert len(read_rows(med.silver, "case_detail")) == 2


def test_a_failure_in_current_gold_leaves_no_gold_and_no_checkpoint(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(gold, "case_current_builder", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient())

    checkpoints = SharePointCheckpointStore(tmp_path)
    assert landed_gold(tmp_path) == set()
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_a_failure_in_the_last_aggregate_leaves_the_earlier_gold_and_no_checkpoint(
    tmp_path, monkeypatch
):
    # Gold Writers commit independently, so an earlier table stays refreshed.
    # That is acceptable evidence: the watermark did not move, so the next run
    # rebuilds everything from the same history and converges. appeal_outcomes
    # is the last table GOLD_TABLES declares today.
    monkeypatch.setattr(gold, "appeal_outcomes", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient())

    checkpoints = SharePointCheckpointStore(tmp_path)
    assert landed_gold(tmp_path) == {
        "case_current",
        "answer",
        "answer_capture",
        "answer_action",
        "general_answer",
        "conversation_message",
        "appeal",
        "case_detail",
        "case_counts_current",
        "case_age_buckets_current",
        "case_throughput_daily",
        "answer_remediation_current",
    }
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_a_retry_after_a_partial_failure_converges_and_advances_once(
    tmp_path, monkeypatch
):
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)
    client = FakeListClient(advance=NEXT_POLL)
    checkpoints = SharePointCheckpointStore(tmp_path)
    monkeypatch.setattr(gold, "throughput", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(context, client=client)
    assert checkpoints.committed_watermark(SOURCE) is None

    monkeypatch.undo()
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert landed_gold(tmp_path) == set(GOLD_TABLES)
    assert len(read_rows(med.gold, "case_current")) == 1
    # The first attempt left the watermark alone, so exactly one advance has
    # happened: to the *retry's* candidate end.
    assert checkpoints.committed_watermark(SOURCE) == (
        SERVER_NOW + NEXT_POLL - SAFETY_LAG
    )


# --- end to end: more than one list ------------------------------------------


def two_list_client(**kwargs) -> FakeListClient:
    """A client serving each list one item, both carrying item id 101."""
    return FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [items(item(Title="OTH-000101"))],
        },
        **kwargs,
    )


def test_two_lists_land_in_one_observation_table_and_one_version_table(tmp_path):
    # All Case Types share one list template, so every list refines into the
    # same two tables and is told apart by the Case Type on the row.
    polls = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert [poll.case_list for poll in polls] == list(TWO_LISTS)
    assert {
        row["source_list_name"] for row in read_rows(med.raw, "case_observation")
    } == {
        COMPLAINTS.list_name,
        OTHER.list_name,
    }
    assert [row["case_type"] for row in read_rows(med.silver, "case_version")] == [
        "complaints",
        "other",
    ]


def test_the_same_item_id_in_two_lists_is_two_cases(tmp_path):
    # Item 101 exists in every list, so neither the observation id nor the
    # case_id may be derived from it alone.
    run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    current_cases = read_rows(med.gold, "case_current")
    assert {row["source_item_id"] for row in current_cases} == {"101"}
    assert len({row["case_id"] for row in current_cases}) == 2
    assert len({row["source_observation_id"] for row in current_cases}) == 2


def test_gold_counts_across_every_list(tmp_path):
    # A Reviewer holds Cases across Case Types, so the aggregates are one count
    # over the union rather than one table per list.
    run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert [
        row["case_count"] for row in read_rows(med.gold, "case_counts_current")
    ] == [2]


def test_each_list_keeps_its_own_watermark(tmp_path):
    run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    checkpoints = SharePointCheckpointStore(tmp_path)
    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG


def test_a_list_with_nothing_safe_to_poll_is_skipped_and_the_others_still_run(tmp_path):
    # One list polled again inside the safety lag is ordinary operation, not a
    # failure: it is skipped and its watermark stands.
    SharePointCheckpointStore(tmp_path).commit(
        SOURCE,
        window_end=SERVER_NOW,
        ingestion_batch_id="earlier",
        pipeline_run_id="earlier-run",
    )

    polls = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert [poll.case_list for poll in polls] == [OTHER]
    assert [row["case_type"] for row in read_rows(med.silver, "case_version")] == [
        "other"
    ]
    assert landed_gold(tmp_path) == set(GOLD_TABLES)
    checkpoints = SharePointCheckpointStore(tmp_path)
    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG


def test_a_failure_polling_the_second_list_leaves_no_gold_and_no_watermark(tmp_path):
    # Fail fast: the first list's observations are committed (append-only, per
    # hop), but nothing is published and no watermark moves.
    broken = FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [items(item(ResponsibleParty="not an object"))],
        }
    )

    with pytest.raises(SharePointFeedError):
        run(
            RunContext(base_dir=tmp_path, pipeline=FEED_NAME),
            client=broken,
            case_lists=TWO_LISTS,
        )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    checkpoints = SharePointCheckpointStore(tmp_path)
    assert len(read_rows(med.silver, "case_version")) == 1
    assert landed_gold(tmp_path) == set()
    assert checkpoints.committed_watermark(SOURCE) is None
    assert checkpoints.committed_watermark(OTHER_SOURCE) is None


def test_a_retry_after_a_partial_failure_converges_and_advances_both_lists(tmp_path):
    broken = FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [items(item(ResponsibleParty="not an object"))],
        }
    )
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    with pytest.raises(SharePointFeedError):
        run(context, client=broken, case_lists=TWO_LISTS)
    run(context, client=two_list_client(), case_lists=TWO_LISTS)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    checkpoints = SharePointCheckpointStore(tmp_path)
    # The first list's re-read is a no-op against append-only silver.
    assert len(read_rows(med.silver, "case_version")) == 2
    assert len(read_rows(med.gold, "case_current")) == 2
    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG


def test_a_dry_run_on_a_fresh_base_dir_writes_no_gold_and_commits_nothing(tmp_path):
    # The silver write is previewed rather than performed, so there is no table
    # for gold to reduce. Previewing no gold steps is the honest answer.
    report = dry_run_pipeline(
        lambda ctx: run(ctx, client=FakeListClient()), FEED_NAME, tmp_path
    )

    assert not report.failed
    assert landed_gold(tmp_path) == set()
    assert not SharePointCheckpointStore(tmp_path).path.exists()


def test_a_dry_run_previews_every_write_and_commits_none_of_them(tmp_path):
    client = FakeListClient(advance=NEXT_POLL)
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=client)
    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    before = read_rows(med.gold, "case_current")

    report = dry_run_pipeline(lambda ctx: run(ctx, client=client), FEED_NAME, tmp_path)

    # Raw, silver, every silver Detail Table, and every gold table are
    # previewed; none is committed. The fixture item carries no capture map,
    # remediationActions, general answer, Conversation, Appeals or Details, so
    # those six Detail Table writes are empty.
    empty_detail_tables = (
        "answer_capture",
        "answer_action",
        "general_answer",
        "conversation_message",
        "appeal",
        "case_detail",
    )
    expected = [
        ("raw case_observation", 1),
        ("silver case_version", 1),
        ("silver answer", 1),
        *((f"silver {t}", 0) for t in empty_detail_tables),
        ("gold case_current", 1),
        ("gold answer", 1),
        *((f"gold {t}", 0) for t in empty_detail_tables),
        ("gold case_counts_current", 1),
        ("gold case_age_buckets_current", 1),
        ("gold case_throughput_daily", 0),
        # The fixture's one answer row carries no remediation decision at all,
        # so it lands under the UNDECIDED/UNRESOLVED fills; no Appeals means
        # appeal_outcomes_current previews empty.
        ("gold answer_remediation_current", 1),
        ("gold appeal_outcomes_current", 0),
    ]
    assert [step.note for step in report.steps if step.node_type == "Write"] == [
        f"would write {n} row(s)" for _, n in expected
    ]
    assert read_rows(med.gold, "case_current") == before
    # The real run's watermark stands; the preview did not move it on.
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )
