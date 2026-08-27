"""The source -> raw hop: what the read asks for, and what lands faithfully.

Everything here drives ``to_raw`` in memory — a fake list client behind the real
Reader, ``RecordingWriter`` as the Writer, no SQLite and no filesystem. The
declared lists and the rename rule sit here too: both are what raw's shape is
built from.
"""

from __future__ import annotations

import pandas as pd
import pytest

from pipelines.sharepoint_cases.pipeline import (
    RAW_FEED_COLUMNS,
    RENAME,
    snake_case,
    to_raw,
)
from pipelines.sharepoint_cases.schema import CASE_LISTS
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    FakeListClient,
    item,
    items,
    landed,
    source_reader,
)
from tests.framework_testing import RecordingWriter, rows_of
from tools.integrations.sharepoint_rest import SharePointFeedError

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
