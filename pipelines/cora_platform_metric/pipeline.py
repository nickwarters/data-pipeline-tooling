"""Build the ``cora_platform_metric`` gold tables from the Sync subject.

Nine Aggregate tables, each reduced from the Sync subject's published current
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
from pathlib import Path

from framework.core import (
    ColumnValidator,
    Dataset,
    PipelineError,
    SchemaValidator,
    format_failure,
)
from framework.io import Refresh
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
)

CALENDAR_PARAM = "calendar"


def _calendar_from(context: RunContext) -> WorkingDayCalendar:
    path = context.params.get(CALENDAR_PARAM)
    return WorkingDayCalendar.from_yaml(path) if path else WorkingDayCalendar()


def run(context: RunContext) -> Dataset:
    """Read the Sync subject once, then reduce, validate and write each table.

    Every line is a step: the sources are read and gated on the columns the
    reductions use, then each table is reduced, gated on its contract and
    refreshed, in publication order. Sources come through their Shared Readers
    and targets through this pipeline's own medallion -- a pipeline resolves
    where it *writes*, never where someone else's data lives.
    """
    base_dir = context.base_dir
    gold = medallion(StoreRegistry(base_dir), schema.SUBJECT).gold
    calendar = _calendar_from(context)

    current = read(CurrentCasesReader(base_dir), name="read:case_current")
    current = validate(
        ColumnValidator(list(metrics.CURRENT_COLUMNS)),
        current,
        name="validate:case_current",
    )
    history = read(CaseObservationHistoryReader(base_dir), name="read:case_history")
    history = validate(
        ColumnValidator(list(metrics.HISTORY_COLUMNS)),
        history,
        name="validate:case_history",
    )
    answers = read(AnswersReader(base_dir), name="read:answer")
    answers = validate(
        ColumnValidator(list(metrics.ANSWER_COLUMNS)), answers, name="validate:answer"
    )
    actions = read(AnswerActionsReader(base_dir), name="read:answer_action")
    actions = validate(
        ColumnValidator(list(metrics.ANSWER_ACTION_COLUMNS)),
        actions,
        name="validate:answer_action",
    )
    appeals = read(AppealsReader(base_dir), name="read:appeal")
    appeals = validate(
        ColumnValidator(list(metrics.APPEAL_COLUMNS)), appeals, name="validate:appeal"
    )
    messages = read(ConversationMessagesReader(base_dir), name="read:conversation")
    messages = validate(
        ColumnValidator(list(metrics.CONVERSATION_COLUMNS)),
        messages,
        name="validate:conversation",
    )

    dwell = transform(
        metrics.case_stage_dwell, history, current, name="reduce:case_stage_dwell"
    )
    dwell = validate(
        SchemaValidator(schema.CaseStageDwell), dwell, name="validate:case_stage_dwell"
    )
    write(
        gold.writer("case_stage_dwell_current", Refresh()),
        dwell,
        name="write:case_stage_dwell",
    )

    hold = transform(metrics.case_hold, history, current, name="reduce:case_hold")
    hold = validate(SchemaValidator(schema.CaseHold), hold, name="validate:case_hold")
    write(gold.writer("case_hold_current", Refresh()), hold, name="write:case_hold")

    sla = transform(
        lambda cases: metrics.sla_attainment(cases, calendar=calendar),
        current,
        name="reduce:sla_attainment",
    )
    sla = validate(
        SchemaValidator(schema.CaseSlaAttainmentMonthly),
        sla,
        name="validate:sla_attainment",
    )
    write(
        gold.writer("case_sla_attainment_monthly", Refresh()),
        sla,
        name="write:sla_attainment",
    )

    void = transform(metrics.void_monthly, current, name="reduce:void_monthly")
    void = validate(
        SchemaValidator(schema.CaseVoidMonthly), void, name="validate:void_monthly"
    )
    write(gold.writer("case_void_monthly", Refresh()), void, name="write:void_monthly")

    load = transform(
        metrics.answer_action_load, actions, current, name="reduce:answer_action_load"
    )
    load = validate(
        SchemaValidator(schema.AnswerActionLoad),
        load,
        name="validate:answer_action_load",
    )
    write(
        gold.writer("answer_action_load_current", Refresh()),
        load,
        name="write:answer_action_load",
    )

    by_manager = transform(
        metrics.answer_remediation_by_manager,
        answers,
        current,
        name="reduce:answer_remediation_by_manager",
    )
    by_manager = validate(
        SchemaValidator(schema.AnswerRemediationByManager),
        by_manager,
        name="validate:answer_remediation_by_manager",
    )
    write(
        gold.writer("answer_remediation_by_manager_current", Refresh()),
        by_manager,
        name="write:answer_remediation_by_manager",
    )

    cycle = transform(
        metrics.appeal_cycle_time, appeals, current, name="reduce:appeal_cycle_time"
    )
    cycle = validate(
        SchemaValidator(schema.AppealCycleTime),
        cycle,
        name="validate:appeal_cycle_time",
    )
    write(
        gold.writer("appeal_cycle_time_current", Refresh()),
        cycle,
        name="write:appeal_cycle_time",
    )

    citations = transform(
        metrics.appeal_question_citations,
        appeals,
        current,
        name="reduce:appeal_question_citations",
    )
    citations = validate(
        SchemaValidator(schema.AppealQuestionCitation),
        citations,
        name="validate:appeal_question_citations",
    )
    write(
        gold.writer("appeal_question_citations_current", Refresh()),
        citations,
        name="write:appeal_question_citations",
    )

    response = transform(
        metrics.conversation_response_time,
        messages,
        current,
        name="reduce:conversation_response_time",
    )
    response = validate(
        SchemaValidator(schema.ConversationResponseTime),
        response,
        name="validate:conversation_response_time",
    )
    write(
        gold.writer("conversation_response_time_current", Refresh()),
        response,
        name="write:conversation_response_time",
    )

    return response


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
