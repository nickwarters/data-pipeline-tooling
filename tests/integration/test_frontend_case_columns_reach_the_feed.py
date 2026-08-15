"""Every documented Case list column reaches the `sharepoint_cases` feed.

The standing rule this makes real: **data added on the Case Review Platform is
assumed to need a pipeline change.** Deciding it does not is the rare case and
has to be written down with a reason, rather than simply not happening — which is
what happens by default, because adding a column to a SharePoint list breaks
nothing downstream. The feed keeps polling the columns it always polled, the
reports keep reporting what they always reported, and nobody finds out until
somebody asks where the new field went.

Two documents meet here, and the test spans trees for that reason:

* ``platform_frontend/docs/case-type-onboarding.md`` carries the
  ``Cases-{slug}`` shared-column table. It is the **provisioning authority** — a
  Maintainer creates a list from it — which is why
  ``docs/data-dictionary-sharepoint-cases.md`` already names it as such.
* ``pipelines/sharepoint_cases/pipeline.py`` declares ``RAW_FEED_COLUMNS``,
  "every documented column of the list, in the source's own names".

The two projects keep separate glossaries and neither is authoritative for the
other, so this compares them by name rather than assuming either side's shape.

A column may be absent from the feed only by appearing in :data:`NOT_POLLED`
with a reason. The check self-tests, so it cannot quietly stop guarding.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from pipelines.sharepoint_cases.pipeline import RAW_FEED_COLUMNS
from tools.integrations.sharepoint_rest import METADATA_COLUMNS

ROOT = Path(__file__).resolve().parents[2]
ONBOARDING = ROOT / "platform_frontend" / "docs" / "case-type-onboarding.md"

# The heading the shared-column table sits under. Named rather than "the first
# table in the file" so that adding a table above it does not silently move the
# check onto a different one.
COLUMN_TABLE_HEADING = "## `Cases-{slug}` column schema"

# Columns the feed deliberately does not poll, and why.
#
# Seeded from what the code already documents: `pipeline.py` drops `Modified`
# and `odata.etag` because the stamped `source_modified_at` / `source_version`
# say the same thing in the vocabulary every hop below reads. A column added
# here is a decision that this data does not need to reach the pipelines — which
# is exactly the decision the rule says must be written down.
NOT_POLLED = {
    "Modified": (
        "stamped as source_modified_at by the reader, in the vocabulary every "
        "hop below reads"
    ),
    "odata.etag": (
        "stamped as source_version by the reader, in the vocabulary every hop "
        "below reads"
    ),
}


def _normalise(column: str) -> str:
    """The name to compare on, from either side's spelling of it.

    Onboarding writes a Person column as ``AssignedReviewer``
    (``AssignedReviewerId``) — the list's own column and the numeric id the
    client writes. The feed selects ``AssignedReviewer/Name``, the expanded
    person's display name, because a numeric id means nothing outside the
    tenant. Same column, three spellings; reduced here to the first.
    """
    column = re.sub(r"\s*\(.*\)\s*$", "", column.strip())  # drop the "(…Id)" note
    return column.split("/")[0].strip().strip("`")


def documented_columns() -> list[str]:
    """Every column of the onboarding guide's shared-column table, in order."""
    text = ONBOARDING.read_text(encoding="utf-8")
    start = text.index(COLUMN_TABLE_HEADING)
    body = text[start:]
    columns = []
    for line in body.splitlines():
        if not line.startswith("|"):
            if columns:
                break  # the table has ended
            continue
        cell = line.split("|")[1].strip()
        if not cell or set(cell) <= set("-: "):
            continue  # the header rule
        if cell.startswith("Column"):
            continue  # the header row
        columns.append(cell)
    return columns


def polled_columns() -> set[str]:
    """The list's own columns the feed selects, without the stamped metadata.

    ``RAW_FEED_COLUMNS`` is what raw *stores*, which is the columns it selects
    plus the immutable observation metadata the Reader stamps
    (``METADATA_COLUMNS``: which list, which item, which version, when observed).
    Those are the framework's, not the list's, so they take no part in a
    comparison against what a Maintainer provisions.
    """
    return {
        _normalise(column)
        for column in RAW_FEED_COLUMNS
        if column not in METADATA_COLUMNS
    }


def test_every_documented_column_is_polled_or_deliberately_not():
    documented = [_normalise(column) for column in documented_columns()]
    polled = polled_columns()
    missing = [
        column
        for column in documented
        if column not in polled and column not in NOT_POLLED
    ]

    assert not missing, (
        "these columns are documented on the Case list but never reach the "
        f"pipelines: {missing}.\n"
        "Adding data on the platform is assumed to need a pipeline change: add "
        "the column to RAW_FEED_COLUMNS in pipelines/sharepoint_cases/"
        "pipeline.py (and to the raw baseline migration), or add it to "
        "NOT_POLLED here with the reason it does not need to."
    )


def test_the_feed_polls_nothing_the_onboarding_guide_does_not_document():
    # The other direction. A column the feed selects but the provisioning guide
    # does not describe is a list a Maintainer would create without it, and a
    # feed that fails on the first poll of a freshly onboarded Case Type.
    documented = {_normalise(column) for column in documented_columns()}
    undocumented = sorted(polled_columns() - documented)

    assert not undocumented, (
        "the feed polls these columns, but the provisioning guide does not "
        f"document them: {undocumented}. A Case Type onboarded from that guide "
        "would not have them."
    )


# --- the check checks itself -------------------------------------------------


def test_the_table_is_still_being_found_and_parsed():
    # A parser that quietly returned nothing would make both assertions above
    # pass forever.
    documented = documented_columns()

    assert len(documented) > 30
    assert "`Id`" in documented
    assert "`Details`" in documented
    # ...and stops at the end of the table rather than swallowing the prose.
    assert not any("deliberately not indexed" in column for column in documented)


def test_the_stamped_observation_metadata_is_not_mistaken_for_a_list_column():
    # RAW_FEED_COLUMNS is what raw stores: the list's columns plus the metadata
    # the Reader stamps. Comparing the second against a provisioning guide would
    # demand a Maintainer create columns the framework invents.
    assert "source_observation_id" not in polled_columns()
    assert "Status" in polled_columns()


def test_a_person_columns_three_spellings_reduce_to_one_name():
    # The normalisation that lets the two documents be compared at all.
    assert _normalise("`AssignedReviewer` (`AssignedReviewerId`)") == "AssignedReviewer"
    assert _normalise("AssignedReviewer/Name") == "AssignedReviewer"
    assert _normalise("`Status`") == "Status"


def test_a_newly_documented_column_would_be_caught():
    # The failure the test exists for: a column added to the platform's list and
    # nowhere else.
    documented = [_normalise(c) for c in documented_columns()] + ["BrandNewField"]
    polled = polled_columns()

    missing = [
        column
        for column in documented
        if column not in polled and column not in NOT_POLLED
    ]

    assert missing == ["BrandNewField"]


@pytest.mark.parametrize("column", sorted(NOT_POLLED))
def test_every_deliberately_dropped_column_carries_a_reason(column):
    assert NOT_POLLED[column].strip()


def test_no_exclusion_is_stale():
    # A dropped column that the feed now polls, or that the guide no longer
    # documents, is an exclusion saying something untrue.
    documented = {_normalise(column) for column in documented_columns()}
    polled = polled_columns()

    for column, reason in NOT_POLLED.items():
        if column == "odata.etag":
            continue  # not a list column; it is the item's HTTP entity tag
        assert column in documented, f"{column} is no longer documented: {reason}"
        assert column not in polled, f"{column} is polled after all: {reason}"
