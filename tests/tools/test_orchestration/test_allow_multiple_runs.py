"""Test that ``allow_multiple_runs=False`` holds an item to one success per run date."""

import pandas as pd

from framework.core.dataset import Dataset
from framework.run import run_pipeline
from tools.calendar import WorkingDayCalendar
from tools.observability.timestamps import local_now
from tools.orchestration import (
    Orchestrator,
    PipelineSet,
    ScheduledPipeline,
    Weekdays,
)


class _Invoker:
    def __init__(self, failing: frozenset[str] = frozenset()) -> None:
        self.calls: list[str] = []
        self.failing = failing

    def run(
        self, path, base_dir, *, run_date, logical_run_id, freshness_days, freshness
    ):
        name = path.strip("/").split("/")[-1]

        def handler(context):
            self.calls.append(name)
            if name in self.failing:
                raise RuntimeError(f"{name} broke")
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


def _orchestrator(
    *, failing: frozenset[str] = frozenset(), overrides: dict | None = None
) -> tuple[Orchestrator, _Invoker]:
    invoker = _Invoker(failing)
    sets = (
        PipelineSet(
            "cases",
            (
                ScheduledPipeline(
                    "pipelines/once", Weekdays(), allow_multiple_runs=False
                ),
                ScheduledPipeline("pipelines/polling", Weekdays()),
            ),
        ),
    )
    # Every day a working day, so the run date can be today whatever today is.
    calendar = WorkingDayCalendar(weekend=())
    orchestrator = Orchestrator(sets, calendar, overrides, invoker=invoker)
    return orchestrator, invoker


def _statuses(result) -> dict[str, tuple[str, str]]:
    return {d.pipeline: (d.status, d.reason) for d in result.decisions}


def test_a_second_pass_skips_an_item_that_already_succeeded_today(tmp_path):
    orchestrator, invoker = _orchestrator()
    today = local_now().date()

    orchestrator.run_due_once(tmp_path, run_date=today)
    second = orchestrator.run_due_once(tmp_path, run_date=today)

    assert invoker.calls == ["once", "polling", "polling"]
    status, reason = _statuses(second)["once"]
    assert status == "skipped"
    assert "allow_multiple_runs is off" in reason
    assert _statuses(second)["polling"][0] == "succeeded"


def test_force_runs_an_item_that_already_succeeded_today(tmp_path):
    orchestrator, invoker = _orchestrator()
    today = local_now().date()

    orchestrator.run_due_once(tmp_path, run_date=today)
    forced = orchestrator.run_due_once(tmp_path, run_date=today, force=True)

    assert invoker.calls.count("once") == 2
    assert _statuses(forced)["once"][0] == "succeeded"


def test_a_failed_run_does_not_count_as_the_one_run(tmp_path):
    failing, invoker = _orchestrator(failing=frozenset({"once"}))
    today = local_now().date()

    failing.run_due_once(tmp_path, run_date=today)
    invoker.failing = frozenset()
    retry = failing.run_due_once(tmp_path, run_date=today)

    assert invoker.calls.count("once") == 2
    assert _statuses(retry)["once"][0] == "succeeded"


def test_an_override_can_lift_the_limit(tmp_path):
    overrides = {
        "pipelines": [{"set": "cases", "pipeline": "once", "allow_multiple_runs": True}]
    }
    orchestrator, invoker = _orchestrator(overrides=overrides)
    today = local_now().date()

    orchestrator.run_due_once(tmp_path, run_date=today)
    orchestrator.run_due_once(tmp_path, run_date=today)

    assert invoker.calls.count("once") == 2


def test_the_plan_says_what_the_second_pass_will_do(tmp_path):
    orchestrator, _ = _orchestrator()
    today = local_now().date()
    orchestrator.run_due_once(tmp_path, run_date=today)

    plan = {
        item.pipeline: item
        for item in orchestrator.plan(tmp_path, run_date=today).items
    }
    forced = {
        item.pipeline: item
        for item in orchestrator.plan(tmp_path, run_date=today, force=True).items
    }

    assert plan["once"].status == "already-satisfied"
    assert "allow_multiple_runs is off" in plan["once"].reason
    assert plan["polling"].status == "ready"
    assert "runs again (allow_multiple_runs)" in plan["polling"].reason
    assert forced["once"].status == "ready"
    assert "runs again (forced)" in forced["once"].reason


def test_the_limit_is_off_by_default():
    assert ScheduledPipeline("pipelines/x", Weekdays()).allow_multiple_runs is True


def test_the_plan_and_a_second_pass_agree(tmp_path):
    orchestrator, _ = _orchestrator()
    today = local_now().date()
    orchestrator.run_due_once(tmp_path, run_date=today)

    plan = orchestrator.plan(tmp_path, run_date=today)
    second = orchestrator.run_due_once(tmp_path, run_date=today)

    expected = {"ready": "succeeded", "already-satisfied": "skipped"}
    assert [expected[item.status] for item in plan.items] == [
        d.status for d in second.decisions
    ]
