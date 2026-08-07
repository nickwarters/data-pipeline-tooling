"""Declared silver schema for the ``sharepoint_cases`` feed.

One row per observation of a Case: the ``Cases-Complaints`` list item as it stood
at one version, with the source's column names mechanically snake_cased and the
columns typed. Nothing is derived and nothing is reshaped -- this hop is the
rename and the type contract, and that is all it is meant to be.

The rules are deliberately thin. Only three things about this list are knowable
enough to fail a run over: an observation must say where it came from, a Case
must carry the id the list keys it on, and ``Status`` is a Choice column with a
closed vocabulary. Everything else is typed and left alone: ``Title`` is the
human Case Reference and carries no format anyone has ever enforced, and the
outcome/void/justification columns are free text whose constraints live in the
review application, not here.

What is deliberately *not* here: when we saw the row. An append-only target
compares every non-key column, so a per-read stamp would make each overlapping
re-read look like a changed row. Observation time lives in the run log and the
ingestion batch id instead.

Alongside the schema this module holds the feed's **declarations** -- the names
it is known by and the identity a Case is keyed on. They live here rather than
in ``pipeline.py`` because ``gold.py`` needs them and ``pipeline.py`` imports
``gold.py``; a declaration both hops read belongs below both.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from framework.core import NonNull, OneOf

FEED_NAME = "sharepoint_cases"

# One list per Case Type, named ``Cases-{slug}``; there is no combined list and
# no default. Only Complaints is live, so this feed names it directly rather
# than growing a per-Case-Type indirection for a second type that may never come.
# A UAT tenant prefixes the same list ``uat_``.
#
# This is also the **namespace every gold ``case_id`` is minted in**, paired with
# the natural key ``source_item_id`` (the list item id, which is what the list
# keys a Case on). The list *name* and not the list GUID: the GUID is still the
# ``UUID(int=0)`` placeholder, so keying on it would silently re-key every Case
# in gold the day the real one lands. The trade is stated plainly -- *renaming
# the list re-keys history*, and a rename would therefore need the same
# treatment a re-key always needs, not a quiet redeploy.
LIST_NAME = "Cases-Complaints"

# The Case lifecycle states, exactly as the review application persists them --
# note the hyphen in "In-progress" and that "Actions In Progress" carries none.
# A fifth value means the list's Choice column changed under us, and quarantine
# is where that should surface rather than silently in a report.
CASE_STATUSES = ("In-progress", "Actions In Progress", "Completed", "Void")


@dataclass
class CaseVersion:
    """One immutable observation of one Case in the Case Type's list."""

    # Provenance: which list, which item, which version, and the identity of the
    # three together. Non-null because an observation that cannot say where it
    # came from cannot be traced back to the source that produced it.
    source_observation_id: Annotated[str, NonNull()]
    source_list_name: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_modified_at: Annotated[datetime, NonNull()]

    id: Annotated[int, NonNull()]
    title: str
    case_type: str
    status: Annotated[str, NonNull(), OneOf(*CASE_STATUSES)]

    # The Person columns, as the claims login the list expanded them to.
    # Landed as the source spells them: mapping a login to a person is a gold
    # concern, and the numeric twin SharePoint also offers is a transport detail
    # of one site collection rather than an identity.
    assigned_reviewer_name: str
    assigned_at: datetime
    responsible_party_name: str
    responsible_party_title: str
    assigned_reviewer_manager_name: str
    responsible_party_manager_name: str

    due_date: datetime
    completed_at: datetime
    reportable_at: datetime
    remediation_due_date: datetime
    related_date: datetime
    created: datetime

    # The Action Centre reason flags and the clock paired with each.
    has_open_appeal: bool
    appeal_raised_at: datetime
    awaiting_responsible_party: bool
    awaiting_since: datetime
    review_required: bool
    on_hold: bool
    placed_on_hold_at: datetime

    voided_at: datetime
    void_reason: str
    voided_by_name: str

    outcome: str
    outcome_at_completion: str
    had_remediation: bool
    effective_outcome: str
    effective_had_remediation: bool
    outcome_overridden: bool

    question_bank_version: str
    case_justification: str
    notes: str

    # The JSON blob columns, landed as the unparsed text the list holds. Parsing
    # them is a gold concern and needs the Case Type's own question bank to mean
    # anything.
    answers: str
    conversation: str
    appeals: str
    amended_outcome: str
    details: str
