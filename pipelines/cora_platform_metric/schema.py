"""Declared gold schemas for the ``cora_platform_metric`` Reporting subject.

One dataclass per published table, in publication order: the type contract
each table's ``SchemaValidator`` gates it on. Grains and meanings are in
``docs/data-dictionary-cora-platform-metric.md``. A statistic is ``float`` and
nullable: a group with nothing measured has a count but no statistic, and NULL
says so where a zero would lie.
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

# The trailing windows, in days, each duration percentile is taken over.
DURATION_WINDOWS = (28, 90)
DURATION_MEASURES = (
    "end_to_end",
    "to_reportable",
    "allocation_wait",
    "review",
    "remediation",
    "sla_margin_review",
)
OPEN_AGE_MEASURES = (
    "open_age_to_allocate",
    "open_age_in_progress",
    "open_age_actions_in_progress",
    "awaiting_responsible_party",
    "open_appeal_age",
)


@dataclass
class CaseStageDwell:
    """``case_stage_dwell_current``; statistics over closed intervals only."""

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
    """``case_hold_current``; an open hold is measured to ``as_of``."""

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
    """``case_sla_attainment_monthly``; lateness in working days."""

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
    on_time_rate: Annotated[float, Range(minimum=0, maximum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseVoidMonthly:
    """``case_void_monthly``."""

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
    """``answer_action_load_current``, over the live Cases."""

    case_type: Annotated[str, NonNull()]
    question_id: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    action_count: Annotated[int, NonNull(), Range(minimum=1)]
    actions_per_case_mean: Annotated[float, NonNull(), Range(minimum=0)]
    actions_per_case_max: Annotated[int, NonNull(), Range(minimum=1)]
    share_of_cases: Annotated[float, Range(minimum=0, maximum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AnswerRemediationByManager:
    """``answer_remediation_by_manager_current``."""

    case_type: Annotated[str, NonNull()]
    responsible_party_manager_name: Annotated[str, NonNull()]
    remediation_required: Annotated[str, NonNull()]
    remediation_status: Annotated[str, NonNull()]
    answer_count: Annotated[int, NonNull(), Range(minimum=1)]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AppealCycleTime:
    """``appeal_cycle_time_current``; statistics over the resolved Appeals."""

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
    """``appeal_question_citations_current``."""

    case_type: Annotated[str, NonNull()]
    question_id: Annotated[str, NonNull()]
    appeal_count: Annotated[int, NonNull(), Range(minimum=1)]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class ConversationResponseTime:
    """``conversation_response_time_current``."""

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
    """``conversation_volume_current``, over the live Cases."""

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
    """``conversation_posting_pattern_current``; the full 7 x 24 grid."""

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    weekday_order: Annotated[int, NonNull(), Range(minimum=1, maximum=7)]
    weekday: Annotated[str, NonNull()]
    hour_of_day: Annotated[int, NonNull(), Range(minimum=0, maximum=23)]
    message_count: Annotated[int, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseIntakeDaily:
    """``case_intake_daily``."""

    intake_date: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    status: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseBacklogDaily:
    """``case_backlog_daily``."""

    backlog_date: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    status: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseLifecycleDurationMonthly:
    """``case_lifecycle_duration_monthly``."""

    leg: Annotated[str, NonNull()]
    leg_order: Annotated[int, NonNull(), Range(minimum=1)]
    ended_month: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=0)]
    out_of_order_count: Annotated[int, NonNull(), Range(minimum=0)]
    days_total: Annotated[float, NonNull(), Range(minimum=0)]
    days_mean: float
    days_p50: float
    days_p90: float
    days_max: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseOutcomeMonthly:
    """``case_outcome_monthly``."""

    reportable_month: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    effective_outcome: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    remediation_count: Annotated[int, NonNull(), Range(minimum=0)]
    overridden_count: Annotated[int, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseDueProfile:
    """``case_due_profile_current``."""

    sla_kind: Annotated[str, NonNull(), OneOf(*SLA_KINDS)]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    due_bucket: Annotated[str, NonNull()]
    due_bucket_order: Annotated[int, NonNull(), Range(minimum=1)]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    on_hold_count: Annotated[int, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class RemediationOverdue:
    """``remediation_overdue_current``."""

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    responsible_party_name: Annotated[str, NonNull()]
    days_over_bucket: Annotated[str, NonNull()]
    days_over_bucket_order: Annotated[int, NonNull(), Range(minimum=1)]
    case_count: Annotated[int, NonNull(), Range(minimum=1)]
    outstanding_answer_count: Annotated[int, NonNull(), Range(minimum=0)]
    outstanding_action_count: Annotated[int, NonNull(), Range(minimum=0)]
    days_over_max: Annotated[int, NonNull(), Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class ReviewerWorkload:
    """``reviewer_workload_current``."""

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    in_progress_count: Annotated[int, NonNull(), Range(minimum=0)]
    in_progress_on_hold_count: Annotated[int, NonNull(), Range(minimum=0)]
    actions_in_progress_count: Annotated[int, NonNull(), Range(minimum=0)]
    oldest_in_progress_days: float
    reportable_last_28_days_count: Annotated[int, NonNull(), Range(minimum=0)]
    weeks_of_work: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class AppealRateByReviewerMonthly:
    """``appeal_rate_by_reviewer_monthly``."""

    reportable_month: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    reportable_count: Annotated[int, NonNull(), Range(minimum=1)]
    appealed_case_count: Annotated[int, NonNull(), Range(minimum=0)]
    appeal_count: Annotated[int, NonNull(), Range(minimum=0)]
    open_appeal_count: Annotated[int, NonNull(), Range(minimum=0)]
    agreed_appeal_count: Annotated[int, NonNull(), Range(minimum=0)]
    rejected_appeal_count: Annotated[int, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseDurationPercentilesDaily:
    """``case_duration_percentiles_daily``; small-n percentiles are NULL."""

    as_of_date: Annotated[str, NonNull()]
    window_days: Annotated[int, NonNull(), OneOf(*DURATION_WINDOWS)]
    case_type: Annotated[str, NonNull()]
    measure: Annotated[str, NonNull(), OneOf(*DURATION_MEASURES)]
    n: Annotated[int, NonNull(), Range(minimum=1)]
    p50: Annotated[float, NonNull()]
    p90: float
    p95: float
    max: Annotated[float, NonNull()]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseOpenAgeDaily:
    """``case_open_age_daily``, accumulated a day per run."""

    as_of_date: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    measure: Annotated[str, NonNull(), OneOf(*OPEN_AGE_MEASURES)]
    n: Annotated[int, NonNull(), Range(minimum=1)]
    p50: Annotated[float, NonNull(), Range(minimum=0)]
    p90: Annotated[float, Range(minimum=0)]
    p95: Annotated[float, Range(minimum=0)]
    max: Annotated[float, NonNull(), Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class CaseFirstTimeRightMonthly:
    """``case_first_time_right_monthly``."""

    reportable_month: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    reportable_count: Annotated[int, NonNull(), Range(minimum=1)]
    first_time_right_count: Annotated[int, NonNull(), Range(minimum=0)]
    first_time_right_rate: Annotated[float, NonNull(), Range(minimum=0, maximum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class ReviewerThroughputWeekly:
    """``reviewer_throughput_weekly``."""

    iso_week: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    active_reviewer_count: Annotated[int, NonNull(), Range(minimum=0)]
    completions_total: Annotated[int, NonNull(), Range(minimum=1)]
    completions_per_reviewer_p50: Annotated[float, Range(minimum=1)]
    completions_per_reviewer_p90: Annotated[float, Range(minimum=1)]
    completions_per_reviewer_max: Annotated[float, Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class ReviewerWorkloadDaily:
    """``reviewer_workload_daily``, accumulated a day per run."""

    as_of_date: Annotated[str, NonNull()]
    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    assigned_reviewer_name: Annotated[str, NonNull()]
    in_progress_count: Annotated[int, NonNull(), Range(minimum=0)]
    in_progress_on_hold_count: Annotated[int, NonNull(), Range(minimum=0)]
    actions_in_progress_count: Annotated[int, NonNull(), Range(minimum=0)]
    oldest_in_progress_days: float
    reportable_last_28_days_count: Annotated[int, NonNull(), Range(minimum=0)]
    weeks_of_work: float
    as_of_utc: Annotated[str, NonNull()]
