"""The run-ordering demo: six real pipelines, and the order they are attempted in.

Two questions are asked here. Do the demo pipelines actually run, printing their
rows and writing no data file? And does the set they are declared in still
demonstrate the ordering it exists to demonstrate — dependency order dominating
deadline pressure, priority sorting behind every deadline, and a gated item
passed over? The second is the one that would otherwise rot silently.
"""

from __future__ import annotations

import datetime as dt
import importlib

import pytest

import pipelines.ordering_demo.schedules as schedules
from framework.run import load_pipeline, run_pipeline
from tools.calendar import WorkingDayCalendar
from tools.orchestration import Orchestrator, RunCandidate, order_run_candidates

# Declared order. steady sits below the report that depends on it, so the
# derived order is demonstrably not this one.
DEMO_ITEMS = ("overdue", "later", "urgent", "report", "steady", "tomorrow")

# A Tuesday afternoon, far from any date boundary: the ordinary case the demo is
# written for. Tomorrow is a Wednesday (weekday ordinal 2).
NOON_TUESDAY = dt.datetime(2026, 6, 23, 14, 30)

# Every day is a working day, matching the calendar the demo ships, so the
# assertions do not depend on which day the suite happens to run.
EVERY_DAY = WorkingDayCalendar(weekend=())


@pytest.fixture
def fixed_clock(monkeypatch):
    """Pin the clock ``build_pipeline_sets`` reads, so its relative times are fixed."""

    def _pin(moment: dt.datetime) -> None:
        monkeypatch.setattr(schedules, "local_now", lambda: moment)

    return _pin


def _items(sets):
    return {item.name: item for item in sets[0].pipelines}


def _candidates(sets, run_date: dt.date):
    return [
        RunCandidate(
            set_name=sets[0].name,
            item=item,
            due_today=item.enabled and item.schedule.is_due(run_date, EVERY_DAY),
            ran_today=False,
        )
        for item in sets[0].pipelines
    ]


# ── the pipelines themselves ──────────────────────────────────────────────────


@pytest.mark.parametrize("name", DEMO_ITEMS)
def test_each_demo_pipeline_runs_and_prints_its_rows(name, tmp_path, capsys):
    loaded = load_pipeline(f"pipelines/ordering_demo/{name}")
    assert loaded.name == name

    run_pipeline(loaded.run, loaded.name, tmp_path)

    printed = capsys.readouterr().out
    module = importlib.import_module(f"pipelines.ordering_demo.{name}.pipeline")
    assert f"[{name}]" in printed
    assert module.ROWS[0][0] in printed


@pytest.mark.parametrize("name", DEMO_ITEMS)
def test_a_demo_run_writes_no_data_file(name, tmp_path):
    loaded = load_pipeline(f"pipelines/ordering_demo/{name}")

    run_pipeline(loaded.run, loaded.name, tmp_path)

    # Everything under the base directory is the framework's own run metadata:
    # the demo's only sink is the console.
    written = {path.relative_to(tmp_path).parts[0] for path in tmp_path.rglob("*")}
    assert written <= {"_runs", "_registry"}


# ── the schedules ─────────────────────────────────────────────────────────────


def test_the_set_declares_the_six_demo_items(fixed_clock):
    fixed_clock(NOON_TUESDAY)

    sets = schedules.build_pipeline_sets()

    assert len(sets) == 1
    assert [item.name for item in sets[0].pipelines] == list(DEMO_ITEMS)
    assert [item.path for item in sets[0].pipelines] == [
        f"pipelines/ordering_demo/{name}" for name in DEMO_ITEMS
    ]


def test_the_relative_times_are_computed_against_the_clock(fixed_clock):
    fixed_clock(NOON_TUESDAY)

    items = _items(schedules.build_pipeline_sets())

    assert items["steady"].due_time is None
    assert items["overdue"].due_time == dt.time(13, 30)
    assert items["report"].due_time == dt.time(13, 30)
    assert items["later"].earliest_run == dt.time(15, 30)
    assert items["urgent"].priority == 100
    assert items["urgent"].due_time is None


def test_report_depends_on_steady(fixed_clock):
    fixed_clock(NOON_TUESDAY)

    items = _items(schedules.build_pipeline_sets())

    assert [dep.upstream_pipeline for dep in items["report"].depends_on] == ["steady"]
    assert items["steady"].depends_on == ()


def test_tomorrow_is_due_tomorrow_and_not_today(fixed_clock):
    fixed_clock(NOON_TUESDAY)
    today = NOON_TUESDAY.date()

    item = _items(schedules.build_pipeline_sets())["tomorrow"]

    assert item.enabled
    assert not item.schedule.is_due(today, EVERY_DAY)
    assert item.schedule.is_due(today + dt.timedelta(days=1), EVERY_DAY)


def test_a_deadline_an_hour_before_midnight_clamps_rather_than_wrapping(fixed_clock):
    fixed_clock(dt.datetime(2026, 6, 23, 0, 30))

    items = _items(schedules.build_pipeline_sets())

    assert items["overdue"].due_time == dt.time(0, 0)


def test_a_window_an_hour_after_midnight_clamps_rather_than_wrapping(fixed_clock):
    fixed_clock(dt.datetime(2026, 6, 23, 23, 30))

    items = _items(schedules.build_pipeline_sets())

    assert items["later"].earliest_run == dt.time(23, 59)


# ── the order the demo exists to demonstrate ──────────────────────────────────


def test_the_derived_order_demonstrates_the_rule(fixed_clock):
    fixed_clock(NOON_TUESDAY)
    sets = schedules.build_pipeline_sets()

    ordered = order_run_candidates(
        _candidates(sets, NOON_TUESDAY.date()), now=NOON_TUESDAY.time()
    )

    assert [item.candidate.item.name for item in ordered] == [
        # Overdue work first. steady inherits report's deadline, so all three
        # press equally and declared order settles them — except that steady is
        # declared *after* report and still precedes it, because dependency
        # order outranks every time input.
        "overdue",
        "steady",
        "report",
        # Priority sorts behind every deadline, ahead of deadline-free work.
        "urgent",
        "later",
        # Not due today at all.
        "tomorrow",
    ]


def test_steady_inherits_reports_deadline_and_later_alone_is_gated(fixed_clock):
    fixed_clock(NOON_TUESDAY)
    sets = schedules.build_pipeline_sets()

    ordered = {
        item.candidate.item.name: item
        for item in order_run_candidates(
            _candidates(sets, NOON_TUESDAY.date()), now=NOON_TUESDAY.time()
        )
    }

    assert ordered["steady"].due_time == dt.time(13, 30)
    assert ordered["steady"].inherited_from == "report"
    assert ordered["steady"].overdue
    assert not ordered["later"].eligible
    assert all(name == "later" or ordered[name].eligible for name in DEMO_ITEMS)


def test_the_plan_reports_the_same_order_with_later_gated(fixed_clock, tmp_path):
    fixed_clock(NOON_TUESDAY)
    orchestrator = Orchestrator(schedules.build_pipeline_sets(), EVERY_DAY)

    plan = orchestrator.plan(
        tmp_path, run_date=NOON_TUESDAY.date(), now=NOON_TUESDAY.time()
    )

    assert [item.pipeline for item in plan.items] == [
        "overdue",
        "steady",
        "report",
        "urgent",
        "later",
        "tomorrow",
    ]
    by_name = {item.pipeline: item for item in plan.items}
    assert by_name["steady"].status == "ready"
    assert "inherited from report" in by_name["steady"].reason
    assert by_name["later"].status == "skipped"
    assert by_name["later"].reason == "before earliest_run 15:30"
    assert by_name["tomorrow"].status == "skipped"
    assert "is not due on tuesday" in by_name["tomorrow"].reason
