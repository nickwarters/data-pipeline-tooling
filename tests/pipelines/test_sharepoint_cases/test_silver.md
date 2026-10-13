```python
"""The raw -> silver hop for ``case_version``: the rename, the settled Case
Type, and the one closed vocabulary this list carries.

The Detail Table explodes that hang off the same hop are in
``test_silver_detail_tables``; this module is the parent row only.
"""

from __future__ import annotations

import pandas as pd
import pytest

from framework.core import ValidationError
from framework.run import RunContext, active_context
from pipelines.sharepoint_cases.pipeline import (
    FEED_NAME,
    RAW_FEED_COLUMNS,
    RENAME,
    to_silver,
)
from pipelines.sharepoint_cases.schema import CASE_STATUSES
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    OTHER,
    SILVER_COLUMNS,
    FakeListClient,
    item,
    items,
    landed,
)
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    rows_of,
)


def test_silver_snake_cases_coerces_and_keeps_the_provenance():
    [raw] = landed(FakeListClient())
    writer = RecordingWriter()

    to_silver(given_rows([raw]), writer, COMPLAINTS)

    [row] = rows_of(writer)
    # Renamed: silver's columns are the rename map's values, nothing more.
    assert set(row) == set(SILVER_COLUMNS)
    # Text that needs no coercion arrives under its new name unchanged.
    for source in ("Title", "ResponsibleParty/Title", "Notes"):
        assert row[RENAME[source]] == raw[source], source
    # Coerced: one column of each declared non-text type is typed, not text.
    assert row["id"] == int(raw["Id"])
    assert row["due_date"] == pd.Timestamp(raw["DueDate"])
    assert row["source_modified_at"] == pd.Timestamp(raw["source_modified_at"])
    assert row["has_open_appeal"] is bool(raw["HasOpenAppeal"])
    # Settled from the polled list, not the cell.
    assert row["case_type"] == COMPLAINTS.case_type
    # The stamped identity crosses the hop untouched.
    for column in ("source_list_name", "source_item_id", "source_version"):
        assert row[column] == raw[column], column
    assert row["source_observation_id"] == raw["source_observation_id"]


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
    assert "status" in rejected["failed_rule"]


def test_silver_aborts_when_the_id_is_missing():
    # Structural, not a value rule: a Case with no id cannot be a Case version.
    writer = RecordingWriter()
    reader = given_rows([{column: None for column in RAW_FEED_COLUMNS}])

    with pytest.raises(ValidationError, match="'id'"):
        to_silver(reader, writer, COMPLAINTS)

    assert writer.writes == []

```
