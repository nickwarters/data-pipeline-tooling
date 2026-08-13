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
from functools import partial
from uuid import UUID

import pandas as pd
import pytest

from framework.core import ErrorCategory, ValidationError
from framework.io import AppendOnlyConflictError
from framework.run import Pipeline, RunContext, RunLog, dry_run_pipeline
from framework.transform import Stamp
from pipelines.sharepoint_cases import gold
from pipelines.sharepoint_cases.gold import (
    GOLD_TABLES,
    UNASSIGNED,
    UNSTAMPED,
    age_buckets,
    case_counts,
    case_current_builder,
)
from pipelines.sharepoint_cases.gold import throughput as throughput_transform
from pipelines.sharepoint_cases.pipeline import (
    EXPAND_FIELDS,
    FEED_NAME,
    PERSON_SUBFIELDS,
    RAW_FEED_COLUMNS,
    RENAME,
    SAFETY_LAG,
    SOURCE_COLUMNS,
    LocalJsonListClient,
    NoClientError,
    main,
    raw_builder,
    run,
    silver_builder,
    snake_case,
)
from pipelines.sharepoint_cases.schema import (
    CASE_LISTS,
    CASE_STATUSES,
    SITE,
    CaseList,
)
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
    *(f"{FEED_NAME}:gold:{table}" for table in GOLD_TABLES),
}


class FakeListClient:
    """A ``CaseListClient`` replaying frames per list, with a clock.

    The positional frames are served in call order to whichever list asks;
    ``by_list`` gives a named list its own. ``advance`` moves the clock on after
    each ``server_time()`` — one step per poll — so a single client can serve a
    test that runs the feed more than once.
    """

    def __init__(
        self,
        *frames: pd.DataFrame,
        server_now: dt.datetime = SERVER_NOW,
        advance: dt.timedelta = dt.timedelta(0),
        by_list: dict[str, list[pd.DataFrame]] | None = None,
    ):
        self._frames = list(frames) or [items()]
        self._by_list = {name: list(f) for name, f in (by_list or {}).items()}
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
        frames = self._by_list.get(list_name, self._frames)
        polled = sum(1 for call in self.calls if call["list_name"] == list_name)
        return frames[min(polled - 1, len(frames) - 1)].copy()

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


# --- gold: the current counts ------------------------------------------------


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


# --- the composed plan -----------------------------------------------------


def test_both_hops_plan_exactly_the_steps_they_always_have():
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
    for table, step in (
        ("case_counts_current", "count-by-reviewer-and-status"),
        ("case_age_buckets_current", "bucket-by-age"),
        ("case_throughput_daily", "count-by-terminal-date"),
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


def test_the_bundled_sample_lands_every_item_across_both_pages(tmp_path):
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
    assert (poll.raw_rows, poll.silver_rows) == (5, 5)
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


def test_an_overlapping_poll_keeps_the_run_that_first_landed_each_row(tmp_path):
    # The append-only tables carry the run that *first* landed the row, and the
    # overlap re-reads what the first poll landed: no conflict, and the second
    # run's id appears only on the row it actually appended.
    client = FakeListClient(
        items(item()), items(item(), item(Id=102)), advance=NEXT_POLL
    )
    first = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)
    second = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    with active_context(first):
        run(first, client=client)
    with active_context(second):
        run(second, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    for store, table in ((med.raw, "case_observation"), (med.silver, "case_version")):
        stamped = [row[RUN_PROVENANCE_COLUMN] for row in read_rows(store, table)]
        assert stamped == [first.pipeline_run_id, second.pipeline_run_id], table


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
    # still sees all six hops, against every table, with zero rows.
    log_path = tmp_path / "runs.log"
    context = RunContext(
        base_dir=tmp_path, pipeline=FEED_NAME, run_log=RunLog(log_path)
    )

    run(context, client=FakeListClient(pd.DataFrame()))

    records = read_run_log(log_path)
    assert {record["pipeline"] for record in records} == EVERY_HOP
    assert {row["name"] for record in records for row in record["data_locations"]} == {
        COMPLAINTS.list_name,
        "case_observation",
        "case_version",
        *GOLD_TABLES,
    }
    assert {record["rows_out"] for record in records} == {0}


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


def test_a_quiet_first_window_commits_and_publishes_four_empty_gold_tables(tmp_path):
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
    # rebuilds all four from the same history and converges.
    monkeypatch.setattr(gold, "throughput", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient())

    checkpoints = SharePointCheckpointStore(tmp_path)
    assert landed_gold(tmp_path) == {
        "case_current",
        "case_counts_current",
        "case_age_buckets_current",
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

    # Raw, silver and all four gold tables are previewed; none is committed.
    assert [step.note for step in report.steps if step.node_type == "Write"] == [
        "would write 1 row(s)",
        "would write 1 row(s)",
        "would write 1 row(s)",
        "would write 1 row(s)",
        "would write 1 row(s)",
        "would write 0 row(s)",
    ]
    assert read_rows(med.gold, "case_current") == before
    # The real run's watermark stands; the preview did not move it on.
    assert SharePointCheckpointStore(tmp_path).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )
