"""Declared silver schemas for the ``sharepoint_cases`` feed.

Two tables, two grains. :class:`CaseVersion` is one row per *observation of a
Case* — the SharePoint item as it stood at one version — and :class:`CasePartyVersion`
is the bridge for the list's one multi-value person column, at one row per
observation × party.

Both carry the observation's provenance, because provenance has to survive every
hop: a silver row that cannot say which list item and which version it came from
cannot be traced back to the source that produced it. Identity is always the
lookup **id**, never the display title — a title is a mutable display name.

What is deliberately *not* here: when we saw the item. An append-only target
compares every non-key column, so a per-read stamp would make each overlapping
re-read look like a changed row. Observation time lives in the run log and the
ingestion batch id instead — see
[`docs/data-dictionary-sharepoint-cases.md`](../../docs/data-dictionary-sharepoint-cases.md).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Annotated

from framework.core import Length, NonNull, OneOf, Pattern, Range

# The Case lifecycle states the list offers. A sixth would be a source change,
# and quarantine is where it should surface rather than silently in a report.
CASE_STATUSES = ("Open", "With Adviser", "Awaiting Evidence", "Closed", "Void")


@dataclass
class CaseVersion:
    """One immutable observation of one Case in the SharePoint list."""

    source_observation_id: Annotated[str, NonNull(), Length(64, 64)]
    source_list_name: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_modified_at: Annotated[datetime, NonNull()]
    case_ref: Annotated[str, NonNull(), Pattern(r"^C\d{6}$")]
    status: Annotated[str, NonNull(), OneOf(*CASE_STATUSES)]
    opened_on: Annotated[date, NonNull()]
    target_close_on: date
    risk_score: Annotated[int, NonNull(), Range(minimum=0, maximum=100)]
    owner_user_id: Annotated[int, NonNull(), Range(minimum=1)]
    owner_display_name: str


@dataclass
class CasePartyVersion:
    """One party named on one observation of a Case, at that party's position.

    ``party_position`` is the party's index in the source's multi-value cell. It
    is part of the bridge's identity because the same person may legitimately
    appear twice in one cell, and two rows that differ only by position are two
    facts about the observation rather than a contradiction.
    """

    source_observation_id: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    source_modified_at: Annotated[datetime, NonNull()]
    party_user_id: Annotated[int, NonNull(), Range(minimum=1)]
    party_display_name: str
    party_position: Annotated[int, NonNull(), Range(minimum=0)]
