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
from framework.run import (
    RunContext,
    RunLog,
    active_context,
    dry_run_pipeline,
    read,
    transform,
    write,
)
from framework.transform import JsonShapeError, Stamp
from pipelines.sharepoint_cases import gold
from pipelines.sharepoint_cases.gold import (
    ANSWER_REMEDIATION_DIMENSIONS,
    CURRENT_TABLE,
    DETAIL_GRAIN,
    DETAIL_TABLES,
    GOLD_TABLES,
    UNASSIGNED,
    UNDECIDED,
    UNKNOWN_BRAND,
    UNRESOLVED,
    UNSTAMPED,
    UNSTATED,
    age_buckets,
    answer_remediation,
    appeal_outcomes,
    case_counts,
    to_gold_case_current,
    to_gold_detail,
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
    snake_case,
    to_raw,
    to_silver,
    to_silver_answer,
    to_silver_answer_capture,
    to_silver_appeal,
    to_silver_case_detail,
    to_silver_conversation_message,
    to_silver_general_answer,
)
from pipelines.sharepoint_cases.pipeline import run as _run
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
    build_databases,
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

ANSWER_COLUMNS = tuple(f.name for f in fields(AnswerRow))
CAPTURE_COLUMNS = tuple(f.name for f in fields(AnswerCaptureRow))
GENERAL_ANSWER_COLUMNS = tuple(f.name for f in fields(GeneralAnswerRow))
CONVERSATION_MESSAGE_COLUMNS = tuple(f.name for f in fields(ConversationMessageRow))
APPEAL_COLUMNS = tuple(f.name for f in fields(AppealRow))
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
# The name prefix each step of the feed carries. There is no separate grouping
# field any more: a step names the table it is building, and the record's
# ``pipeline`` stays the run's own label throughout.
EVERY_STEP_PREFIX = {
    f"raw:{COMPLAINTS.case_type}",
    f"silver:{COMPLAINTS.case_type}",
    f"silver:{COMPLAINTS.case_type}:answer",
    f"silver:{COMPLAINTS.case_type}:answer_capture",
    f"silver:{COMPLAINTS.case_type}:answer_action",
    f"silver:{COMPLAINTS.case_type}:general_answer",
    f"silver:{COMPLAINTS.case_type}:conversation_message",
    f"silver:{COMPLAINTS.case_type}:appeal",
    f"silver:{COMPLAINTS.case_type}:case_detail",
    *(f"gold:{table}" for table in GOLD_TABLES),
}


def run(context: RunContext, **kwargs):
    """Drive the pipeline with ``context`` ambient, exactly as ``run_pipeline`` does.

    The eager steps read the *ambient* run context, not one passed as an
    argument -- so a ``RunContext(dry_run=True)`` handed straight to ``run``
    would be unseen and the writes it is meant to hold back would land.
    """
    with active_context(context):
        return _run(context, **kwargs)


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
    """The rows ``to_raw`` would store for ``client``'s response."""
    writer = RecordingWriter()
    to_raw(source_reader(client, case_list), writer, case_list)
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
        to_raw(source_reader(client), RecordingWriter(), COMPLAINTS)


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
        to_raw(source_reader(client), RecordingWriter(), COMPLAINTS)


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

    to_raw(source_reader(FakeListClient(pd.DataFrame())), writer, COMPLAINTS)

    assert rows_of(writer) == []
    assert list(writer.writes[0].to_pandas().columns) == list(RAW_FEED_COLUMNS)


def test_a_populated_response_missing_a_stored_column_is_refused():
    # The projection has to select every stored column to build the row at all,
    # so this is where a broken promise surfaces -- named, and before anything
    # lands.
    client = FakeListClient(items(item()).drop(columns=["Status"]))

    with pytest.raises(SharePointFeedError, match="Status"):
        to_raw(source_reader(client), RecordingWriter(), COMPLAINTS)


# --- silver ----------------------------------------------------------------


def test_silver_snake_cases_coerces_and_keeps_the_provenance():
    writer = RecordingWriter()

    to_silver(given_rows(landed(FakeListClient())), writer, COMPLAINTS)

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

    to_silver(given_rows(raw), writer, OTHER)

    assert raw[0]["CaseType"] == cell
    assert rows_of(writer)[0]["case_type"] == "other"


def test_silver_accepts_a_case_with_no_reference_and_nobody_assigned():
    # Title is the human Case Reference: nullable, and carrying no format any
    # part of the application enforces. A row without one is an ordinary row.
    client = FakeListClient(items(item(Title=None, AssignedReviewer=None)))
    writer = RecordingWriter()

    to_silver(given_rows(landed(client)), writer, COMPLAINTS)

    [row] = rows_of(writer)
    assert row["title"] is None
    assert row["assigned_reviewer_name"] is None


@pytest.mark.parametrize("status", CASE_STATUSES)
def test_silver_accepts_every_real_status(status):
    writer = RecordingWriter()

    to_silver(
        given_rows(landed(FakeListClient(items(item(Status=status))))),
        writer,
        COMPLAINTS,
    )

    assert rows_of(writer)[0]["status"] == status


def test_silver_quarantines_an_unknown_status_while_raw_keeps_every_row():
    # The one closed vocabulary this list has. A fifth value means the Choice
    # column changed under us, which should surface rather than reach a report.
    client = FakeListClient(items(item(), item(Id=102, Status="Closed")))
    raw = landed(client)
    writer, rejects = RecordingWriter(), RecordingWriter()
    run_log = RecordingRunLog()

    with active_context(RunContext(pipeline=FEED_NAME, run_log=run_log)):
        to_silver(given_rows(raw), writer, COMPLAINTS, rejects)

    quarantine = next(r for r in run_log.records if r["step"].endswith(":quarantine"))
    assert quarantine["rows_in"] == 2
    assert quarantine["rows_out"] == 1
    assert quarantine["rows_quarantined"] == 1

    assert len(raw) == 2
    assert [row["source_item_id"] for row in rows_of(writer)] == ["101"]
    [rejected] = rows_of(rejects)
    assert rejected["source_item_id"] == "102"
    assert rejected["failed_rule"] == (
        "column 'status' has value(s) outside "
        "{'Actions In Progress', 'Completed', 'In-progress', 'To-allocate', 'Void'}"
    )


def test_silver_aborts_when_the_id_is_missing():
    # Structural, not a value rule: a Case with no id cannot be a Case version.
    writer = RecordingWriter()
    reader = given_rows([{column: None for column in RAW_FEED_COLUMNS}])

    with pytest.raises(ValidationError, match="'id'"):
        to_silver(reader, writer, COMPLAINTS)

    assert writer.writes == []


# Reuses `version()`, defined below: its stamps are exactly DETAIL_ID_VARS,
# which is the point under test.

# --- silver: the Detail Table explodes ---------------------------------------


def silver_answers(
    answers_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive ``to_silver_answer``, in memory, over one observation's `answers`."""
    writer = RecordingWriter()
    to_silver_answer(
        given_rows([version(answers=answers_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    )
    return rows_of(writer)


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


def silver_captures(
    answers_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
    run_log: RunLog | None = None,
) -> list[dict]:
    """Drive ``to_silver_answer_capture``, in memory, over one observation's
    `answers`."""
    writer = RecordingWriter()

    def drive() -> None:
        to_silver_answer_capture(
            given_rows([version(answers=answers_json)]),
            writer,
            case_list,
            reject_writer or RecordingWriter(),
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


def silver_general_answers(
    answers_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive ``to_silver_general_answer``, in memory, over one observation's
    `answers`."""
    writer = RecordingWriter()
    to_silver_general_answer(
        given_rows([version(answers=answers_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    )
    return rows_of(writer)


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


def silver_conversation_messages(
    conversation_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive ``to_silver_conversation_message``, in memory, over one
    observation's `conversation`."""
    writer = RecordingWriter()
    to_silver_conversation_message(
        given_rows([version(conversation=conversation_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    )
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
    # author is a nested object, lifted by two dotted paths rather than landed
    # as a JSON blob.
    assert rows[0]["author_login"] == "a.khan"
    assert rows[0]["author_display_name"] == "Amira Khan"
    for row in rows:
        assert set(row) == set(CONVERSATION_MESSAGE_COLUMNS)
        assert row["case_type"] == COMPLAINTS.case_type
        assert row["source_item_id"] == "101"
        assert row["source_version"] == '"3"'
        assert row["source_modified_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
        assert len(row["source_observation_id"]) > 0


def silver_appeals(
    appeals_json: str,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive ``to_silver_appeal``, in memory, over one observation's `appeals`."""
    writer = RecordingWriter()
    to_silver_appeal(
        given_rows([version(appeals=appeals_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    )
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
    [row] = silver_appeals(json.dumps([appeal(state="raised")]))

    assert row["resolution_verdict"] is None
    assert row["resolution_rationale"] is None
    assert row["resolution_resolver"] is None
    assert row["resolution_at"] is None


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
        reject_writer=rejects,
    )

    assert [row["appeal_id"] for row in rows] == ["appeal-1"]
    [rejected] = rows_of(rejects)
    assert rejected["appeal_id"] == "appeal-2"
    assert "state" in rejected["failed_rule"]


def silver_case_details(
    details_json: str | None,
    *,
    case_list: CaseList = COMPLAINTS,
    reject_writer: RecordingWriter | None = None,
) -> list[dict]:
    """Drive ``to_silver_case_detail``, in memory, over one observation's
    `details`."""
    writer = RecordingWriter()
    to_silver_case_detail(
        given_rows([version(details=details_json)]),
        writer,
        case_list,
        reject_writer or RecordingWriter(),
    )
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


def test_an_empty_details_map_survives_every_step_as_a_zero_row_frame():
    # ExplodeJsonMap's own suite covers the zero-row output; only this feed's
    # test shows every step below tolerates that zero-row frame.
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
    # Without encode_detail_value, the int/float/bool arms land value_text as
    # a non-string dtype and abort at SchemaValidator's is_string_dtype check.
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
    """Drive one gold build in memory and hand back what it would have written."""
    writer = RecordingWriter()
    builder(given_rows(rows), writer, as_of=as_of)
    return rows_of(writer)


def current(*rows: dict) -> list[dict]:
    """The ``case_current`` rows for a silver history."""
    return gold_rows(to_gold_case_current, list(rows))


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


AMENDED_COLUMNS = (
    "amended_outcome_id",
    "amended_reason",
    "amended_justification",
    "amended_by",
    "amended_at",
    "amended_from_appeal_id",
)


# The five raw JSON blob columns, which gold does not republish: each one's
# data lives in its normalised home (the Detail Tables; the amended_* columns),
# and silver case_version keeps the landed text.
BLOB_COLUMNS = ("answers", "conversation", "appeals", "amended_outcome", "details")


def test_current_gold_republishes_every_silver_column_except_the_blobs():
    [row] = current(version())

    assert set(SILVER_COLUMNS) - set(row) == set(BLOB_COLUMNS)
    assert set(row) - set(SILVER_COLUMNS) == {
        "case_id",
        "as_of_utc",
        *AMENDED_COLUMNS,
    }


def test_a_reason_carrying_amendment_flattens_onto_the_current_row():
    # The qa-check/tm-check provenance arm: a reason key, no source Appeal.
    blob = json.dumps(
        {
            "outcome": "poor-with-harm",
            "reason": "qa-check",
            "justification": "The missed needs check was immaterial.",
            "amendedBy": "user-controls",
            "amendedAt": "2026-06-12T00:00:00.000Z",
        }
    )

    [row] = current(version(amended_outcome=blob))

    assert row["amended_outcome_id"] == "poor-with-harm"
    assert row["amended_reason"] == "qa-check"
    assert row["amended_justification"] == "The missed needs check was immaterial."
    assert row["amended_by"] == "user-controls"
    # ISO text, verbatim: text inside a blob stays text.
    assert row["amended_at"] == "2026-06-12T00:00:00.000Z"
    assert pd.isna(row["amended_from_appeal_id"])
    # The flatten consumes the blob: the columns are its only gold home now,
    # and silver case_version keeps the landed text.
    assert "amended_outcome" not in row


def test_an_appeal_derived_amendment_carries_the_appeal_id_and_no_reason():
    # The other provenance arm: fromAppealId (which joins appeal.appeal_id) is
    # present iff the amendment came from agreeing an Appeal, and the app then
    # writes no reason key.
    blob = json.dumps(
        {
            "outcome": "poor-no-harm",
            "justification": "Appeal agreed.",
            "amendedBy": "user-controls",
            "amendedAt": "2026-06-12T00:00:00Z",
            "fromAppealId": "appeal-1754390400000",
        }
    )

    [row] = current(version(amended_outcome=blob))

    assert row["amended_outcome_id"] == "poor-no-harm"
    assert row["amended_from_appeal_id"] == "appeal-1754390400000"
    assert pd.isna(row["amended_reason"])


@pytest.mark.parametrize(
    "blob",
    [
        pytest.param(None, id="never-written"),
        pytest.param("", id="empty"),
        pytest.param("null", id="explicitly-cleared"),
    ],
)
def test_a_case_with_no_amendment_carries_nulls_not_a_crash(blob):
    # The column holds the JSON literal "null" when explicitly cleared and is
    # empty or absent if never written; all three land identically.
    [row] = current(version(amended_outcome=blob))

    assert all(pd.isna(row[column]) for column in AMENDED_COLUMNS)


def test_a_malformed_amendment_in_a_losing_observation_cannot_abort_gold():
    # The flatten sits after the reduction, so only each Case's winning blob is
    # ever parsed: a malformed blob in superseded history stays recoverable in
    # silver without holding the rebuild hostage.
    rows = current(
        version(
            source_version='"3"',
            source_modified_at="2026-08-05 08:10:00+00:00",
            amended_outcome="{not json",
        ),
        version(
            source_version='"4"',
            source_modified_at="2026-08-05 08:45:00+00:00",
            amended_outcome=json.dumps({"outcome": "good"}),
        ),
    )

    assert [row["amended_outcome_id"] for row in rows] == ["good"]


# One representative grain: the builder is generic over DETAIL_GRAIN, and these
# tests exercise the composition, not a per-table peculiarity.
DETAIL_TABLE = "answer"

# --- gold: the Detail Table reduction ----------------------------------------


def winning_reader(*rows: dict) -> Reader:
    """The gold ``case_current`` a parent observation history would produce.

    Composes the real ``to_gold_case_current`` rather than hand-building the
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
    """Drive ``to_gold_detail`` over a child history, in memory."""
    return gold_rows(
        partial(
            to_gold_detail,
            grain=grain,
            observations=winners,
            name=f"{FEED_NAME}:gold:detail:{DETAIL_TABLE}",
        ),
        children,
    )


def test_a_child_stripped_from_the_winning_observation_does_not_survive():
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


def test_a_repeated_grain_value_in_the_winning_observation_aborts_the_build():
    winners = winning_reader(version(source_observation_id="obs-1"))
    writer = RecordingWriter()
    children = [
        child(source_observation_id="obs-1", question_id="q1"),
        child(source_observation_id="obs-1", question_id="q1"),
    ]

    with pytest.raises(ValidationError, match="question_id"):
        to_gold_detail(
            given_rows(children),
            writer,
            grain=DETAIL_GRAIN[DETAIL_TABLE],
            observations=winners,
            as_of=AS_OF,
            name=f"{FEED_NAME}:gold:detail:{DETAIL_TABLE}",
        )

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


def to_gold_aggregate(reader, writer, *, table: str, reduce, step: str) -> Dataset:
    """Drive one aggregate exactly as ``publish_gold``'s loop does."""
    at = f"gold:{table}"
    data = read(reader, name=f"{at}:read")
    data = transform(reduce, data, name=f"{at}:{step}")
    data = transform(
        Stamp("as_of_utc", AS_OF.isoformat()), data, name=f"{at}:stamp-as-of"
    )
    return write(writer, data, name=f"{at}:write")


def aggregate(reduce, step: str, rows: list[dict]) -> list[dict]:
    """Drive one aggregate, as ``publish_gold`` wires it, over ``rows``."""
    writer = RecordingWriter()
    to_gold_aggregate(
        given_rows(rows),
        writer,
        table="table",
        reduce=reduce,
        step=step,
    )
    return rows_of(writer)


def counts(*rows: dict) -> list[dict]:
    return aggregate(case_counts, "count-by-base-grain-and-status", current(*rows))


def grain(rows: list[dict]) -> list[tuple]:
    return [
        (
            row["brand"],
            row["case_type"],
            row["assigned_reviewer_name"],
            row["status"],
            row["case_count"],
        )
        for row in rows
    ]


def test_current_counts_match_the_current_table():
    # Two Cases with one reviewer, split by status, and a third under a
    # second reviewer.
    rows = counts(
        version(),
        version(id=102, source_item_id="102", status="Completed"),
        version(
            id=103,
            source_item_id="103",
            assigned_reviewer_name="i:0#.w|CONTOSO\\r.okafor",
        ),
    )

    assert grain(rows) == [
        (
            UNKNOWN_BRAND,
            COMPLAINTS.case_type,
            "i:0#.w|CONTOSO\\p.shah",
            "Completed",
            1,
        ),
        (
            UNKNOWN_BRAND,
            COMPLAINTS.case_type,
            "i:0#.w|CONTOSO\\p.shah",
            "In-progress",
            1,
        ),
        (
            UNKNOWN_BRAND,
            COMPLAINTS.case_type,
            "i:0#.w|CONTOSO\\r.okafor",
            "In-progress",
            1,
        ),
    ]
    assert {row["as_of_utc"] for row in rows} == {AS_OF.isoformat()}


def test_two_case_types_under_one_reviewer_produce_two_rows():
    # Same reviewer, two Case Types: the base grain keeps them as two rows
    # rather than summing across Case Type.
    rows = counts(
        version(),
        version(id=102, source_item_id="102", case_type=OTHER.case_type),
    )

    assert grain(rows) == [
        (
            UNKNOWN_BRAND,
            COMPLAINTS.case_type,
            "i:0#.w|CONTOSO\\p.shah",
            "In-progress",
            1,
        ),
        (
            UNKNOWN_BRAND,
            OTHER.case_type,
            "i:0#.w|CONTOSO\\p.shah",
            "In-progress",
            1,
        ),
    ]
    assert sum(row["case_count"] for row in rows) == 2


def test_a_case_with_nobody_assigned_is_counted_as_unassigned():
    # A NULL group key is a hole in the grain that a reader may silently drop,
    # so this Case is counted under a literal instead — in a table whose whole
    # job is to add up to the number of current Cases.
    rows = counts(version(assigned_reviewer_name=None))

    assert grain(rows) == [
        (UNKNOWN_BRAND, COMPLAINTS.case_type, UNASSIGNED, "In-progress", 1)
    ]


# --- gold: the age profile ---------------------------------------------------


def aged(*rows: dict) -> list[dict]:
    return aggregate(partial(age_buckets, as_of=AS_OF), "bucket-by-age", current(*rows))


def days_before(age: int) -> str:
    """A stamp exactly ``age`` local calendar days before ``as_of`` -- used for
    both ``created`` and ``assigned_at``, which share the same age arithmetic."""
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
    [row] = aged(version(created=days_before(age)))

    assert (row["age_bucket"], row["age_bucket_order"]) == (label, order)
    assert row["case_count"] == 1
    assert row["as_of_utc"] == AS_OF.isoformat()


def test_a_case_with_no_created_date_has_an_unknown_age():
    [row] = aged(version(created=None))

    assert (row["age_bucket"], row["age_bucket_order"]) == ("unknown", 5)


def test_a_case_created_after_the_as_of_instant_is_unknown_rather_than_clamped():
    # Impossible while created <= Modified < as_of, so if it happens it is
    # corruption and belongs somewhere visible.
    [row] = aged(version(created=days_before(-3)))

    assert row["age_bucket"] == "unknown"


def test_every_current_case_lands_in_exactly_one_age_bucket():
    # The docs claim the age profile totals to the number of current Cases —
    # every Case in one bucket, `unknown` catching the ones with no created date.
    history = (
        version(created=days_before(2)),
        version(id=102, source_item_id="102", created=days_before(40)),
        version(id=103, source_item_id="103", created=None, status="Completed"),
    )

    assert sum(row["case_count"] for row in aged(*history)) == len(current(*history))


def test_age_buckets_carry_the_base_grain():
    [row] = aged(version())

    assert (row["brand"], row["case_type"], row["assigned_reviewer_name"]) == (
        UNKNOWN_BRAND,
        COMPLAINTS.case_type,
        "i:0#.w|CONTOSO\\p.shah",
    )


def test_an_unassigned_case_is_counted_as_unassigned_in_the_age_profile():
    # Without this fill, pandas' groupby would silently drop the Case's NULL
    # reviewer key, breaking the invariant that this table totals to the same
    # count as case_counts_current.
    [row] = aged(version(assigned_reviewer_name=None))

    assert row["assigned_reviewer_name"] == UNASSIGNED
    assert row["case_count"] == 1


# --- gold: the age-from-assigned profile -------------------------------------


def aged_from_assigned(*rows: dict) -> list[dict]:
    return aggregate(
        partial(age_buckets, as_of=AS_OF, age_from="assigned_at"),
        "bucket-by-age-from-assigned",
        current(*rows),
    )


def test_an_age_from_assigned_falls_in_the_bucket_its_days_indicate():
    [row] = aged_from_assigned(version(assigned_at=days_before(10)))

    assert (row["age_bucket"], row["age_bucket_order"]) == ("8-14 days", 1)
    assert row["case_count"] == 1


def test_a_case_never_assigned_has_an_unknown_age_from_assigned():
    # Unlike a null `created`, a null `assigned_at` is an ordinary state — the
    # Case simply has not been handed to anyone yet — so `unknown` here means
    # never-assigned, not corruption.
    [row] = aged_from_assigned(version(assigned_at=None))

    assert (row["age_bucket"], row["age_bucket_order"]) == ("unknown", 5)


def test_every_current_case_lands_in_exactly_one_age_from_assigned_bucket():
    history = (
        version(assigned_at=days_before(2)),
        version(
            id=102,
            source_item_id="102",
            assigned_at=None,
            status="Completed",
        ),
    )

    assert sum(row["case_count"] for row in aged_from_assigned(*history)) == len(
        current(*history)
    )


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
        (
            row["terminal_date"],
            row["brand"],
            row["case_type"],
            row["assigned_reviewer_name"],
            row["terminal_status"],
            row["case_count"],
        )
        for row in ended(*history)
    ] == [
        (
            "2026-08-05",
            UNKNOWN_BRAND,
            COMPLAINTS.case_type,
            "i:0#.w|CONTOSO\\p.shah",
            "Completed",
            1,
        )
    ]


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

    assert [
        (row["terminal_date"], row["assigned_reviewer_name"], row["terminal_status"])
        for row in rows
    ] == [
        ("2026-08-04", "i:0#.w|CONTOSO\\p.shah", "Void"),
        ("2026-08-05", "i:0#.w|CONTOSO\\p.shah", "Completed"),
    ]


def test_an_unassigned_terminal_case_is_counted_as_unassigned():
    rows = ended(
        version(
            assigned_reviewer_name=None,
            status="Completed",
            completed_at="2026-08-05 08:44:00+00:00",
        )
    )

    assert [row["assigned_reviewer_name"] for row in rows] == [UNASSIGNED]


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


def test_throughput_returns_the_same_columns_whether_or_not_anything_ended():
    # The empty-terminal branch hand-declares its shape; this pins it to the
    # populated path so the two cannot silently drift apart.
    populated = throughput_transform(
        given_rows(
            current(
                version(
                    status="Completed",
                    completed_at="2026-08-05 08:44:00+00:00",
                )
            )
        ).read()
    )
    empty = throughput_transform(given_rows(current(version())).read())

    assert list(populated.to_pandas().columns) == list(empty.to_pandas().columns)


# Reuses winning_reader() and details() above: proving this aggregate comes
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


# --- gold: aggregates over the Detail Tables ---------------------------------


def gold_answer(children: list[dict], winners: Reader) -> list[dict]:
    """The gold ``answer`` Detail Table rows a child history reduces to."""
    return details(children, winners, grain=DETAIL_GRAIN["answer"])


def remediation(rows: list[dict]) -> list[dict]:
    return aggregate(answer_remediation, "count-by-remediation", rows)


def test_remediation_counts_come_from_the_winning_observation():
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
    # answer_count sums to gold answer's row count, not a Case count.
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

    # Question ids are per-Case-Type bank, so distinct case_types must not merge.
    assert len(rows) == 2
    assert {row["case_type"] for row in rows} == {
        COMPLAINTS.case_type,
        OTHER.case_type,
    }
    assert all(row["answer_count"] == 1 for row in rows)


def test_remediation_is_empty_when_nothing_was_answered():
    writer = RecordingWriter()
    to_gold_aggregate(
        given_columns(*ANSWER_REMEDIATION_DIMENSIONS),
        writer,
        table="table",
        reduce=answer_remediation,
        step="count-by-remediation",
    )

    frame = writer.dataset.to_pandas()
    assert list(frame.columns) == [
        *ANSWER_REMEDIATION_DIMENSIONS,
        "answer_count",
        "as_of_utc",
    ]
    assert len(frame) == 0


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
    # Must count once, as resolved/agreed -- never twice across both observations.
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
    # Also proves a null state counts as unstated.
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


def test_an_aggregate_is_never_mistaken_for_a_detail_table():
    assert set(DETAIL_TABLES) == set(DETAIL_GRAIN)


# --- the composed plan -----------------------------------------------------


@pytest.fixture
def recorded(base_dir) -> RecordingRunLog:
    """One real poll, with every step it took captured.

    The steps are eager, so what the feed *did* is what it recorded -- which is
    both a stronger pin than reading a plan and the thing an operator actually
    sees. Each step name is prefixed with the table it is building, so the
    records group by that prefix.
    """
    run_log = RecordingRunLog()
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=FakeListClient(),
    )
    return run_log


def steps_of(run_log: RecordingRunLog, prefix: str) -> list[str]:
    """The steps recorded under one name prefix, in the order they were taken."""
    return [
        record["step"].rsplit(":", 1)[1]
        for record in run_log.records
        if record["step"].rsplit(":", 1)[0] == prefix
    ]


def test_all_nine_ingest_steps_record_exactly_what_they_always_have(recorded):
    silver = f"silver:{COMPLAINTS.case_type}"

    # No column gate on the source -> raw step, unlike a file feed: the
    # observation transform projects onto exactly the stored columns, so a
    # presence check below it could never fire. Each step name carries the list
    # it polled, which is what keeps 134 records in one poll readable.
    assert steps_of(recorded, f"raw:{COMPLAINTS.case_type}") == [
        "read",
        "observation",
        "write",
    ]
    # coerce / quarantine / schema_validator are ``enforce``'s three steps: it
    # is shorthand for the sequence, not a step of its own, so the run log reads
    # exactly as it did when they were written out by hand.
    assert steps_of(recorded, silver) == [
        "read",
        "rename",
        "case-type",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:answer") == [
        "read",
        "explode",
        "value-text",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    # The one that cannot use ``enforce``: raw_value is dropped between the
    # quarantine and the validate, so the three are written out.
    assert steps_of(recorded, f"{silver}:answer_capture") == [
        "read",
        "explode-answers",
        "explode-capture",
        "discriminate",
        "coerce",
        "quarantine",
        "drop-raw-value",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:answer_action") == [
        "read",
        "explode-answers",
        "explode-actions",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:general_answer") == [
        "read",
        "explode",
        "value-text",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:conversation_message") == [
        "read",
        "explode",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:appeal") == [
        "read",
        "explode",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:case_detail") == [
        "read",
        "explode",
        "encode-value",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]


def test_the_gold_tables_record_exactly_the_steps_they_always_have(recorded):
    # Only the current table carries a grain gate; see to_gold_case_current.
    assert steps_of(recorded, f"gold:{CURRENT_TABLE}") == [
        "read",
        "derive-key",
        "latest-version",
        "flatten-amended-outcome",
        "drop-blobs",
        "stamp-as-of",
        "unique-validate",
        "write",
    ]
    for table in DETAIL_TABLES:
        assert steps_of(recorded, f"gold:{table}") == [
            "read",
            "derive-key",
            "latest-observation",
            "stamp-as-of",
            "unique-validate",
            "write",
        ], table
    for table, step in (
        ("case_counts_current", "count-by-base-grain-and-status"),
        ("case_age_buckets_current", "bucket-by-age"),
        ("case_age_from_assigned_buckets_current", "bucket-by-age-from-assigned"),
        ("case_throughput_daily", "count-by-terminal-date"),
        ("answer_remediation_current", "count-by-remediation"),
        ("appeal_outcomes_current", "count-by-outcome"),
    ):
        assert steps_of(recorded, f"gold:{table}") == [
            "read",
            step,
            "stamp-as-of",
            "write",
        ], table


# --- end to end ------------------------------------------------------------


@pytest.fixture
def base_dir(tmp_path):
    """A base directory with this feed's checked-in migrations applied.

    ``sharepoint_cases`` is under migration control, so its tables are declared
    by ``migrations/sharepoint_cases/`` rather than created by the first write.
    An end-to-end test against a bare ``tmp_path`` would exercise the branch the
    feed no longer takes — and would not notice a baseline that forgot a table,
    which is exactly what these tests are here to catch.
    """
    return build_databases(tmp_path, FEED_NAME)


def test_the_bundled_sample_lands_every_item_across_both_pages(base_dir, capsys):
    [poll] = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=LocalJsonListClient()
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
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
    # Counts below are derived from cases_page_1.json / cases_page_2.json's
    # per-item content -- see those fixtures for the breakdown. Both Conversation
    # and Appeals timestamps there deliberately mix formats.
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
    # The fixture exercises every real status, so the whole vocabulary passes
    # the schema gate rather than only the one a happy path would use.
    assert {row["status"] for row in read_rows(med.silver, "case_version")} == set(
        CASE_STATUSES
    )
    # A single poll, so every Case's only observation is its winning one.
    assert sum(
        row["answer_count"] for row in read_rows(med.gold, "answer_remediation_current")
    ) == len(read_rows(med.gold, "answer"))
    assert sum(
        row["appeal_count"] for row in read_rows(med.gold, "appeal_outcomes_current")
    ) == len(read_rows(med.gold, "appeal"))

    # main()'s per-poll line is derived from detail_rows and otherwise
    # unpinned; exercise the CLI path once, against a separate base dir, to
    # lock its shape down.
    exit_code = main(["prog", "--base-dir", str(base_dir / "via-cli"), "--sample"])
    assert exit_code == 0
    assert (
        "5 observation(s) -> 5 case version(s), 6 answer row(s), "
        "2 answer_capture row(s), 1 answer_action row(s), "
        "1 general_answer row(s), 3 conversation_message row(s), "
        "2 appeal row(s), 13 case_detail row(s)."
    ) in capsys.readouterr().out


def test_a_repeated_observation_is_a_no_op_in_raw_and_silver(base_dir):
    client = FakeListClient(advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_later_source_version_appends_a_second_case_version(base_dir):
    later = item(Status="Completed")
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    client = FakeListClient(items(item()), items(later), advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert [
        (row["status"], row["source_version"])
        for row in read_rows(med.silver, "case_version")
    ] == [("In-progress", '"3"'), ("Completed", '"4"')]


def test_the_same_observation_carrying_a_different_payload_is_refused(base_dir):
    # Same Id and same etag, so the same observation id -- but the row moved.
    client = FakeListClient(
        items(item()), items(item(Status="Completed")), advance=NEXT_POLL
    )
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)

    with pytest.raises(AppendOnlyConflictError, match="already present with different"):
        run(context, client=client)


def test_a_quiet_window_writes_cleanly_and_a_later_one_still_appends(base_dir):
    # The common steady-state poll: nothing changed in the window.
    client = FakeListClient(pd.DataFrame(), items(item()), advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    [quiet] = run(context, client=client)
    [busy] = run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert (quiet.raw_rows, quiet.silver_rows) == (0, 0)
    assert (busy.raw_rows, busy.silver_rows) == (1, 1)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_quiet_first_window_still_types_the_columns_it_creates(base_dir):
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
        base = base_dir / order
        context = RunContext(base_dir=base, pipeline=FEED_NAME)
        run(context, client=client)
        run(context, client=client)
        med = medallion(StoreRegistry(base), FEED_NAME)
        landed.append(read_rows(med.silver, "case_version")[0]["id"])

    assert landed[0] == landed[1]
    assert isinstance(landed[0], int)


def test_a_quiet_window_still_runs_and_records_every_step(base_dir):
    # A quiet poll is not a different pipeline: an operator reading the run log
    # still sees every step, against every table, with zero rows.
    log_path = base_dir / "runs.log"
    context = RunContext(
        base_dir=base_dir, pipeline=FEED_NAME, run_log=RunLog(log_path)
    )

    run(context, client=FakeListClient(pd.DataFrame()))

    records = read_run_log(log_path)
    assert {record["step"].rsplit(":", 1)[0] for record in records} == EVERY_STEP_PREFIX
    # One label for the whole poll: the grouping is in the step name, not in a
    # second identity the run also records under.
    assert {record["pipeline"] for record in records} == {FEED_NAME}
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

    # Gold publishes in GOLD_TABLES's declared order.
    gold_names = [
        record["step"].rsplit(":", 1)[0]
        for record in records
        if record["step"].startswith("gold:")
    ]
    assert list(dict.fromkeys(gold_names)) == [f"gold:{table}" for table in GOLD_TABLES]


def test_nothing_safe_to_poll_returns_nothing_and_writes_nothing(base_dir):
    SharePointCheckpointStore(base_dir).commit(
        SOURCE,
        window_end=SERVER_NOW,
        ingestion_batch_id="earlier",
        pipeline_run_id="earlier-run",
    )

    assert (
        run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=FakeListClient())
        == []
    )
    assert nothing_landed(base_dir)


def test_the_run_log_identifies_the_list_and_every_table(base_dir):
    log_path = base_dir / "runs.log"
    context = RunContext(
        base_dir=base_dir, pipeline=FEED_NAME, run_log=RunLog(log_path)
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


def test_running_with_no_client_refuses_as_an_operator_failure(base_dir, capsys):
    # The documented default invocation without --sample. Forgetting the client
    # is an operator's mistake, and the message names the fix, so it is worth
    # more to print it than a stack trace.
    exit_code = main(["prog", "--base-dir", str(base_dir)])

    assert exit_code == 1
    assert "--sample" in capsys.readouterr().err
    assert nothing_landed(base_dir)


def test_run_with_no_client_refuses_as_a_wiring_failure(base_dir):
    # How the operator CLI and the orchestrator both reach a feed: run(context),
    # with no way to pass a client. That must abort as a caught, categorised
    # failure rather than as a stack trace the operator has to read.
    with pytest.raises(NoClientError) as refused:
        run(RunContext(base_dir=base_dir, pipeline=FEED_NAME))

    assert refused.value.category == ErrorCategory.CONFIG
    assert nothing_landed(base_dir)


def test_the_sample_client_replays_both_pages_as_one_first_load():
    frame = LocalJsonListClient().fetch_items(COMPLAINTS.list_name, (), (), ())

    assert list(frame["Id"]) == [101, 102, 103, 104, 105]


def test_the_sample_client_names_a_list_it_has_no_pages_for():
    with pytest.raises(SharePointFeedError, match="Cases-Other"):
        LocalJsonListClient().fetch_items(OTHER.list_name, (), (), ())


# --- end to end: gold, and the checkpoint last -------------------------------


def nothing_landed(base_dir) -> bool:
    """Whether the subject's databases are all still empty.

    "The run wrote nothing" used to be "the subject's directory does not exist":
    nothing created it because nothing wrote. Under migration control the
    databases exist before the run does anything, so the claim has to be made
    about their contents instead — which is the thing those tests meant all
    along.
    """
    for db_path in sorted((base_dir / FEED_NAME).glob("*.db")):
        connection = sqlite3.connect(db_path)
        try:
            tables = [
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'"
                )
            ]
            for table in tables:
                if connection.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone():
                    return False
        finally:
            connection.close()
    return True


def published_gold(run_log: RecordingRunLog) -> set[str]:
    """Which gold tables a run actually published into, per its own record.

    This used to read ``sqlite_master``: a gold table existed exactly when a
    run had created it by writing, so presence answered "was gold published?".
    Under migration control every gold table exists before the run does
    anything — the migration created it — so presence answers nothing, and the
    question has to be put to the run instead. A committed write record naming
    a gold location is the publication, whether it carried rows or not, which
    also makes the quiet-window case say what it means rather than relying on
    an empty table having been created as a side effect.
    """
    return {
        location["name"]
        for record in run_log.records
        if record.get("committed") and record["step"].startswith("gold:")
        for location in record.get("data_locations") or []
    }


def explode(*args: object, **kwargs: object):
    raise RuntimeError("boom")


def test_a_poll_publishes_every_gold_table_and_then_commits_the_watermark(base_dir):
    run_log = RecordingRunLog()
    [poll] = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=FakeListClient(),
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert poll.window.end == SERVER_NOW - SAFETY_LAG
    assert poll.ingestion_batch_id == f"{COMPLAINTS.list_id}:first-load"
    assert published_gold(run_log) == set(GOLD_TABLES)
    [case] = read_rows(med.gold, "case_current")
    assert (case["source_item_id"], case["status"]) == ("101", "In-progress")
    assert case["as_of_utc"] == (SERVER_NOW - SAFETY_LAG).isoformat()
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )


def test_the_winning_observation_settles_gold_answer_and_drops_the_others(base_dir):
    early = item(Answers=json.dumps({"q1": {"value": "A"}, "q2": {"value": "X"}}))
    later = item(
        Answers=json.dumps({"q1": {"value": "B"}, "q3": {"value": "Y"}}),
        Status="Completed",
    )
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    client = FakeListClient(items(early), items(later), advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    # Silver is append-only: it keeps both observations, not just the winner.
    assert len(read_rows(med.silver, "answer")) == 4

    gold_answer = read_rows(med.gold, "answer")
    assert {row["question_id"] for row in gold_answer} == {"q1", "q3"}
    [winner] = read_rows(med.gold, "case_current")
    assert {row["source_observation_id"] for row in gold_answer} == {
        winner["source_observation_id"]
    }


def test_the_winning_observation_settles_gold_general_answer_and_drops_the_others(
    base_dir,
):
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
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    # Silver is append-only: it keeps both observations, not just the winner.
    assert len(read_rows(med.silver, "general_answer")) == 4

    gold_general_answer = read_rows(med.gold, "general_answer")
    assert {row["general_key"] for row in gold_general_answer} == {"a", "c"}
    [winner] = read_rows(med.gold, "case_current")
    assert {row["source_observation_id"] for row in gold_general_answer} == {
        winner["source_observation_id"]
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
    stripped_later = item(
        Id=101,
        Answers=json.dumps({"q1": {"value": "A", "remediationRequired": "no"}}),
        Status="Completed",
    )
    stripped_later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})

    # Item 102 adds a genuinely new capture field on poll 2, proving gold
    # reflects an addition rather than always landing empty.
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
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

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
    early = item(Conversation=json.dumps([message_1, message_2]))
    later = item(
        Conversation=json.dumps([message_1, message_2, message_3]),
        Status="Completed",
    )
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})

    # Companion: an Appeal in the shape resolveAppeal() writes in the real app.
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
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.silver, "conversation_message")) == 5
    [winner] = read_rows(med.gold, "case_current")

    gold_messages = read_rows(med.gold, "conversation_message")
    assert [row["seq"] for row in gold_messages] == [0, 1, 2]
    assert {row["source_observation_id"] for row in gold_messages} == {
        winner["source_observation_id"]
    }

    # Gold holds the Appeal once, resolved, with every resolution_* column filled.
    assert len(read_rows(med.silver, "appeal")) == 2
    [gold_appeal] = read_rows(med.gold, "appeal")
    assert gold_appeal["appeal_id"] == "appeal-1"
    assert gold_appeal["state"] == "resolved"
    assert gold_appeal["resolution_verdict"] == "agreed"
    assert gold_appeal["resolution_resolver"] == "d.reid"


def test_the_winning_observation_settles_gold_case_detail_and_drops_the_others(
    base_dir,
):
    # The composite AppendOnly key (source_observation_id, field_key) is under
    # test -- no other end-to-end test exercises this table otherwise, since
    # item()'s default Details cell falls into the absent -> None sweep.
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
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
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


def test_a_malformed_answers_blob_raises_and_case_version_still_lands(base_dir):
    run_log = RecordingRunLog()
    client = FakeListClient(items(item(Answers="not json")))
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log)

    with pytest.raises(JsonShapeError):
        run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.silver, "case_version")) == 1
    assert published_gold(run_log) == set()
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) is None


def test_a_malformed_details_blob_raises_and_case_version_details_still_holds_it(
    base_dir,
):
    run_log = RecordingRunLog()
    client = FakeListClient(items(item(Details="not json")))
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log)

    with pytest.raises(JsonShapeError):
        run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert published_gold(run_log) == set()
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) is None
    # The frontend's Details parse fallback is undefined, so absent and
    # unparseable are indistinguishable downstream -- silver is the only place
    # the raw text survives.
    [case_version] = read_rows(med.silver, "case_version")
    assert case_version["details"] == "not json"


def test_a_quiet_first_window_commits_and_publishes_fourteen_empty_gold_tables(
    base_dir,
):
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


def test_an_overlap_reread_does_not_double_count_gold(base_dir):
    # The overlap re-presents rows that did not change. Silver no-ops them; gold
    # must not count the Case twice either.
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
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

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.gold, "case_current")) == 1
    assert [
        row["case_count"] for row in read_rows(med.gold, "case_counts_current")
    ] == [1]
    assert len(read_rows(med.silver, "answer")) == 1
    # Proves the composite (source_observation_id, field_key) key: a wrong
    # single-column key would raise an AppendOnly conflict here instead of a
    # clean no-op.
    assert len(read_rows(med.silver, "case_detail")) == 2


def test_a_failure_in_current_gold_leaves_no_gold_and_no_checkpoint(
    base_dir, monkeypatch
):
    run_log = RecordingRunLog()
    monkeypatch.setattr(gold, "to_gold_case_current", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(
            RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
            client=FakeListClient(),
        )

    checkpoints = SharePointCheckpointStore(base_dir)
    assert published_gold(run_log) == set()
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_a_failure_in_the_last_aggregate_leaves_the_earlier_gold_and_no_checkpoint(
    base_dir, monkeypatch
):
    # Gold Writers commit independently, so an earlier table stays refreshed.
    # That is acceptable evidence: the watermark did not move, so the next run
    # rebuilds everything from the same history and converges. appeal_outcomes
    # is the last table GOLD_TABLES declares.
    run_log = RecordingRunLog()
    monkeypatch.setattr(gold, "appeal_outcomes", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(
            RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
            client=FakeListClient(),
        )

    checkpoints = SharePointCheckpointStore(base_dir)
    assert published_gold(run_log) == {
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
        "case_age_from_assigned_buckets_current",
        "case_throughput_daily",
        "answer_remediation_current",
    }
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_a_retry_after_a_partial_failure_converges_and_advances_once(
    base_dir, monkeypatch
):
    run_log = RecordingRunLog()
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log)
    client = FakeListClient(advance=NEXT_POLL)
    checkpoints = SharePointCheckpointStore(base_dir)
    monkeypatch.setattr(gold, "throughput", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(context, client=client)
    assert checkpoints.committed_watermark(SOURCE) is None

    monkeypatch.undo()
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert published_gold(run_log) == set(GOLD_TABLES)
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


def test_two_lists_land_in_one_observation_table_and_one_version_table(base_dir):
    # All Case Types share one list template, so every list refines into the
    # same two tables and is told apart by the Case Type on the row.
    polls = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
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


def test_the_same_item_id_in_two_lists_is_two_cases(base_dir):
    # Item 101 exists in every list, so neither the observation id nor the
    # case_id may be derived from it alone.
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    current_cases = read_rows(med.gold, "case_current")
    assert {row["source_item_id"] for row in current_cases} == {"101"}
    assert len({row["case_id"] for row in current_cases}) == 2
    assert len({row["source_observation_id"] for row in current_cases}) == 2


def test_gold_counts_across_every_list(base_dir):
    # A Reviewer holds Cases across Case Types, so the aggregate is one table
    # over the union rather than one table per list -- split into one row per
    # Case Type, since Case Type is part of the base grain.
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    rows = read_rows(med.gold, "case_counts_current")
    assert {row["case_type"] for row in rows} == {
        COMPLAINTS.case_type,
        OTHER.case_type,
    }
    assert sum(row["case_count"] for row in rows) == 2


def test_each_list_keeps_its_own_watermark(base_dir):
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=two_list_client(),
        case_lists=TWO_LISTS,
    )

    checkpoints = SharePointCheckpointStore(base_dir)
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
    assert [row["case_type"] for row in read_rows(med.silver, "case_version")] == [
        "other"
    ]
    assert published_gold(run_log) == set(GOLD_TABLES)
    checkpoints = SharePointCheckpointStore(base_dir)
    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG


def test_a_failure_polling_the_second_list_leaves_no_gold_and_no_watermark(base_dir):
    # Fail fast: the first list's observations are committed (append-only, per
    # step), but nothing is published and no watermark moves.
    run_log = RecordingRunLog()
    broken = FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [items(item(ResponsibleParty="not an object"))],
        }
    )

    with pytest.raises(SharePointFeedError):
        run(
            RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
            client=broken,
            case_lists=TWO_LISTS,
        )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    checkpoints = SharePointCheckpointStore(base_dir)
    assert len(read_rows(med.silver, "case_version")) == 1
    assert published_gold(run_log) == set()
    assert checkpoints.committed_watermark(SOURCE) is None
    assert checkpoints.committed_watermark(OTHER_SOURCE) is None


def test_a_retry_after_a_partial_failure_converges_and_advances_both_lists(base_dir):
    broken = FakeListClient(
        by_list={
            COMPLAINTS.list_name: [items(item())],
            OTHER.list_name: [items(item(ResponsibleParty="not an object"))],
        }
    )
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    with pytest.raises(SharePointFeedError):
        run(context, client=broken, case_lists=TWO_LISTS)
    run(context, client=two_list_client(), case_lists=TWO_LISTS)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    checkpoints = SharePointCheckpointStore(base_dir)
    # The first list's re-read is a no-op against append-only silver.
    assert len(read_rows(med.silver, "case_version")) == 2
    assert len(read_rows(med.gold, "case_current")) == 2
    assert checkpoints.committed_watermark(SOURCE) == SERVER_NOW - SAFETY_LAG
    assert checkpoints.committed_watermark(OTHER_SOURCE) == SERVER_NOW - SAFETY_LAG


def test_a_dry_run_on_a_fresh_base_dir_writes_no_gold_and_commits_nothing(base_dir):
    # The silver write is previewed rather than performed, so there is no table
    # for gold to reduce. Previewing no gold steps is the honest answer.
    report = dry_run_pipeline(
        lambda ctx: run(ctx, client=FakeListClient()), FEED_NAME, base_dir
    )

    assert not report.failed
    assert nothing_landed(base_dir)
    assert not SharePointCheckpointStore(base_dir).path.exists()


def test_a_dry_run_previews_every_write_and_commits_none_of_them(base_dir):
    client = FakeListClient(advance=NEXT_POLL)
    run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=client)
    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    before = read_rows(med.gold, "case_current")

    report = dry_run_pipeline(lambda ctx: run(ctx, client=client), FEED_NAME, base_dir)

    # The fixture item carries no capture map, remediationActions, general
    # answer, Conversation, Appeals or Details, so these six preview empty.
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
        ("gold case_age_from_assigned_buckets_current", 1),
        ("gold case_throughput_daily", 0),
        # The fixture's one answer row is undecided, so it lands under the
        # UNDECIDED/UNRESOLVED fills; no Appeals means the next row is empty.
        ("gold answer_remediation_current", 1),
        ("gold appeal_outcomes_current", 0),
    ]
    assert [step.note for step in report.steps if step.node_type == "Write"] == [
        f"would write {n} row(s)" for _, n in expected
    ]
    assert read_rows(med.gold, "case_current") == before
    # The real run's watermark stands; the preview did not move it on.
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )


def test_a_quarantined_detail_row_is_routed_aside_rather_than_aborting_the_poll(
    base_dir,
):
    # Every Detail Table step is handed a quarantine Writer, and this subject is
    # under migration control -- so a reject table the migrations forgot is not
    # a gap in the reject history but a `MissingTableError` that aborts the
    # whole poll, at `answer`, before `answer_action` and the four tables after
    # it are ever written. The unit tests above prove each partitioner against a
    # RecordingWriter, which is exactly the seam that cannot see it: only a real
    # store can say whether the row has somewhere to land.
    answers = json.dumps(
        {
            "q-bad": {"value": "A", "remediationStatus": {"status": "resolved"}},
            "q-good": {
                "value": "B",
                "remediationRequired": "yes",
                "remediationActions": [{"id": "q-good-ra-0", "text": "Retrain."}],
            },
        }
    )
    appeals = json.dumps([appeal(id="appeal-1"), appeal(id="appeal-2", state="lapsed")])
    client = FakeListClient(items(item(Answers=answers, Appeals=appeals)))

    [poll] = run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=client)

    # The breach is routed aside and the poll publishes: the good answer, the
    # good appeal and -- the table furthest downstream of the first breach --
    # the action land at silver and gold.
    assert poll.detail_rows["answer_action"] == 1
    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    for layer in (med.silver, med.gold):
        assert [row["question_id"] for row in read_rows(layer, "answer")] == ["q-good"]
        assert [row["action_id"] for row in read_rows(layer, "answer_action")] == [
            "q-good-ra-0"
        ]
        assert [row["appeal_id"] for row in read_rows(layer, "appeal")] == ["appeal-1"]

    quarantined = quarantine_rows(base_dir)
    assert [row["question_id"] for row in quarantined["answer"]] == ["q-bad"]
    assert "remediation_status" in quarantined["answer"][0]["failed_rule"]
    assert [row["appeal_id"] for row in quarantined["appeal"]] == ["appeal-2"]
    assert "state" in quarantined["appeal"][0]["failed_rule"]


def quarantine_rows(base_dir) -> dict[str, list[dict]]:
    """Every non-empty reject table of this feed's quarantine database.

    Read with sqlite3 rather than a Store Reader: the quarantine file is a
    sibling of the layer that writes to it, not a namespace the registry mints.
    """
    con = sqlite3.connect(base_dir / FEED_NAME / "quarantine.db")
    con.row_factory = sqlite3.Row
    try:
        tables = [
            name
            for (name,) in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name <> 'schema_migrations' ORDER BY name"
            )
        ]
        landed = {
            table: [dict(row) for row in con.execute(f'SELECT * FROM "{table}"')]
            for table in tables
        }
    finally:
        con.close()
    return {table: rows for table, rows in landed.items() if rows}
