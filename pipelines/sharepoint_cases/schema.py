"""Declared silver schemas for the ``sharepoint_cases`` feed.

``CaseVersion`` is one row per observation of a Case: the source's column
names mechanically snake_cased and the columns typed, with nothing derived or
reshaped. ``AnswerRow``, ``AnswerCaptureRow``, ``AnswerActionRow`` and
``GeneralAnswerRow`` explode ``CaseVersion.answers``; ``ConversationMessageRow``
and ``AppealRow`` explode ``conversation`` and ``appeals``; ``CaseDetailRow``
explodes ``details``. See ``docs/data-dictionary-sharepoint-cases.md`` for the
full field-level contract -- this module states the type declarations and the
few non-obvious constraints behind them.

Alongside the schemas, this module holds the feed's **declarations** -- the
names it is known by and the identity a Case is keyed on. They live here
rather than in ``pipeline.py`` because ``gold.py`` needs them and
``pipeline.py`` imports ``gold.py``; a declaration both of them read belongs
below both.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated
from uuid import UUID

from framework.core import NonNull, OneOf

FEED_NAME = "sharepoint_cases"

# PLACEHOLDER -- must come from the tenant; see the data dictionary's "Three
# things to know" for why no real value exists to copy here.
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


# Every Case list this feed polls; onboarding one is a new entry with its own
# GUID. A UAT tenant prefixes the same list names ``uat_``.
CASE_LISTS = (CaseList("complaints", "Cases-Complaints", SITE, UUID(int=0)),)

# What a gold ``case_id`` is minted from, in the ``FEED_NAME`` namespace. The
# item id alone is not unique -- item 101 exists in every list -- so the Case
# Type is part of the key.
NATURAL_KEY = ("case_type", "source_item_id")

# The Case lifecycle states, exactly as the review application persists them --
# note the hyphen in "In-progress" and in "To-allocate", and that "Actions In
# Progress" carries none. "To-allocate" is where a Case starts, waiting in its
# list for a Reviewer to claim it; it is in this vocabulary because every
# unclaimed Case carries it, and a status this feed does not recognise
# quarantines the row.
CASE_STATUSES = (
    "To-allocate",
    "In-progress",
    "Actions In Progress",
    "Completed",
    "Void",
)

# The columns every Detail Table repeats onto every exploded row -- exactly
# NATURAL_KEY's columns plus the provenance needed to join back to the winning
# observation. Declared once so a Detail Table's derived case_id can never
# drift from the parent Case's.
DETAIL_ID_VARS = (
    "case_type",
    "source_item_id",
    "source_modified_at",
    "source_version",
    "source_observation_id",
)

# The remediation vocabulary.
REMEDIATION_STATUSES = ("complete", "partial", "cancelled")
REMEDIATION_DECISIONS = ("yes", "no")

# CAPTURE_VALUE_KINDS deliberately holds two labels, not one per unsupported
# shape -- everything else collapses onto UNSUPPORTED_CAPTURE_VALUE_KIND.
TEXT_VALUE_KIND = "text"
PERSON_VALUE_KIND = "person"
CAPTURE_VALUE_KINDS = (TEXT_VALUE_KIND, PERSON_VALUE_KIND)
UNSUPPORTED_CAPTURE_VALUE_KIND = "unsupported"

# The Appeal lifecycle.
APPEAL_STATES = ("raised", "underReview", "resolved")
APPEAL_VERDICTS = ("agreed", "rejected")


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
    # Nullable at ingestion: only outstanding assigned rows require this clock;
    # unassigned rows carry null, and the Action Centre filters legacy gaps.
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
    # Free text and the only thing an "other" void means, so it carries no
    # OneOf and nothing groups on it: void_reason stays the grouping key.
    void_reason_note: str
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

    ``general:``-prefixed keys belong to the General Question table and are
    excluded before this schema ever sees them. ``value_json`` is the value
    verbatim; ``value_text`` is its canonical, groupable rendering (see
    ``derive_value_text``).

    Plain types throughout, never ``X | None``: ``SchemaValidator`` cannot
    construct a schema declaring a ``types.UnionType``, so nullability is
    expressed with ``NonNull()`` and its absence rather than a union with
    ``None``.
    """

    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str: the batch arrives already typed by
    # SchemaCoercion(CaseVersion), and a str declaration would have this schema's
    # own coercion stringify that instant back to text rather than keep it.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    question_id: Annotated[str, NonNull()]

    value_json: str
    value_text: str
    justification: str

    # remediation_required is tri-state text -- absence means undecided, never
    # a boolean.
    remediation_required: Annotated[str, OneOf(*REMEDIATION_DECISIONS)]
    free_form_remediation: str
    remediation_status: Annotated[str, OneOf(*REMEDIATION_STATUSES)]
    remediation_status_details: str


@dataclass
class AnswerCaptureRow:
    """One row per observation x Question Definition x Issue Capture Field,
    exploded from one answer's flat ``capture`` map.

    A capture value is polymorphic -- plain text, or a person as
    ``{loginName, displayName}`` -- so the row is discriminated by
    ``value_kind`` rather than modelled as a union column; see
    ``discriminate_capture_value``. Issue Capture Groups are presentation-only
    and appear nowhere here.
    """

    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str -- see AnswerRow's own field for why.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    question_id: Annotated[str, NonNull()]
    field_key: Annotated[str, NonNull()]

    # value_kind's reject label (UNSUPPORTED_CAPTURE_VALUE_KIND) must stay
    # outside the OneOf, or an unmodelled shape validates instead of
    # quarantining.
    value_kind: Annotated[str, NonNull(), OneOf(*CAPTURE_VALUE_KINDS)]
    value_text: str

    # The person arm: a bare account login, e.g. ``user-rp`` -- not the
    # claims login case_version's Person columns hold. The two vocabularies
    # do not join.
    person_login: str
    person_display: str


@dataclass
class AnswerActionRow:
    """One row per observation x Question Definition x ticked Remediation
    Action, exploded from one answer's ``remediationActions`` list.

    Exploded from a **list**, not a map key, so ``action_id`` *can* repeat
    within one answer -- a hand-edited duplicate **aborts** the run rather
    than quarantining, since it is a structural breach of the declared grain.
    """

    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str -- see AnswerRow's own field for why.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    question_id: Annotated[str, NonNull()]
    # action_seq is positional and descriptive only; action_id, from the
    # bank's own definitions, is the grain.
    action_seq: Annotated[int, NonNull()]
    action_id: Annotated[str, NonNull()]
    action_text: str


@dataclass
class GeneralAnswerRow:
    """One row per observation x General Question catalogue key, exploded from
    the same ``answers`` map ``AnswerRow`` reads -- from the other side of it.

    ``silver_answer_builder`` excludes the ``general:`` prefix;
    ``silver_general_answer_builder`` includes it and strips it, so the two
    tables tile the blob with no overlap and no loss. Both value columns are
    carried even though the app contract says plain string -- see
    ``_as_column_value``/``derive_value_text`` for why an array or a JSON
    scalar still needs a faithful text rendering.

    """

    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str -- see AnswerRow's own field for why.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    # The General Question catalogue key, with the "general:" prefix stripped.
    general_key: Annotated[str, NonNull()]

    value_json: str
    value_text: str


@dataclass
class ConversationMessageRow:
    """One row per observation x Conversation message, exploded from
    ``conversation``.

    The app writes no message id, so ``seq``, the blob's own 0-based ordinal,
    is the grain key -- a durable *pointer* into an append-only list, not a
    durable message identifier.

    ``author_login`` is the bare account name the app stamps at post time, not
    the claims login every other silver person column holds -- the two
    vocabularies do not join. ``author_display_name`` is an unrefreshed
    snapshot of what the sender was called when they posted.

    ``posted_at`` is declared ``str``, not ``datetime``, deliberately: the
    coerce step sits above quarantine, so a hand-edited non-ISO value inside
    the blob would abort the whole poll rather than divert one row.
    ``SchemaCoercion`` parses ISO-8601 in any precision now, but blob text is
    exactly where a hand edit lands; re-typing waits on evidence the blobs
    are clean. ``source_modified_at`` stays ``datetime`` because it comes
    from OData and is already typed upstream.

    """

    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str -- see AnswerRow's own field for why.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    seq: Annotated[int, NonNull()]
    author_login: str
    author_display_name: str
    posted_at: str
    body: str


@dataclass
class AppealRow:
    """One row per observation x Appeal, exploded from ``appeals``.

    Unlike a Conversation message, an Appeal carries its own identity:
    ``appeal_id`` (minted by the app) is the grain key, not ``appeal_seq``.

    The ``resolution`` object is lifted into four columns sharing the
    ``resolution_`` prefix, null **together** while the Appeal is unresolved.
    ``cited_question_ids_json`` is JSON array text; null means the key was
    omitted, not "no citations" spelled ``[]``. ``appellant`` and
    ``resolution_resolver`` are bare account names (see
    ``ConversationMessageRow.author_login``); ``raised_at`` and
    ``resolution_at`` stay ``str`` for the same reason ``posted_at`` does.

    """

    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str -- see AnswerRow's own field for why.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    appeal_id: Annotated[str, NonNull()]
    # Descriptive only -- appeal_id is the grain key.
    appeal_seq: Annotated[int, NonNull()]
    appellant: str
    raised_at: str
    rationale: str
    state: Annotated[str, OneOf(*APPEAL_STATES)]
    cited_question_ids_json: str
    resolution_verdict: Annotated[str, OneOf(*APPEAL_VERDICTS)]
    resolution_rationale: str
    resolution_resolver: str
    resolution_at: str


@dataclass
class CaseDetailRow:
    """One row per observation x Case Details field, exploded from ``details``.

    This blob carries less contract than any other this feed lands -- see the
    data dictionary's "Why this blob has less contract behind it than the
    others". Values are not normalised, and there is no ``value_json`` twin
    the way ``AnswerRow`` keeps one.

    """

    case_type: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    # datetime, not str -- see AnswerRow's own field for why.
    source_modified_at: Annotated[datetime, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_observation_id: Annotated[str, NonNull()]

    field_key: Annotated[str, NonNull()]
    value_text: str
