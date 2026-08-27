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
    PERSON_SUBFIELDS,
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

# Every flattened Person column raw stores, as (person, sub-field) pairs --
# derived from the declaration so a sixth Person or a second sub-field is
# covered here without a test naming it.
PERSON_COLUMNS = [
    (person, sub) for person, subs in PERSON_SUBFIELDS.items() for sub in subs
]

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
    source = item()
    [row] = landed(FakeListClient(items(source)))

    # Faithful: every scalar column lands under the source's own name, holding
    # what the source held -- absent ones included, as nulls.
    scalar_columns = [
        column
        for column in RAW_FEED_COLUMNS
        if "/" not in column and not column.startswith("source_")
    ]
    assert {column: row[column] for column in scalar_columns} == {
        column: source[column] for column in scalar_columns
    }
    assert row["source_list_name"] == COMPLAINTS.list_name
    assert row["source_item_id"] == str(source["Id"])
    assert row["source_version"] == source["odata.etag"]
    assert row["source_observation_id"]
    # source_modified_at and source_version say what Modified and the etag said,
    # so raw does not also carry them -- nor when we happened to look.
    assert not {"Modified", "odata.etag", "observed_at"} & set(row)


def test_an_expanded_person_is_flattened_onto_its_selected_sub_fields():
    # SharePoint answers an expanded lookup as a nested object on the property.
    # A tabular carrier has nowhere to put that, so the feed undoes the nesting
    # -- and only for the sub-fields the read actually selected.
    source = item()
    [row] = landed(FakeListClient(items(source)))

    for person, sub in PERSON_COLUMNS:
        held = source[person] or {}
        assert row[f"{person}/{sub}"] == held.get(sub), (person, sub)
    # The nested properties themselves do not survive into raw.
    assert not set(PERSON_SUBFIELDS) & set(row)


def test_a_role_nobody_holds_lands_as_nulls_rather_than_failing():
    # The nobody case is a plain null on the property, not an object of nulls.
    client = FakeListClient(items(item(**dict.fromkeys(PERSON_SUBFIELDS))))

    [row] = landed(client)

    assert all(row[f"{person}/{sub}"] is None for person, sub in PERSON_COLUMNS)


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

    [call] = client.calls
    assert "*" in call["select_fields"]
    # ... and each expanded Person is selected down to the sub-fields declared
    # for it, since the star does not reach inside a lookup.
    assert {f"{person}/{sub}" for person, sub in PERSON_COLUMNS} <= set(
        call["select_fields"]
    )
    assert set(call["expand_fields"]) == set(PERSON_SUBFIELDS)


def test_raw_reads_a_quiet_window_as_the_declared_shape():
    # Almost every column arrives because the client expanded the star, so none
    # of them can be there when there are no rows; the shape is declared anyway.
    writer = RecordingWriter()

    to_raw(source_reader(FakeListClient(pd.DataFrame())), writer, COMPLAINTS)

    assert rows_of(writer) == []
    assert set(writer.writes[0].to_pandas().columns) == set(RAW_FEED_COLUMNS)


def test_a_populated_response_missing_a_stored_column_is_refused():
    # The projection has to select every stored column to build the row at all,
    # so this is where a broken promise surfaces -- named, and before anything
    # lands.
    client = FakeListClient(items(item()).drop(columns=["Status"]))

    with pytest.raises(SharePointFeedError, match="Status"):
        to_raw(source_reader(client), RecordingWriter(), COMPLAINTS)
