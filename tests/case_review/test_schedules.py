"""Tests for the case-review application's orchestration schedules.

Drives the real ``build_pipeline_sets()`` through a real ``Orchestrator`` with a
recording invoker, so working-day gating is proven without executing the feed or
touching scheduling internals.
"""

import datetime as dt

from case_review.schedules import build_pipeline_sets
from framework.run import load_pipeline
from tools.calendar import WorkingDayCalendar
from tools.orchestration import OrchestrationStore, Orchestrator, Schedule


class _RecordingInvoker:
    """A path-addressed invoker that only records the paths it was handed."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def run(
        self, path, base_dir, *, run_date, logical_run_id, freshness_days, freshness
    ):
        self.calls.append(path)


def _orchestrator(calendar: WorkingDayCalendar) -> tuple[Orchestrator, list[str]]:
    invoker = _RecordingInvoker()
    orchestrator = Orchestrator(build_pipeline_sets(), calendar, invoker=invoker)
    return orchestrator, invoker.calls


def test_the_schedule_registers_exactly_the_sharepoint_pipeline_daily():
    sets = build_pipeline_sets()

    assert [pipeline_set.name for pipeline_set in sets] == ["case_management"]
    (item,) = sets[0].pipelines
    assert item.path == "pipelines/sharepoint_cases"
    assert item.name == "sharepoint_cases"
    assert item.schedule == Schedule.daily()
    # The path is only an address until something resolves it: a typo would pass
    # every assertion above and fail only in production.
    assert callable(load_pipeline(item.path).run)


def test_a_working_day_pass_invokes_the_sharepoint_pipeline(tmp_path):
    orchestrator, calls = _orchestrator(WorkingDayCalendar())

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 8, 5))

    assert calls == ["pipelines/sharepoint_cases"]
    (decision,) = result.decisions
    assert decision.status == "succeeded"
    assert decision.was_due is True


def test_a_weekend_or_configured_holiday_pass_skips_it(tmp_path):
    for weekend_day in (dt.date(2026, 8, 8), dt.date(2026, 8, 9)):
        orchestrator, calls = _orchestrator(WorkingDayCalendar())

        result = orchestrator.run_due_once(tmp_path, run_date=weekend_day)

        assert calls == []
        (decision,) = result.decisions
        assert decision.status == "skipped"
        assert decision.was_due is False

    # A holiday skips only when the calendar was seeded with one. The operator
    # command seeds its calendar from `--calendar <file>` (proved end-to-end in
    # tests/framework/_cli/test_operator.py); what this proves is the other half
    # — that the schedule honours whatever calendar it is handed.
    wednesday = dt.date(2026, 8, 5)
    orchestrator, calls = _orchestrator(WorkingDayCalendar(holidays={wednesday}))

    result = orchestrator.run_due_once(tmp_path, run_date=wednesday)

    assert calls == []
    (decision,) = result.decisions
    assert decision.status == "skipped"
    assert decision.was_due is False


def test_two_operator_passes_on_one_weekday_are_safe(tmp_path):
    """Both passes are due, reach the pipeline, and are recorded separately.

    What this does *not* prove: that the data converges. Landing the same window
    twice is the feed's own contract — the watermark plus its append-only key —
    covered by
    ``tests/pipelines/test_sharepoint_cases.py::test_a_repeated_observation_is_a_no_op_in_raw_and_silver``.
    """
    wednesday = dt.date(2026, 8, 5)
    orchestrator, calls = _orchestrator(WorkingDayCalendar())

    first = orchestrator.run_due_once(tmp_path, run_date=wednesday)
    second = orchestrator.run_due_once(tmp_path, run_date=wednesday)

    assert calls == ["pipelines/sharepoint_cases", "pipelines/sharepoint_cases"]
    for result in (first, second):
        (decision,) = result.decisions
        assert decision.status == "succeeded"

    records = OrchestrationStore(tmp_path / "_orchestration" / "runs.db").records()
    assert len(records) == 2
