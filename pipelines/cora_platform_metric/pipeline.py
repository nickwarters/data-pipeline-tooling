"""Build the ``cora_platform_metric`` gold tables from the Sync subject.

Eleven Aggregate tables, each reduced from the Sync subject's published current
state or its observation history through the Shared Readers in
``readers.sharepoint_cases``, and written whole (``Refresh()``) into this
subject's own gold on every run. Each reduction is a function in ``metrics``;
this module only wires readers and writers around them, with the eager steps,
so a run reads top to bottom and can be stepped through in a debugger.

Sources are read once and handed to every reduction that needs them. The
tables commit independently, in order; a failure part-way leaves the earlier
ones refreshed, which is safe because the next run rebuilds everything from the
same Sync snapshot or a newer one.

Run parameters:

* ``calendar`` -- path to a YAML working-day calendar (``holidays`` +
  ``weekend``, the same file ``orchestrate --calendar`` takes). Seeds the
  working-day arithmetic behind ``case_sla_attainment_monthly``; omitted, the
  calendar is weekends-only.
"""

from __future__ import annotations

import argparse
import sys
from functools import partial
from pathlib import Path
from typing import Sequence

from framework.core import (
    ColumnValidator,
    Dataset,
    PipelineError,
    Reader,
    SchemaValidator,
    format_failure,
)
from framework.io import Refresh, Writer
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
)

CALENDAR_PARAM = "calendar"


def _calendar_from(context: RunContext) -> WorkingDayCalendar:
    path = context.params.get(CALENDAR_PARAM)
    return WorkingDayCalendar.from_yaml(path) if path else WorkingDayCalendar()


def _gated(reader: Reader, columns: Sequence[str], at: str) -> Dataset:
    """Read one Sync dataset and gate it on the columns the step uses."""
    data = read(reader, name=f"{at}:read")
    validate(ColumnValidator(list(columns)), data, name=f"{at}:columns")
    return data


def to_stage_dwell(history: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "dwell"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    observations = _gated(history, metrics.HISTORY_COLUMNS, f"{at}:history")
    data = transform(metrics.case_stage_dwell, observations, cases, name=f"{at}:reduce")
    validate(SchemaValidator(schema.CaseStageDwell), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def to_hold(history: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "hold"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    observations = _gated(history, metrics.HISTORY_COLUMNS, f"{at}:history")
    data = transform(metrics.case_hold, observations, cases, name=f"{at}:reduce")
    validate(SchemaValidator(schema.CaseHold), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def to_sla_attainment(
    current: Reader, writer: Writer, calendar: WorkingDayCalendar
) -> Dataset:
    at = "sla"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    data = transform(
        partial(metrics.sla_attainment, calendar=calendar), cases, name=f"{at}:reduce"
    )
    validate(
        SchemaValidator(schema.CaseSlaAttainmentMonthly), data, name=f"{at}:validate"
    )
    return write(writer, data, name=f"{at}:write")


def to_void_monthly(current: Reader, writer: Writer) -> Dataset:
    at = "void"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    data = transform(metrics.void_monthly, cases, name=f"{at}:reduce")
    validate(SchemaValidator(schema.CaseVoidMonthly), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def to_action_load(actions: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "action_load"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    rows = _gated(actions, metrics.ANSWER_ACTION_COLUMNS, f"{at}:actions")
    data = transform(metrics.answer_action_load, rows, cases, name=f"{at}:reduce")
    validate(SchemaValidator(schema.AnswerActionLoad), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def to_remediation_by_manager(
    answers: Reader, current: Reader, writer: Writer
) -> Dataset:
    at = "remediation_by_manager"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    rows = _gated(answers, metrics.ANSWER_COLUMNS, f"{at}:answers")
    data = transform(
        metrics.answer_remediation_by_manager, rows, cases, name=f"{at}:reduce"
    )
    validate(
        SchemaValidator(schema.AnswerRemediationByManager), data, name=f"{at}:validate"
    )
    return write(writer, data, name=f"{at}:write")


def to_appeal_cycle_time(appeals: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "appeal_cycle"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    rows = _gated(appeals, metrics.APPEAL_COLUMNS, f"{at}:appeals")
    data = transform(metrics.appeal_cycle_time, rows, cases, name=f"{at}:reduce")
    validate(SchemaValidator(schema.AppealCycleTime), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def to_appeal_citations(appeals: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "appeal_citations"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    rows = _gated(appeals, metrics.APPEAL_COLUMNS, f"{at}:appeals")
    data = transform(
        metrics.appeal_question_citations, rows, cases, name=f"{at}:reduce"
    )
    validate(
        SchemaValidator(schema.AppealQuestionCitation), data, name=f"{at}:validate"
    )
    return write(writer, data, name=f"{at}:write")


def to_response_time(messages: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "response_time"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    rows = _gated(messages, metrics.CONVERSATION_COLUMNS, f"{at}:messages")
    data = transform(
        metrics.conversation_response_time, rows, cases, name=f"{at}:reduce"
    )
    validate(
        SchemaValidator(schema.ConversationResponseTime), data, name=f"{at}:validate"
    )
    return write(writer, data, name=f"{at}:write")


def to_volume(messages: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "volume"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    rows = _gated(messages, metrics.CONVERSATION_COLUMNS, f"{at}:messages")
    data = transform(metrics.conversation_volume, rows, cases, name=f"{at}:reduce")
    validate(SchemaValidator(schema.ConversationVolume), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def to_posting_pattern(messages: Reader, current: Reader, writer: Writer) -> Dataset:
    at = "posting_pattern"
    cases = _gated(current, metrics.CURRENT_COLUMNS, f"{at}:current")
    rows = _gated(messages, metrics.CONVERSATION_COLUMNS, f"{at}:messages")
    data = transform(
        metrics.conversation_posting_pattern, rows, cases, name=f"{at}:reduce"
    )
    validate(
        SchemaValidator(schema.ConversationPostingPattern), data, name=f"{at}:validate"
    )
    return write(writer, data, name=f"{at}:write")


def run(context: RunContext) -> Dataset:
    """Build each table in publication order.

    Sources come through their Shared Readers and targets through this
    pipeline's own medallion -- a pipeline resolves where it *writes*, never
    where someone else's data lives. Each ``to_*`` step reads what it needs,
    gates it, reduces, validates and writes one table.
    """
    base_dir = context.base_dir
    gold = medallion(StoreRegistry(base_dir), schema.SUBJECT).gold
    calendar = _calendar_from(context)

    current = CurrentCasesReader(base_dir)
    history = CaseObservationHistoryReader(base_dir)
    answers = AnswersReader(base_dir)
    actions = AnswerActionsReader(base_dir)
    appeals = AppealsReader(base_dir)
    messages = ConversationMessagesReader(base_dir)

    to_stage_dwell(history, current, gold.writer("case_stage_dwell_current", Refresh()))
    to_hold(history, current, gold.writer("case_hold_current", Refresh()))
    to_sla_attainment(
        current, gold.writer("case_sla_attainment_monthly", Refresh()), calendar
    )
    to_void_monthly(current, gold.writer("case_void_monthly", Refresh()))
    to_action_load(
        actions, current, gold.writer("answer_action_load_current", Refresh())
    )
    to_remediation_by_manager(
        answers,
        current,
        gold.writer("answer_remediation_by_manager_current", Refresh()),
    )
    to_appeal_cycle_time(
        appeals, current, gold.writer("appeal_cycle_time_current", Refresh())
    )
    to_appeal_citations(
        appeals, current, gold.writer("appeal_question_citations_current", Refresh())
    )
    to_response_time(
        messages, current, gold.writer("conversation_response_time_current", Refresh())
    )
    to_volume(messages, current, gold.writer("conversation_volume_current", Refresh()))
    return to_posting_pattern(
        messages,
        current,
        gold.writer("conversation_posting_pattern_current", Refresh()),
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
