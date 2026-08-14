"""Declared silver schemas for the ``sharepoint_cases`` feed.

Two schemas live here. ``CaseVersion`` is one row per observation of a Case: a
Case list item as it stood at one version, with the source's column names
mechanically snake_cased and the columns typed. Nothing is derived and nothing
is reshaped -- this hop is the rename and the type contract, and that is all it
is meant to be.

One exception, and it is deliberate: raw holds the list's own ``CaseType`` cell
as the list holds it, and silver replaces it with the Case Type declared for
that list in ``CASE_LISTS``. The cell is nullable and hand-editable, and gold
keys a Case on it.

``AnswerRow`` is one row per observation x Question Definition: the ``Answers``
JSON map, exploded so each question's response is its own row rather than a
key buried in a blob. ``DETAIL_ID_VARS`` is what both schemas share -- it
carries ``NATURAL_KEY``'s columns so the Detail Table's own ``gold_detail_builder``
derives the same ``case_id`` as the parent Case.

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
from uuid import UUID

from framework.core import NonNull, OneOf

FEED_NAME = "sharepoint_cases"

# PLACEHOLDER -- the site collection holding every Case list. The review
# application derives its site from the page it is served from, so this value
# exists nowhere to copy and must come from the tenant.
SITE = "https://sharepoint.invalid/sites/REPLACE-ME"


@dataclass(frozen=True)
class CaseList:
    """One Case Type's SharePoint list: what it is called and where it lives."""

    case_type: str
    list_name: str
    site: str
    # PLACEHOLDER -- from the list's own settings page. The watermark is keyed
    # on it, so a wrong or shared GUID silently forks the feed's place.
    list_id: UUID


# Every Case list this feed polls. All Case Types share one list template, so
# each is processed identically; onboarding one is a new entry with its own
# GUID. A UAT tenant prefixes the same list names ``uat_``.
CASE_LISTS = (CaseList("complaints", "Cases-Complaints", SITE, UUID(int=0)),)

# What a gold ``case_id`` is minted from, in the ``FEED_NAME`` namespace. The
# item id alone is not unique -- item 101 exists in every list -- so the Case
# Type is part of the key.
NATURAL_KEY = ("case_type", "source_item_id")

# The Case lifecycle states, exactly as the review application persists them --
# note the hyphen in "In-progress" and that "Actions In Progress" carries none.
# A fifth value means the list's Choice column changed under us, and quarantine
# is where that should surface rather than silently in a report.
CASE_STATUSES = ("In-progress", "Actions In Progress", "Completed", "Void")

# The columns an AnswerRow (and every other Detail Table) repeats onto every
# exploded row -- exactly NATURAL_KEY's columns plus the provenance a Detail
# row needs to join back to its winning observation. Declared once so a Detail
# Table's derived case_id can never drift from the parent Case's.
DETAIL_ID_VARS = (
    "case_type",
    "source_item_id",
    "source_modified_at",
    "source_version",
    "source_observation_id",
)

# The remediation vocabulary. Statuses are the full framework set -- a Case
# Type narrowing its offer (Complaints shows only two) is display-only, and
# what is stored is always validated against the full vocabulary. Decisions
# are the tri-state's two spellings; absence is the undecided third state and
# is deliberately not a member here.
REMEDIATION_STATUSES = ("complete", "partial", "cancelled")
REMEDIATION_DECISIONS = ("yes", "no")


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
    # The declared Case Type of the list this row was polled from, which silver
    # stamps over the list's own cell. Non-null because gold keys a Case on it.
    case_type: Annotated[str, NonNull()]
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


@dataclass
class AnswerRow:
    """One row per observation x Question Definition, exploded from ``answers``.

    ``general:``-prefixed keys belong to the General Question table, not this
    one, and are excluded before this schema ever sees them.
    ``remediation_required`` is tri-state -- ``"yes"``, ``"no"``, or the key
    absent entirely -- and absence is meaningful: it means undecided, and must
    stay distinguishable from a reviewer having chosen ``"no"``. A key is
    *deleted*, not nulled, when a reviewer changes their mind, so an
    observation's answer map only ever holds the questions it currently has an
    opinion on.

    ``value_json`` is the value as the source held it: verbatim text for a
    scalar, JSON text for a list. A JSON boolean or number would land as its
    Python scalar rather than verbatim text -- not a shape this feed's answers
    produce. ``value_text`` is its canonical, groupable rendering (see
    ``derive_value_text``), joined on ``VALUE_TEXT_SEPARATOR`` for a
    multi-select.

    Plain types throughout, never ``X | None``: ``SchemaValidator`` cannot
    construct a schema declaring a ``types.UnionType``, so nullability is
    expressed with ``NonNull()`` and its absence (the default) rather than a
    union with ``None``.
    """

    # DETAIL_ID_VARS, repeated onto every row by ExplodeJsonMap -- see its
    # docstring for why this must carry NATURAL_KEY's columns.
    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str: the silver batch this hop reads has already been typed
    # by SchemaCoercion(CaseVersion), and ExplodeJsonMap repeats an id_var
    # verbatim -- declaring str here would make SchemaCoercion leave a non-empty
    # datetime column alone and then have SchemaValidator abort on the dtype
    # mismatch.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    # A Question Definition id has no documented format, so no Pattern rule: one
    # would divert real answers into quarantine to guard a namespace nobody has
    # proposed.
    question_id: Annotated[str, NonNull()]

    value_json: str
    value_text: str
    justification: str

    # OneOf masks on notna(), so an absent remediationRequired passes through
    # untouched and the tri-state survives; the rule only catches a boolean if
    # the app ever writes one instead of the string.
    remediation_required: Annotated[str, OneOf(*REMEDIATION_DECISIONS)]
    free_form_remediation: str
    # All three statuses are validated even though a given Case Type may offer
    # fewer -- see REMEDIATION_STATUSES.
    remediation_status: Annotated[str, OneOf(*REMEDIATION_STATUSES)]
    remediation_status_details: str
