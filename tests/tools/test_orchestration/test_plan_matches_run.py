"""The plan and the pass read one derivation, so they cannot order differently.

The preview's promise is *this is what will happen*. Two loops each deciding
their own order is exactly how that promise rots — the plan/run divergence on
``already-satisfied`` (issue #404) started the same way — so both now iterate the
single sequence ``_ordered_pass`` returns, and this test holds them to it with a
fixture that exercises every ordering input at once.
"""

import datetime as dt

import pandas as pd

from framework.core.dataset import Dataset
from framework.run import FreshnessRequirement, Requirement, RunAddress, run_pipeline
from tools.calendar import WorkingDayCalendar
from tools.orchestration import (
    ManualOnly,
    Orchestrator,
    PipelineSet,
    ScheduledPipeline,
    Weekdays,
)

RUN_DATE = dt.date(2026, 6, 12)  # a Friday
NOW = dt.time(9, 30)

# What each plan status becomes once the pass actually decides the item. The
# only translation is that a plan distinguishes *why* an item is not running,
# while a decision records one skipped status for all of them.
_EXPECTED_DECISION = {
    "ready": "succeeded",
    "skipped": "skipped",
    "disabled": "skipped",
    "blocked": "blocked",
}


class _Invoker:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def run(
        self, path, base_dir, *, run_date, logical_run_id, freshness_days, freshness
    ):
        name = path.strip("/").split("/")[-1]

        def handler(context):
            self.calls.append(name)
            return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

        return run_pipeline(
            handler,
            name,
            base_dir,
            upstreams=freshness,
            run_date=run_date,
            logical_run_id=logical_run_id,
            freshness_days=freshness_days,
        )


def _orchestrator() -> tuple[Orchestrator, _Invoker]:
    invoker = _Invoker()
    sets = (
        PipelineSet(
            "cases",
            (
                # Declared dependent-first and with the higher priority, so only
                # dependency dominance can put ingest ahead of it.
                ScheduledPipeline(
                    "pipelines/reporting",
                    Weekdays(),
                    depends_on=(FreshnessRequirement("ingest"),),
                    due_time="09:00",
                    priority=5,
                ),
                ScheduledPipeline("pipelines/ingest", Weekdays()),
                ScheduledPipeline(
                    "pipelines/nightly", Weekdays(), earliest_run="23:00"
                ),
                ScheduledPipeline(
                    "pipelines/downstream",
                    Weekdays(),
                    depends_on=(
                        Requirement.succeeded(
                            RunAddress.for_pipeline("external")
                        ).on_first_run("block"),
                    ),
                ),
                ScheduledPipeline("pipelines/month_close", ManualOnly()),
                ScheduledPipeline(
                    "pipelines/archived", Weekdays(), enabled=False, priority=9
                ),
            ),
        ),
    )
    return Orchestrator(sets, WorkingDayCalendar(), invoker=invoker), invoker


def test_the_plan_and_the_pass_agree_on_order_and_on_every_status(tmp_path):
    orchestrator, _ = _orchestrator()

    plan = orchestrator.plan(tmp_path, run_date=RUN_DATE, now=NOW)
    result = orchestrator.run_due_once(tmp_path, run_date=RUN_DATE, now=NOW)

    assert [item.pipeline for item in plan.items] == [
        decision.pipeline for decision in result.decisions
    ]
    assert [_EXPECTED_DECISION[item.status] for item in plan.items] == [
        decision.status for decision in result.decisions
    ]


def test_the_shared_order_is_the_derived_one_not_the_declared_one(tmp_path):
    orchestrator, invoker = _orchestrator()

    plan = orchestrator.plan(tmp_path, run_date=RUN_DATE, now=NOW)
    orchestrator.run_due_once(tmp_path, run_date=RUN_DATE, now=NOW)

    assert [item.pipeline for item in plan.items] == [
        # ingest inherits reporting's 09:00 deadline and is emitted first
        # because reporting depends on it, priority notwithstanding.
        "ingest",
        "reporting",
        # No deadline, so behind the overdue pair; gated and blocked items keep
        # their derived position rather than dropping out.
        "nightly",
        "downstream",
        # Not due work, ordered last in declared order.
        "month_close",
        "archived",
    ]
    assert invoker.calls == ["ingest", "reporting"]
