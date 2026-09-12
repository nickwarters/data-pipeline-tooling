"""Declared gold schemas for the ``cora_platform_metric`` Reporting subject.

One dataclass per published table, in publication order. Every table is an
Aggregate: one row per combination of the dimensions it declares, plus its
measures, stamped with the Sync snapshot's ``as_of_utc``. The grain of each is
stated in ``docs/data-dictionary-cora-platform-metric.md``; this module states
the type contract the ``SchemaValidator`` gates each table on before it is
written.

Measures that are statistics over an interval (means, percentiles, maxima) are
``float`` and nullable: a group whose intervals are all still open has a count
but no statistic, and NULL says so where a zero would lie.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core import NonNull, OneOf, Range

SUBJECT = "cora_platform_metric"

# The two SLAs a Case carries, and which due-date column each judges against.
REVIEW_SLA = "review"
REMEDIATION_SLA = "remediation"
SLA_KINDS = (REVIEW_SLA, REMEDIATION_SLA)


@dataclass
class CaseStageDwell:
    """``case_stage_dwell_current`` -- how long Cases sit in each status.

    Grain: ``brand`` x ``case_type`` x ``status``. Statistics are over the
    *closed* intervals only -- a status the Case has been observed leaving;
    ``open_interval_count`` counts the Cases still in the status at ``as_of``.
    """

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    status: Annotated[str, NonNull()]
    interval_count: Annotated[int, NonNull(), Range(minimum=0)]
    open_interval_count: Annotated[int, NonNull(), Range(minimum=0)]
    dwell_days_mean: float
    dwell_days_p50: float
    dwell_days_p90: float
    dwell_days_max: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseHold:
    """``case_hold_current`` -- how often and how long Cases are held.

    Grain: ``brand`` x ``case_type`` x ``assigned_reviewer_name``. Held days
    include holds still open at ``as_of``, measured to that instant.
    """

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    hold_count: Annotated[int, NonNull(), Range(minimum=1)]
    open_hold_count: Annotated[int, NonNull(), Range(minimum=0)]
    held_days_total: Annotated[float, NonNull(), Range(minimum=0)]
    held_days_mean: Annotated[float, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseSlaAttainmentMonthly:
    """``case_sla_attainment_monthly`` -- completed Cases against their SLA.

    Grain: ``sla_kind`` x ``completed_month`` x ``brand`` x ``case_type`` x
    ``assigned_reviewer_manager_name``. Lateness is in working days after the
    due date; ``no_due_date_count`` Cases are in ``case_count`` but in neither
    the on-time nor the late count.
    """

    sla_kind: Annotated[str, NonNull(), OneOf(*SLA_KINDS)]
    completed_month: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_manager_name: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    on_time_count: Annotated[int, NonNull(), Range(minimum=0)]
    late_count: Annotated[int, NonNull(), Range(minimum=0)]
    no_due_date_count: Annotated[int, NonNull(), Range(minimum=0)]
    late_working_days_mean: float
    late_working_days_max: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseVoidMonthly:
    """``case_void_monthly`` -- voided Cases by reason and by whom.

    Grain: ``void_month`` x ``brand`` x ``case_type`` x ``void_reason`` x
    ``voided_by_name``. Age at void is calendar days from ``created``.
    """

    void_month: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    void_reason: Annotated[str, NonNull()]
    voided_by_name: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    age_at_void_days_mean: float
    age_at_void_days_max: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AnswerActionLoad:
    """``answer_action_load_current`` -- remediation Actions per question.

    Grain: ``case_type`` x ``question_id``. ``share_of_cases`` is
    ``case_count`` over every current non-void Case of the Case Type.
    """

    case_type: Annotated[str, NonNull()]
    question_id: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    action_count: Annotated[int, NonNull(), Range(minimum=1)]
    actions_per_case_mean: Annotated[float, NonNull(), Range(minimum=0)]
    actions_per_case_max: Annotated[int, NonNull(), Range(minimum=1)]
    share_of_cases: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AnswerRemediationByManager:
    """``answer_remediation_by_manager_current`` -- remediation decisions and
    statuses under each Responsible Party Manager.

    Grain: ``case_type`` x ``responsible_party_manager_name`` x
    ``remediation_required`` x ``remediation_status``.
    """

    case_type: Annotated[str, NonNull()]
    responsible_party_manager_name: Annotated[str, NonNull()]
    remediation_required: Annotated[str, NonNull()]
    remediation_status: Annotated[str, NonNull()]
    answer_count: Annotated[int, NonNull(), Range(minimum=1)]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AppealCycleTime:
    """``appeal_cycle_time_current`` -- how long Appeals take to resolve.

    Grain: ``case_type`` x ``state`` x ``resolution_verdict``. Cycle days run
    from ``raised_at`` to ``resolution_at``; statistics are over the
    ``resolved_count`` Appeals carrying both.
    """

    case_type: Annotated[str, NonNull()]
    state: Annotated[str, NonNull()]
    resolution_verdict: Annotated[str, NonNull()]
    appeal_count: Annotated[int, NonNull(), Range(minimum=1)]
    resolved_count: Annotated[int, NonNull(), Range(minimum=0)]
    cycle_days_mean: float
    cycle_days_p50: float
    cycle_days_p90: float
    cycle_days_max: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AppealQuestionCitation:
    """``appeal_question_citations_current`` -- which questions get appealed.

    Grain: ``case_type`` x ``question_id``. An Appeal citing several questions
    counts once under each.
    """

    case_type: Annotated[str, NonNull()]
    question_id: Annotated[str, NonNull()]
    appeal_count: Annotated[int, NonNull(), Range(minimum=1)]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class ConversationResponseTime:
    """``conversation_response_time_current`` -- how quickly Conversations
    are replied to.

    Grain: ``brand`` x ``case_type``. A reply is a Message whose author differs
    from the Message before it; its hours run from that previous Message.
    """

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    thread_count: Annotated[int, NonNull(), Range(minimum=1)]
    reply_count: Annotated[int, NonNull(), Range(minimum=1)]
    reply_hours_mean: Annotated[float, NonNull(), Range(minimum=0)]
    reply_hours_p50: Annotated[float, NonNull(), Range(minimum=0)]
    reply_hours_p90: Annotated[float, NonNull(), Range(minimum=0)]
    reply_hours_max: Annotated[float, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class ConversationVolume:
    """``conversation_volume_current`` -- how much Conversation Cases carry.

    Grain: ``brand`` x ``case_type``, over the current non-void Cases. The
    thread-length statistics are over the ``thread_count`` Cases that have a
    Message at all; NULL where none does.
    """

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    thread_count: Annotated[int, NonNull(), Range(minimum=0)]
    no_conversation_count: Annotated[int, NonNull(), Range(minimum=0)]
    no_conversation_share: Annotated[float, NonNull(), Range(minimum=0, maximum=1)]
    message_count: Annotated[int, NonNull(), Range(minimum=0)]
    messages_per_thread_mean: float
    messages_per_thread_p50: float
    messages_per_thread_p90: float
    messages_per_thread_max: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class ConversationPostingPattern:
    """``conversation_posting_pattern_current`` -- when Messages get posted.

    Grain: ``brand`` x ``case_type`` x ``weekday_order`` x ``hour_of_day``,
    the full 7 x 24 grid per Case Type with a Message; a quiet cell is a 0.
    Local clock, like every calendar date in the system.
    """

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    weekday_order: Annotated[int, NonNull(), Range(minimum=1, maximum=7)]
    weekday: Annotated[str, NonNull()]
    hour_of_day: Annotated[int, NonNull(), Range(minimum=0, maximum=23)]
    message_count: Annotated[int, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AnswerPassRate:
    """``answer_pass_rate_current`` -- pass rate per question, under each
    declared ``PassRule``.

    Grain: ``pass_rule`` x ``brand`` x ``case_type`` x ``question_id``, over
    the Answers on the current non-void Cases, judged against the *current*
    Question Bank. The four counts partition ``answer_count``; ``pass_rate``
    is over the passes and fails only, NULL where there are neither.
    ``can_fail`` is per rule: whether any option of the question maps to an
    outcome this rule calls a fail.
    """

    pass_rule: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    question_id: Annotated[str, NonNull()]
    question_group: Annotated[str, NonNull()]
    deprecated: Annotated[bool, NonNull()]
    can_fail: Annotated[bool, NonNull()]
    answer_count: Annotated[int, NonNull(), Range(minimum=1)]
    unanswered_count: Annotated[int, NonNull(), Range(minimum=0)]
    na_count: Annotated[int, NonNull(), Range(minimum=0)]
    pass_count: Annotated[int, NonNull(), Range(minimum=0)]
    fail_count: Annotated[int, NonNull(), Range(minimum=0)]
    pass_rate: float
    as_of_utc: Annotated[str, NonNull()]
