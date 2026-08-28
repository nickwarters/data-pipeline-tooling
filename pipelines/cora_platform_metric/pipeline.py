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
from tools.medallion import Medallion, medallion
from tools.store import StoreRegistry

from . import metrics, schema
from .schema import SUBJECT

PIPELINE_NAME = "cora_platform_metric"
UPSTREAMS = (FreshnessRequirement("sharepoint_cases"),)

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


def _source(reader, columns, *, name: str) -> Dataset:
    """Read one Sync dataset and gate it on the columns the reductions use."""
    data = read(reader, name=f"read:{name}")
    return validate(ColumnValidator(list(columns)), data, name=f"validate:{name}")


def _publish(output: Medallion, table: str, contract: type, dataset: Dataset) -> None:
    validate(SchemaValidator(contract), dataset, name=f"validate:{table}")
    write(output.gold.writer(table, Refresh()), dataset, name=f"write:{table}")


def run(context: RunContext) -> Dataset:
    """Read the Sync subject once, reduce each metric, and refresh its table.

    The sources are read through their Shared Readers and the targets through
    this pipeline's own medallion: a pipeline resolves where it *writes*, never
    where someone else's data lives.
    """
    base_dir = context.base_dir
    output = medallion(StoreRegistry(base_dir), SUBJECT)
    calendar = _calendar_from(context)
    tables = dict(GOLD_TABLES)

    current = _source(
        CurrentCasesReader(base_dir), metrics.CURRENT_COLUMNS, name="case_current"
    )
    history = _source(
        CaseObservationHistoryReader(base_dir),
        metrics.HISTORY_COLUMNS,
        name="case_history",
    )
    answers = _source(AnswersReader(base_dir), metrics.ANSWER_COLUMNS, name="answer")
    actions = _source(
        AnswerActionsReader(base_dir),
        metrics.ANSWER_ACTION_COLUMNS,
        name="answer_action",
    )
    appeals = _source(AppealsReader(base_dir), metrics.APPEAL_COLUMNS, name="appeal")
    messages = _source(
        ConversationMessagesReader(base_dir),
        metrics.CONVERSATION_COLUMNS,
        name="conversation_message",
    )

    dwell = transform(
        metrics.case_stage_dwell, history, current, name="reduce:case_stage_dwell"
    )
    _publish(
        output, "case_stage_dwell_current", tables["case_stage_dwell_current"], dwell
    )

    hold = transform(metrics.case_hold, history, current, name="reduce:case_hold")
    _publish(output, "case_hold_current", tables["case_hold_current"], hold)

    sla = transform(
        lambda cases: metrics.sla_attainment(cases, calendar=calendar),
        current,
        name="reduce:sla_attainment",
    )
    _publish(
        output,
        "case_sla_attainment_monthly",
        tables["case_sla_attainment_monthly"],
        sla,
    )

    void = transform(metrics.void_monthly, current, name="reduce:void_monthly")
    _publish(output, "case_void_monthly", tables["case_void_monthly"], void)

    load = transform(
        metrics.answer_action_load, actions, current, name="reduce:answer_action_load"
    )
    _publish(
        output, "answer_action_load_current", tables["answer_action_load_current"], load
    )

    by_manager = transform(
        metrics.answer_remediation_by_manager,
        answers,
        current,
        name="reduce:answer_remediation_by_manager",
    )
    _publish(
        output,
        "answer_remediation_by_manager_current",
        tables["answer_remediation_by_manager_current"],
        by_manager,
    )

    cycle = transform(
        metrics.appeal_cycle_time, appeals, current, name="reduce:appeal_cycle_time"
    )
    _publish(
        output, "appeal_cycle_time_current", tables["appeal_cycle_time_current"], cycle
    )

    citations = transform(
        metrics.appeal_question_citations,
        appeals,
        current,
        name="reduce:appeal_question_citations",
    )
    _publish(
        output,
        "appeal_question_citations_current",
        tables["appeal_question_citations_current"],
        citations,
    )

    response = transform(
        metrics.conversation_response_time,
        messages,
        current,
        name="reduce:conversation_response_time",
    )
    _publish(
        output,
        "conversation_response_time_current",
        tables["conversation_response_time_current"],
        response,
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
