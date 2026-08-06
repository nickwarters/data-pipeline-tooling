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

import pandas as pd
import pytest

from framework.core import ValidationError
from framework.io import AppendOnlyConflictError
from framework.run import RunContext, RunLog
from pipelines.sharepoint_cases.pipeline import (
    EXPAND_FIELDS,
    FEED_NAME,
    LIST_ID,
    LIST_NAME,
    PERSON_SUBFIELDS,
    RAW_FEED_COLUMNS,
    RENAME,
    SAFETY_LAG,
    SITE,
    SOURCE_COLUMNS,
    LocalJsonListClient,
    StorableObservations,
    main,
    raw_builder,
    run,
    silver_builder,
    snake_case,
)
from pipelines.sharepoint_cases.schema import CASE_STATUSES
from tests.framework_testing import (
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

SERVER_NOW = dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc)
WINDOW = ModifiedWindow(start=None, end=SERVER_NOW - SAFETY_LAG)
SOURCE = SharePointSource(SITE, LIST_ID)


class FakeListClient:
    """A ``CaseListClient`` replaying one frame per call, with a clock."""

    def __init__(self, *frames: pd.DataFrame, server_now: dt.datetime = SERVER_NOW):
        self._frames = list(frames) or [items()]
        self._server_now = server_now
        self.calls: list[dict[str, object]] = []

    def fetch_items(self, list_name, expand_fields, select_fields, filters):
        self.calls.append(
            {
                "list_name": list_name,
                "expand_fields": list(expand_fields),
                "select_fields": list(select_fields),
            }
        )
        return self._frames[min(len(self.calls) - 1, len(self._frames) - 1)].copy()

    def server_time(self) -> dt.datetime:
        return self._server_now


def item(**overrides: object) -> dict[str, object]:
    """One list item in the shape SharePoint returns it.

    A real read leads with ``$select=*``, so every column is present; and an
    expanded Person answers as a **nested object** on the property, or ``null``
    where nobody holds the role. The fake must not be tidier than the payload, or
    the tests stop proving anything about the real path. Unmentioned columns are
    null, which is what most of them are on a live row.
    """
    row: dict[str, object] = {
        "Id": 101,
        "Modified": "2026-08-05T08:10:00Z",
        # SharePoint's etag carries its own quotes.
        "odata.etag": '"3"',
        "Title": "CMP-000101",
        "CaseType": "complaints",
        "Status": "In-progress",
        "AssignedReviewer": {"Name": "i:0#.w|CONTOSO\\a.khan"},
        "ResponsibleParty": {
            "Name": "i:0#.w|CONTOSO\\b.okafor",
            "Title": "Bola Okafor",
        },
        "AssignedReviewerManager": {"Name": "i:0#.w|CONTOSO\\d.reid"},
        "ResponsiblePartyManager": {"Name": "i:0#.w|CONTOSO\\e.novak"},
        "VoidedBy": None,
        "DueDate": "2026-08-14T00:00:00Z",
        "Created": "2026-07-01T09:14:00Z",
        "HasOpenAppeal": False,
        "OnHold": False,
        "Notes": "Awaiting the call recording.",
        "Answers": '{"q-outcome":{"value":"Not upheld"}}',
    }
    # Every stored column the fixture did not name, minus the ones the feed
    # derives: the persons arrive nested above, and the provenance is stamped.
    flattened = {
        f"{person}/{sub}" for person, subs in PERSON_SUBFIELDS.items() for sub in subs
    }
    absent = [
        column
        for column in RAW_FEED_COLUMNS
        if column not in row
        and column not in flattened
        and not column.startswith("source_")
    ]
    row.update(dict.fromkeys(absent))
    row.update(overrides)
    return row


def items(*rows: dict[str, object]) -> pd.DataFrame:
    return pd.DataFrame(list(rows) or [item()])


def observations(client: FakeListClient) -> StorableObservations:
    """The feed's real Reader stack over a fake client."""
    return StorableObservations(
        SharePointModifiedReader(
            SITE,
            LIST_NAME,
            SOURCE_COLUMNS,
            WINDOW,
            expand_fields=EXPAND_FIELDS,
            client=client,
        ),
        RAW_FEED_COLUMNS,
    )


def landed(client: FakeListClient) -> list[dict]:
    """The rows the raw hop would store for ``client``'s response."""
    writer = RecordingWriter()
    raw_builder(observations(client), writer).run()
    return rows_of(writer)


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
    assert row["source_list_name"] == LIST_NAME
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
        raw_builder(observations(client), RecordingWriter()).run()


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

    raw_builder(observations(FakeListClient(pd.DataFrame())), writer).run()

    assert rows_of(writer) == []
    assert list(writer.writes[0].to_pandas().columns) == list(RAW_FEED_COLUMNS)


def test_a_populated_response_missing_a_stored_column_is_refused():
    # The projection has to select every stored column to build the row at all,
    # so this is where a broken promise surfaces -- named, and before anything
    # lands.
    client = FakeListClient(items(item()).drop(columns=["Status"]))

    with pytest.raises(SharePointFeedError, match="Status"):
        raw_builder(observations(client), RecordingWriter()).run()


# --- silver ----------------------------------------------------------------


def test_silver_snake_cases_coerces_and_keeps_the_provenance():
    writer = RecordingWriter()

    silver_builder(given_rows(landed(FakeListClient())), writer).run()

    [row] = rows_of(writer)
    assert row["id"] == 101
    assert row["title"] == "CMP-000101"
    assert row["case_type"] == "complaints"
    assert row["responsible_party_title"] == "Bola Okafor"
    assert row["due_date"] == pd.Timestamp("2026-08-14T00:00:00Z")
    assert row["has_open_appeal"] is False
    assert row["source_item_id"] == "101"
    assert row["source_version"] == '"3"'


def test_silver_accepts_a_case_with_no_reference_and_nobody_assigned():
    # Title is the human Case Reference: nullable, and carrying no format any
    # part of the application enforces. A row without one is an ordinary row.
    client = FakeListClient(items(item(Title=None, AssignedReviewer=None)))
    writer = RecordingWriter()

    silver_builder(given_rows(landed(client)), writer).run()

    [row] = rows_of(writer)
    assert row["title"] is None
    assert row["assigned_reviewer_name"] is None


@pytest.mark.parametrize("status", CASE_STATUSES)
def test_silver_accepts_every_real_status(status):
    writer = RecordingWriter()

    silver_builder(
        given_rows(landed(FakeListClient(items(item(Status=status))))), writer
    ).run()

    assert rows_of(writer)[0]["status"] == status


def test_silver_quarantines_an_unknown_status_while_raw_keeps_every_row():
    # The one closed vocabulary this list has. A fifth value means the Choice
    # column changed under us, which should surface rather than reach a report.
    client = FakeListClient(items(item(), item(Id=102, Status="Closed")))
    raw = landed(client)
    writer, rejects = RecordingWriter(), RecordingWriter()

    silver_builder(given_rows(raw), writer, rejects).run()

    assert len(raw) == 2
    assert [row["source_item_id"] for row in rows_of(writer)] == ["101"]
    [rejected] = rows_of(rejects)
    assert rejected["source_item_id"] == "102"
    assert "Closed" in rejected["failed_rule"] or "outside" in rejected["failed_rule"]


def test_silver_aborts_when_the_id_is_missing():
    # Structural, not a value rule: a Case with no id cannot be a Case version.
    writer = RecordingWriter()
    reader = given_rows([{column: None for column in RAW_FEED_COLUMNS}])

    with pytest.raises(ValidationError, match="'id'"):
        silver_builder(reader, writer).run()

    assert writer.writes == []


# --- the composed plan -----------------------------------------------------


def test_both_hops_plan_exactly_the_steps_they_always_have():
    reader, writer, rejects = given_rows([]), RecordingWriter(), RecordingWriter()

    # No column gate on the raw hop, unlike a file feed: the Reader decorator
    # projects onto exactly the stored columns, so a presence check below it
    # could never fire.
    assert raw_builder(reader, writer).describe().splitlines() == [
        "Pipeline: sharepoint_cases:raw",
        "  [Read] read",
        "  [Write] write (depends on: read)",
    ]
    assert silver_builder(reader, writer, rejects).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver",
        "  [Read] read",
        "  [Transform] rename (depends on: read)",
        "  [Transform] coerce (depends on: rename)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]


# --- end to end ------------------------------------------------------------


def test_the_bundled_sample_lands_every_item_across_both_pages(tmp_path):
    result = run(
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
    assert (result.raw_rows, result.silver_rows) == (5, 5)
    # The fixture exercises all four real statuses, so the whole vocabulary
    # passes the schema gate rather than only the one a happy path would use.
    assert {row["status"] for row in read_rows(med.silver, "case_version")} == set(
        CASE_STATUSES
    )


def test_a_repeated_observation_is_a_no_op_in_raw_and_silver(tmp_path):
    client = FakeListClient()
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_later_source_version_appends_a_second_case_version(tmp_path):
    later = item(Status="Completed")
    later.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    client = FakeListClient(items(item()), items(later))
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
    client = FakeListClient(items(item()), items(item(Status="Completed")))
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)

    with pytest.raises(AppendOnlyConflictError, match="already present with different"):
        run(context, client=client)


def test_a_quiet_window_writes_cleanly_and_a_later_one_still_appends(tmp_path):
    # The common steady-state poll: nothing changed in the window.
    client = FakeListClient(pd.DataFrame(), items(item()))
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    quiet = run(context, client=client)
    busy = run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert (quiet.raw_rows, quiet.silver_rows) == (0, 0)
    assert (busy.raw_rows, busy.silver_rows) == (1, 1)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_quiet_window_still_runs_and_records_both_hops(tmp_path):
    # A quiet poll is not a different pipeline: an operator reading the run log
    # still sees both hops, against both tables, with zero rows.
    log_path = tmp_path / "runs.log"
    context = RunContext(
        base_dir=tmp_path, pipeline=FEED_NAME, run_log=RunLog(log_path)
    )

    run(context, client=FakeListClient(pd.DataFrame()))

    records = read_run_log(log_path)
    assert {record["pipeline"] for record in records} == {
        f"{FEED_NAME}:raw",
        f"{FEED_NAME}:silver",
    }
    assert {row["name"] for record in records for row in record["data_locations"]} == {
        LIST_NAME,
        "case_observation",
        "case_version",
    }
    assert {record["rows_out"] for record in records} == {0}


def test_nothing_safe_to_poll_returns_none_and_writes_nothing(tmp_path):
    SharePointCheckpointStore(tmp_path).commit(
        SOURCE,
        window_end=SERVER_NOW,
        ingestion_batch_id="earlier",
        pipeline_run_id="earlier-run",
    )

    assert (
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient())
        is None
    )
    assert not (tmp_path / FEED_NAME).exists()


def test_the_result_carries_the_candidate_end_but_commits_no_checkpoint(tmp_path):
    result = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient()
    )

    assert result.window.end == SERVER_NOW - SAFETY_LAG
    assert result.ingestion_batch_id == f"{LIST_ID}:first-load"
    checkpoints = SharePointCheckpointStore(tmp_path)
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_the_run_log_identifies_the_list_and_both_tables(tmp_path):
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
    assert {"namespace": SITE, "name": LIST_NAME} in located
    assert {location["name"] for location in located} == {
        LIST_NAME,
        "case_observation",
        "case_version",
    }
    assert not any("@" in location["namespace"] for location in located)


def test_running_with_no_client_refuses_as_an_operator_failure(tmp_path, capsys):
    # The documented default invocation without --sample. Forgetting the client
    # is an operator's mistake, and the message names the fix, so it is worth
    # more to print it than a stack trace.
    exit_code = main(["prog", "--base-dir", str(tmp_path)])

    assert exit_code == 1
    assert "--sample" in capsys.readouterr().err
    assert not (tmp_path / FEED_NAME).exists()


def test_the_sample_client_replays_both_pages_as_one_first_load():
    frame = LocalJsonListClient().fetch_items(LIST_NAME, (), (), ())

    assert list(frame["Id"]) == [101, 102, 103, 104, 105]
