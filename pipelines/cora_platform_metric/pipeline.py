"""Build the ``cora_platform_metric`` gold tables from the Sync subject.

``run`` reads each Sync source once through the Shared Readers, takes the
snapshot instant off the current Cases, orders the observation history once,
and hands each ``to_*`` step what it reduces (a function in ``metrics``), that
instant and its table's Writer. Each source is read narrowed to the union of
the columns its steps gate on, so a column missing from the source fails the
read, before any table is written. The tables are in
``docs/data-dictionary-cora-platform-metric.md``.

Run parameter ``calendar``: a YAML working-day calendar, the file
``orchestrate --calendar`` takes; omitted, weekends-only.
"""

from __future__ import annotations

import argparse
import sys
from functools import partial
from pathlib import Path

from framework.core import (
    ColumnValidator,
    Dataset,
    PipelineError,
    SchemaValidator,
    format_failure,
)
from framework.io import AccumulateByRun, Refresh, Writer
from framework.run import (
    FreshnessRequirement,
    RunContext,
    read,
    run_pipeline,
    transform,
    validate,
    write,
)
from readers.sharepoint_cases import (
    AnswerActionsReader,
    AnswersReader,
    AppealsReader,
    CaseObservationHistoryReader,
    ConversationMessagesReader,
    CurrentCasesReader,
)
from tools.calendar import WorkingDayCalendar
from tools.medallion import medallion
from tools.store import StoreRegistry

from . import metrics, schema

PIPELINE_NAME = "cora_platform_metric"
UPSTREAMS = (FreshnessRequirement("sharepoint_cases", max_age_days=0),)

# Every gold table, in publication order, with the schema it is gated on.
GOLD_TABLES = (
    ("case_stage_dwell_current", schema.CaseStageDwell),
    ("case_hold_current", schema.CaseHold),
    ("case_sla_attainment_monthly", schema.CaseSlaAttainmentMonthly),
    ("case_void_monthly", schema.CaseVoidMonthly),
    ("answer_action_load_current", schema.AnswerActionLoad),
    ("answer_remediation_by_manager_current", schema.AnswerRemediationByManager),
    ("appeal_cycle_time_current", schema.AppealCycleTime),
    ("appeal_question_citations_current", schema.AppealQuestionCitation),
    ("conversation_response_time_current", schema.ConversationResponseTime),
    ("conversation_volume_current", schema.ConversationVolume),
    ("conversation_posting_pattern_current", schema.ConversationPostingPattern),
    ("case_intake_daily", schema.CaseIntakeDaily),
    ("case_backlog_daily", schema.CaseBacklogDaily),
    ("case_lifecycle_duration_monthly", schema.CaseLifecycleDurationMonthly),
    ("case_outcome_monthly", schema.CaseOutcomeMonthly),
    ("case_due_profile_current", schema.CaseDueProfile),
    ("remediation_overdue_current", schema.RemediationOverdue),
    ("reviewer_workload_current", schema.ReviewerWorkload),
    ("appeal_rate_by_reviewer_monthly", schema.AppealRateByReviewerMonthly),
    ("case_duration_percentiles_daily", schema.CaseDurationPercentilesDaily),
    ("case_open_age_daily", schema.CaseOpenAgeDaily),
    ("case_first_time_right_monthly", schema.CaseFirstTimeRightMonthly),
    ("reviewer_throughput_weekly", schema.ReviewerThroughputWeekly),
    ("reviewer_workload_daily", schema.ReviewerWorkloadDaily),
)

# The tables kept a day at a time (``AccumulateByRun``) rather than rebuilt: a
# snapshot of what is open cannot be rebuilt from Sync once the day has passed.
ACCUMULATED_TABLES = ("case_open_age_daily", "reviewer_workload_daily")

# One gate per source, on the columns the reductions read from it. Stateless,
# so the steps that share a source share its gate.
CURRENT_GATE = ColumnValidator(metrics.CURRENT_COLUMNS)
ORDERING_GATE = ColumnValidator(metrics.ORDERING_COLUMNS)
HISTORY_GATE = ColumnValidator(metrics.HISTORY_COLUMNS)
BACKLOG_GATE = ColumnValidator(metrics.BACKLOG_COLUMNS)
LIFECYCLE_GATE = ColumnValidator(metrics.LIFECYCLE_COLUMNS)
OUTCOME_GATE = ColumnValidator(metrics.OUTCOME_COLUMNS)
DUE_GATE = ColumnValidator(metrics.DUE_COLUMNS)
REMEDIATION_OVERDUE_GATE = ColumnValidator(metrics.REMEDIATION_OVERDUE_COLUMNS)
OUTSTANDING_ANSWER_GATE = ColumnValidator(metrics.OUTSTANDING_ANSWER_COLUMNS)
WORKLOAD_GATE = ColumnValidator(metrics.WORKLOAD_COLUMNS)
APPEAL_RATE_GATE = ColumnValidator(metrics.APPEAL_RATE_COLUMNS)
ANSWER_GATE = ColumnValidator(metrics.ANSWER_COLUMNS)
ACTION_GATE = ColumnValidator(metrics.ANSWER_ACTION_COLUMNS)
APPEAL_GATE = ColumnValidator(metrics.APPEAL_COLUMNS)
MESSAGE_GATE = ColumnValidator(metrics.CONVERSATION_COLUMNS)
DURATION_GATE = ColumnValidator(metrics.DURATION_COLUMNS)
OPEN_AGE_GATE = ColumnValidator(metrics.OPEN_AGE_COLUMNS)
FIRST_TIME_RIGHT_GATE = ColumnValidator(metrics.FIRST_TIME_RIGHT_COLUMNS)
THROUGHPUT_GATE = ColumnValidator(metrics.THROUGHPUT_COLUMNS)


def _union(*column_sets: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(c for columns in column_sets for c in columns))


# What each source is read with: the union of the gates on it. The history and
# the current Cases carry the landed JSON blobs, which no table here reads.
CURRENT_READ = _union(
    metrics.CURRENT_COLUMNS,
    metrics.LIFECYCLE_COLUMNS,
    metrics.OUTCOME_COLUMNS,
    metrics.DUE_COLUMNS,
    metrics.REMEDIATION_OVERDUE_COLUMNS,
    metrics.WORKLOAD_COLUMNS,
    metrics.APPEAL_RATE_COLUMNS,
    metrics.DURATION_COLUMNS,
    metrics.OPEN_AGE_COLUMNS,
    metrics.FIRST_TIME_RIGHT_COLUMNS,
    metrics.THROUGHPUT_COLUMNS,
)
HISTORY_READ = _union(
    metrics.ORDERING_COLUMNS, metrics.HISTORY_COLUMNS, metrics.BACKLOG_COLUMNS
)
ANSWER_READ = _union(metrics.ANSWER_COLUMNS, metrics.OUTSTANDING_ANSWER_COLUMNS)
ACTION_READ = metrics.ANSWER_ACTION_COLUMNS
APPEAL_READ = metrics.APPEAL_COLUMNS
MESSAGE_READ = metrics.CONVERSATION_COLUMNS

CALENDAR_PARAM = "calendar"


def _calendar_from(context: RunContext) -> WorkingDayCalendar:
    path = context.params.get(CALENDAR_PARAM)
    return WorkingDayCalendar.from_yaml(path) if path else WorkingDayCalendar()


def to_ordered_history(observations: Dataset) -> Dataset:
    validate(ORDERING_GATE, observations, name="history:columns")
    return transform(metrics.ordered_history, observations, name="history:order")


def to_stage_dwell(observations: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(HISTORY_GATE, observations, name="dwell:history")
    data = transform(
        partial(metrics.case_stage_dwell, as_of=as_of),
        observations,
        name="dwell:reduce",
    )
    validate(SchemaValidator(schema.CaseStageDwell), data, name="dwell:validate")
    return write(writer, data, name="dwell:write")


def to_hold(observations: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(HISTORY_GATE, observations, name="hold:history")
    data = transform(
        partial(metrics.case_hold, as_of=as_of), observations, name="hold:reduce"
    )
    validate(SchemaValidator(schema.CaseHold), data, name="hold:validate")
    return write(writer, data, name="hold:write")


def to_sla_attainment(
    cases: Dataset, as_of: str, writer: Writer, calendar: WorkingDayCalendar
) -> Dataset:
    data = transform(
        partial(metrics.sla_attainment, as_of=as_of, calendar=calendar),
        cases,
        name="sla:reduce",
    )
    validate(
        SchemaValidator(schema.CaseSlaAttainmentMonthly), data, name="sla:validate"
    )
    return write(writer, data, name="sla:write")


def to_void_monthly(cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    data = transform(
        partial(metrics.void_monthly, as_of=as_of), cases, name="void:reduce"
    )
    validate(SchemaValidator(schema.CaseVoidMonthly), data, name="void:validate")
    return write(writer, data, name="void:write")


def to_action_load(
    actions: Dataset, cases: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(ACTION_GATE, actions, name="action_load:actions")
    data = transform(
        partial(metrics.answer_action_load, as_of=as_of),
        actions,
        cases,
        name="action_load:reduce",
    )
    validate(
        SchemaValidator(schema.AnswerActionLoad), data, name="action_load:validate"
    )
    return write(writer, data, name="action_load:write")


def to_remediation_by_manager(
    answers: Dataset, cases: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(ANSWER_GATE, answers, name="remediation:answers")
    data = transform(
        partial(metrics.answer_remediation_by_manager, as_of=as_of),
        answers,
        cases,
        name="remediation:reduce",
    )
    validate(
        SchemaValidator(schema.AnswerRemediationByManager),
        data,
        name="remediation:validate",
    )
    return write(writer, data, name="remediation:write")


def to_appeal_cycle_time(appeals: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(APPEAL_GATE, appeals, name="appeal_cycle:appeals")
    data = transform(
        partial(metrics.appeal_cycle_time, as_of=as_of),
        appeals,
        name="appeal_cycle:reduce",
    )
    validate(
        SchemaValidator(schema.AppealCycleTime), data, name="appeal_cycle:validate"
    )
    return write(writer, data, name="appeal_cycle:write")


def to_appeal_citations(appeals: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(APPEAL_GATE, appeals, name="appeal_citations:appeals")
    data = transform(
        partial(metrics.appeal_question_citations, as_of=as_of),
        appeals,
        name="appeal_citations:reduce",
    )
    validate(
        SchemaValidator(schema.AppealQuestionCitation),
        data,
        name="appeal_citations:validate",
    )
    return write(writer, data, name="appeal_citations:write")


def to_response_time(
    messages: Dataset, cases: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(MESSAGE_GATE, messages, name="response_time:messages")
    data = transform(
        partial(metrics.conversation_response_time, as_of=as_of),
        messages,
        cases,
        name="response_time:reduce",
    )
    validate(
        SchemaValidator(schema.ConversationResponseTime),
        data,
        name="response_time:validate",
    )
    return write(writer, data, name="response_time:write")


def to_volume(messages: Dataset, cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(MESSAGE_GATE, messages, name="volume:messages")
    data = transform(
        partial(metrics.conversation_volume, as_of=as_of),
        messages,
        cases,
        name="volume:reduce",
    )
    validate(SchemaValidator(schema.ConversationVolume), data, name="volume:validate")
    return write(writer, data, name="volume:write")


def to_posting_pattern(
    messages: Dataset, cases: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(MESSAGE_GATE, messages, name="posting_pattern:messages")
    data = transform(
        partial(metrics.conversation_posting_pattern, as_of=as_of),
        messages,
        cases,
        name="posting_pattern:reduce",
    )
    validate(
        SchemaValidator(schema.ConversationPostingPattern),
        data,
        name="posting_pattern:validate",
    )
    return write(writer, data, name="posting_pattern:write")


def to_intake(cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    data = transform(
        partial(metrics.case_intake, as_of=as_of), cases, name="intake:reduce"
    )
    validate(SchemaValidator(schema.CaseIntakeDaily), data, name="intake:validate")
    return write(writer, data, name="intake:write")


def to_backlog(observations: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(BACKLOG_GATE, observations, name="backlog:history")
    data = transform(
        partial(metrics.case_backlog, as_of=as_of), observations, name="backlog:reduce"
    )
    validate(SchemaValidator(schema.CaseBacklogDaily), data, name="backlog:validate")
    return write(writer, data, name="backlog:write")


def to_lifecycle_duration(cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(LIFECYCLE_GATE, cases, name="lifecycle:current")
    data = transform(
        partial(metrics.case_lifecycle_duration, as_of=as_of),
        cases,
        name="lifecycle:reduce",
    )
    validate(
        SchemaValidator(schema.CaseLifecycleDurationMonthly),
        data,
        name="lifecycle:validate",
    )
    return write(writer, data, name="lifecycle:write")


def to_outcome(cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(OUTCOME_GATE, cases, name="outcome:current")
    data = transform(
        partial(metrics.case_outcome, as_of=as_of), cases, name="outcome:reduce"
    )
    validate(SchemaValidator(schema.CaseOutcomeMonthly), data, name="outcome:validate")
    return write(writer, data, name="outcome:write")


def to_due_profile(cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(DUE_GATE, cases, name="due_profile:current")
    data = transform(
        partial(metrics.case_due_profile, as_of=as_of),
        cases,
        name="due_profile:reduce",
    )
    validate(SchemaValidator(schema.CaseDueProfile), data, name="due_profile:validate")
    return write(writer, data, name="due_profile:write")


def to_remediation_overdue(
    cases: Dataset, answers: Dataset, actions: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(REMEDIATION_OVERDUE_GATE, cases, name="remediation_overdue:current")
    validate(OUTSTANDING_ANSWER_GATE, answers, name="remediation_overdue:answers")
    validate(ACTION_GATE, actions, name="remediation_overdue:actions")
    data = transform(
        partial(metrics.remediation_overdue, as_of=as_of),
        cases,
        answers,
        actions,
        name="remediation_overdue:reduce",
    )
    validate(
        SchemaValidator(schema.RemediationOverdue),
        data,
        name="remediation_overdue:validate",
    )
    return write(writer, data, name="remediation_overdue:write")


def to_workload(
    cases: Dataset, observations: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(WORKLOAD_GATE, cases, name="workload:current")
    validate(HISTORY_GATE, observations, name="workload:history")
    data = transform(
        partial(metrics.reviewer_workload, as_of=as_of),
        cases,
        observations,
        name="workload:reduce",
    )
    validate(SchemaValidator(schema.ReviewerWorkload), data, name="workload:validate")
    return write(writer, data, name="workload:write")


def to_appeal_rate(
    cases: Dataset, appeals: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(APPEAL_RATE_GATE, cases, name="appeal_rate:current")
    validate(APPEAL_GATE, appeals, name="appeal_rate:appeals")
    data = transform(
        partial(metrics.appeal_rate_by_reviewer, as_of=as_of),
        cases,
        appeals,
        name="appeal_rate:reduce",
    )
    validate(
        SchemaValidator(schema.AppealRateByReviewerMonthly),
        data,
        name="appeal_rate:validate",
    )
    return write(writer, data, name="appeal_rate:write")


def to_duration_percentiles(
    cases: Dataset, as_of: str, writer: Writer, calendar: WorkingDayCalendar
) -> Dataset:
    validate(DURATION_GATE, cases, name="durations:current")
    data = transform(
        partial(metrics.case_duration_percentiles, as_of=as_of, calendar=calendar),
        cases,
        name="durations:reduce",
    )
    validate(
        SchemaValidator(schema.CaseDurationPercentilesDaily),
        data,
        name="durations:validate",
    )
    return write(writer, data, name="durations:write")


def to_open_age(cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(OPEN_AGE_GATE, cases, name="open_age:current")
    data = transform(
        partial(metrics.case_open_age, as_of=as_of), cases, name="open_age:reduce"
    )
    validate(SchemaValidator(schema.CaseOpenAgeDaily), data, name="open_age:validate")
    return write(writer, data, name="open_age:write")


def to_first_time_right(
    cases: Dataset, appeals: Dataset, as_of: str, writer: Writer
) -> Dataset:
    validate(FIRST_TIME_RIGHT_GATE, cases, name="first_time_right:current")
    validate(APPEAL_GATE, appeals, name="first_time_right:appeals")
    data = transform(
        partial(metrics.first_time_right, as_of=as_of),
        cases,
        appeals,
        name="first_time_right:reduce",
    )
    validate(
        SchemaValidator(schema.CaseFirstTimeRightMonthly),
        data,
        name="first_time_right:validate",
    )
    return write(writer, data, name="first_time_right:write")


def to_throughput(cases: Dataset, as_of: str, writer: Writer) -> Dataset:
    validate(THROUGHPUT_GATE, cases, name="throughput:current")
    data = transform(
        partial(metrics.reviewer_throughput, as_of=as_of),
        cases,
        name="throughput:reduce",
    )
    validate(
        SchemaValidator(schema.ReviewerThroughputWeekly),
        data,
        name="throughput:validate",
    )
    return write(writer, data, name="throughput:write")


def to_workload_daily(workload: Dataset, as_of: str, writer: Writer) -> Dataset:
    data = transform(
        partial(metrics.reviewer_workload_daily, as_of=as_of),
        workload,
        name="workload_daily:reduce",
    )
    validate(
        SchemaValidator(schema.ReviewerWorkloadDaily),
        data,
        name="workload_daily:validate",
    )
    return write(writer, data, name="workload_daily:write")


def run(context: RunContext) -> Dataset:
    """Read each Sync source once, then build each table in publication order.

    Sources come through their Shared Readers and targets through this
    pipeline's own medallion -- a pipeline resolves where it *writes*, never
    where someone else's data lives. The current Cases are gated here rather
    than in a step because this function reads the snapshot instant off them.
    """
    base_dir = context.base_dir
    gold = medallion(StoreRegistry(base_dir), schema.SUBJECT).gold
    calendar = _calendar_from(context)

    cases = read(
        CurrentCasesReader(base_dir, columns=CURRENT_READ), name="current:read"
    )
    validate(CURRENT_GATE, cases, name="current:columns")
    as_of = metrics.snapshot_as_of(cases)

    observations = to_ordered_history(
        read(
            CaseObservationHistoryReader(base_dir, columns=HISTORY_READ),
            name="history:read",
        )
    )
    answers = read(AnswersReader(base_dir, columns=ANSWER_READ), name="answers:read")
    actions = read(
        AnswerActionsReader(base_dir, columns=ACTION_READ), name="actions:read"
    )
    appeals = read(AppealsReader(base_dir, columns=APPEAL_READ), name="appeals:read")
    messages = read(
        ConversationMessagesReader(base_dir, columns=MESSAGE_READ),
        name="messages:read",
    )

    to_stage_dwell(
        observations, as_of, gold.writer("case_stage_dwell_current", Refresh())
    )
    to_hold(observations, as_of, gold.writer("case_hold_current", Refresh()))
    to_sla_attainment(
        cases, as_of, gold.writer("case_sla_attainment_monthly", Refresh()), calendar
    )
    to_void_monthly(cases, as_of, gold.writer("case_void_monthly", Refresh()))
    to_action_load(
        actions, cases, as_of, gold.writer("answer_action_load_current", Refresh())
    )
    to_remediation_by_manager(
        answers,
        cases,
        as_of,
        gold.writer("answer_remediation_by_manager_current", Refresh()),
    )
    to_appeal_cycle_time(
        appeals, as_of, gold.writer("appeal_cycle_time_current", Refresh())
    )
    to_appeal_citations(
        appeals, as_of, gold.writer("appeal_question_citations_current", Refresh())
    )
    to_response_time(
        messages,
        cases,
        as_of,
        gold.writer("conversation_response_time_current", Refresh()),
    )
    to_volume(
        messages, cases, as_of, gold.writer("conversation_volume_current", Refresh())
    )
    to_posting_pattern(
        messages,
        cases,
        as_of,
        gold.writer("conversation_posting_pattern_current", Refresh()),
    )
    to_intake(cases, as_of, gold.writer("case_intake_daily", Refresh()))
    to_backlog(observations, as_of, gold.writer("case_backlog_daily", Refresh()))
    to_lifecycle_duration(
        cases, as_of, gold.writer("case_lifecycle_duration_monthly", Refresh())
    )
    to_outcome(cases, as_of, gold.writer("case_outcome_monthly", Refresh()))
    to_due_profile(cases, as_of, gold.writer("case_due_profile_current", Refresh()))
    to_remediation_overdue(
        cases,
        answers,
        actions,
        as_of,
        gold.writer("remediation_overdue_current", Refresh()),
    )
    workload = to_workload(
        cases, observations, as_of, gold.writer("reviewer_workload_current", Refresh())
    )
    to_appeal_rate(
        cases, appeals, as_of, gold.writer("appeal_rate_by_reviewer_monthly", Refresh())
    )
    to_duration_percentiles(
        cases,
        as_of,
        gold.writer("case_duration_percentiles_daily", Refresh()),
        calendar,
    )
    by_run = AccumulateByRun.from_context(context)
    to_open_age(cases, as_of, gold.writer("case_open_age_daily", by_run))
    to_first_time_right(
        cases, appeals, as_of, gold.writer("case_first_time_right_monthly", Refresh())
    )
    to_throughput(cases, as_of, gold.writer("reviewer_throughput_weekly", Refresh()))
    return to_workload_daily(
        workload, as_of, gold.writer("reviewer_workload_daily", by_run)
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.cora_platform_metric.pipeline",
        description="Build the Case Review Platform metric tables from Sync.",
    )
    parser.add_argument("--base-dir", default=None)
    parser.add_argument("--calendar", default=None, help="YAML working-day calendar")
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    try:
        run_pipeline(
            run,
            PIPELINE_NAME,
            base_dir=base_dir,
            upstreams=UPSTREAMS,
            params={CALENDAR_PARAM: args.calendar} if args.calendar else None,
        )
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
