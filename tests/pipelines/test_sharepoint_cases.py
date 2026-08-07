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

from framework.core import ErrorCategory, ValidationError
from framework.io import AppendOnlyConflictError
from framework.run import RunContext, RunLog, dry_run_pipeline
from pipelines.sharepoint_cases import gold
from pipelines.sharepoint_cases.gold import (
    GOLD_TABLES,
    UNASSIGNED,
    case_counts_current_builder,
    case_current_builder,
)
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
    NoClientError,
    StorableObservations,
    main,
    raw_builder,
    run,
    silver_builder,
    snake_case,
)
from pipelines.sharepoint_cases.schema import CASE_STATUSES
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

SERVER_NOW = dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc)
WINDOW = ModifiedWindow(start=None, end=SERVER_NOW - SAFETY_LAG)
SOURCE = SharePointSource(SITE, LIST_ID)

# How far a multi-run client's clock moves between polls. A successful run now
# commits the watermark, and `window()` answers `None` when the safe upper bound
# has not advanced past it — so a second `run()` against a *frozen* clock returns
# before it reaches the list, and a test meaning to poll twice must let time pass.
NEXT_POLL = dt.timedelta(minutes=10)

# The instant gold is published as of: the candidate window end of a first poll.
AS_OF = SERVER_NOW - SAFETY_LAG

# Every pipeline one poll runs, in the run log's vocabulary.
EVERY_HOP = {
    f"{FEED_NAME}:raw",
    f"{FEED_NAME}:silver",
    *(f"{FEED_NAME}:gold:{table}" for table in GOLD_TABLES),
}


class FakeListClient:
    """A ``CaseListClient`` replaying one frame per call, with a clock.

    ``advance`` moves the clock on after each ``server_time()`` — one step per
    poll — so a single client can serve a test that runs the feed more than once.
    """

    def __init__(
        self,
        *frames: pd.DataFrame,
        server_now: dt.datetime = SERVER_NOW,
        advance: dt.timedelta = dt.timedelta(0),
    ):
        self._frames = list(frames) or [items()]
        self._server_now = server_now
        self._advance = advance
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
        now = self._server_now
        self._server_now = now + self._advance
        return now


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
    run_log = RecordingRunLog()

    silver_builder(given_rows(raw), writer, rejects, run_log=run_log).run()

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
        silver_builder(reader, writer).run()

    assert writer.writes == []


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
            "created": "2026-07-01 09:14:00+00:00",
            "source_list_name": LIST_NAME,
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


# --- gold: the current counts ------------------------------------------------


def counts(*rows: dict) -> list[dict]:
    return gold_rows(case_counts_current_builder, current(*rows))


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
    assert case_counts_current_builder(
        reader, writer, as_of=AS_OF
    ).describe().splitlines() == [
        f"Pipeline: {FEED_NAME}:gold:case_counts_current",
        "  [Read] read",
        "  [Transform] count-by-reviewer-and-status (depends on: read)",
        "  [Transform] stamp-as-of (depends on: count-by-reviewer-and-status)",
        "  [Write] write (depends on: stamp-as-of)",
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

    quiet = run(context, client=client)
    busy = run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert (quiet.raw_rows, quiet.silver_rows) == (0, 0)
    assert (busy.raw_rows, busy.silver_rows) == (1, 1)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


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
    assert {row["name"] for record in records for row in record["data_locations"]} == {
        LIST_NAME,
        "case_observation",
        "case_version",
        *GOLD_TABLES,
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
    assert {"namespace": SITE, "name": LIST_NAME} in located
    assert {location["name"] for location in located} == {
        LIST_NAME,
        "case_observation",
        "case_version",
        *GOLD_TABLES,
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


def test_run_with_no_client_refuses_as_a_wiring_failure(tmp_path):
    # How the operator CLI and the orchestrator both reach a feed: run(context),
    # with no way to pass a client. That must abort as a caught, categorised
    # failure rather than as a stack trace the operator has to read.
    with pytest.raises(NoClientError) as refused:
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    assert refused.value.category == ErrorCategory.CONFIG
    assert not (tmp_path / FEED_NAME).exists()


def test_the_sample_client_replays_both_pages_as_one_first_load():
    frame = LocalJsonListClient().fetch_items(LIST_NAME, (), (), ())

    assert list(frame["Id"]) == [101, 102, 103, 104, 105]


# --- end to end: gold, and the checkpoint last -------------------------------


def landed_gold(tmp_path) -> set[str]:
    """Which gold tables exist under ``tmp_path`` — not how many rows they hold."""
    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    return {
        table
        for table in GOLD_TABLES
        if med.gold.columns_of(table).columns() is not None
    }


def explode(*args: object, **kwargs: object):
    raise RuntimeError("boom")


def test_a_poll_publishes_every_gold_table_and_then_commits_the_watermark(tmp_path):
    result = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient()
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert result.window.end == SERVER_NOW - SAFETY_LAG
    assert result.ingestion_batch_id == f"{LIST_ID}:first-load"
    assert landed_gold(tmp_path) == set(GOLD_TABLES)
    [case] = read_rows(med.gold, "case_current")
    assert (case["source_item_id"], case["status"]) == ("101", "In-progress")
    assert case["as_of_utc"] == (SERVER_NOW - SAFETY_LAG).isoformat()
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )


def test_a_quiet_first_window_commits_and_publishes_empty_gold_tables(tmp_path):
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
    client = FakeListClient(advance=NEXT_POLL)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert len(read_rows(med.gold, "case_current")) == 1
    assert [
        row["case_count"] for row in read_rows(med.gold, "case_counts_current")
    ] == [1]


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
    # rebuilds every table from the same history and converges.
    monkeypatch.setattr(gold, "case_counts_current_builder", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient())

    checkpoints = SharePointCheckpointStore(tmp_path)
    assert landed_gold(tmp_path) == {"case_current"}
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_a_retry_after_a_failed_run_converges_and_advances_once(tmp_path, monkeypatch):
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)
    client = FakeListClient(advance=NEXT_POLL)
    checkpoints = SharePointCheckpointStore(tmp_path)
    monkeypatch.setattr(gold, "case_current_builder", explode)

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

    # Raw, silver and every gold table are previewed; none is committed.
    assert [step.note for step in report.steps if step.node_type == "Write"] == [
        "would write 1 row(s)",
        "would write 1 row(s)",
        "would write 1 row(s)",
        "would write 1 row(s)",
    ]
    assert read_rows(med.gold, "case_current") == before
    # The real run's watermark stands; the preview did not move it on.
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )
