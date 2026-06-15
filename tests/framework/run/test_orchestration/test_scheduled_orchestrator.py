import datetime as dt

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.run import (
    DayOfMonth,
    FreshnessRequirement,
    LastWorkingDayOfMonth,
    ManualOnly,
    NthWorkingDayOfMonth,
    OrchestrationStore,
    Orchestrator,
    PipelineRunner,
    PipelineSet,
    ScheduledPipeline,
    SpecificWeekdays,
    Weekdays,
)
from framework.shared import WorkingDayCalendar


def _runner(calls: list[str], failing: set[str] | None = None) -> PipelineRunner:
    runner = PipelineRunner()
    failing = failing or set()

    def register(case_type: str, pipeline: str) -> None:
        def handler(_context):
            label = f"{case_type}/{pipeline}"
            calls.append(label)
            if label in failing:
                raise RuntimeError(f"{label} failed")
            return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

        runner.register(case_type, pipeline, handler)

    for case_type in ("case-a", "case-b", "cases"):
        for pipeline in ("feed-a", "feed-b", "feed-c", "ingest", "selection"):
            register(case_type, pipeline)
    return runner


def test_schedule_matching_uses_working_day_calendar():
    calendar = WorkingDayCalendar(holidays={dt.date(2026, 6, 15)})

    assert Weekdays().is_due(dt.date(2026, 6, 12), calendar)
    assert not Weekdays().is_due(dt.date(2026, 6, 13), calendar)
    assert not Weekdays().is_due(dt.date(2026, 6, 15), calendar)
    assert SpecificWeekdays([0, 2]).is_due(dt.date(2026, 6, 17), calendar)
    assert not SpecificWeekdays([0, 2]).is_due(dt.date(2026, 6, 19), calendar)
    assert DayOfMonth(12).is_due(dt.date(2026, 6, 12), calendar)
    assert NthWorkingDayOfMonth(2).is_due(dt.date(2026, 6, 2), calendar)
    assert LastWorkingDayOfMonth().is_due(dt.date(2026, 6, 30), calendar)
    assert not ManualOnly().is_due(dt.date(2026, 6, 12), calendar)


def test_downstream_waits_until_declared_upstreams_are_fresh(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        _runner(calls),
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("cases", "selection", Weekdays(), depends_on=(
                        FreshnessRequirement("feed-a"),
                        FreshnessRequirement("feed-b"),
                        FreshnessRequirement("feed-c"),
                    )),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == ["cases/selection"]
    assert result.decisions[0].status == "succeeded"


def test_failed_upstream_blocks_dependant_but_not_independent_or_other_set(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        _runner(calls, failing={"case-a/feed-a"}),
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline("case-a", "feed-a", Weekdays()),
                    ScheduledPipeline("case-a", "feed-b", Weekdays()),
                    ScheduledPipeline(
                        "case-a",
                        "selection",
                        Weekdays(),
                        depends_on=(FreshnessRequirement("feed-a"),),
                    ),
                ),
            ),
            PipelineSet(
                "case-b",
                (ScheduledPipeline("case-b", "feed-a", Weekdays()),),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    statuses = {
        f"{decision.case_type}/{decision.pipeline}": decision.status
        for decision in result.decisions
    }
    assert calls == ["case-a/feed-a", "case-a/feed-b", "case-b/feed-a"]
    assert statuses == {
        "case-a/feed-a": "failed",
        "case-a/feed-b": "succeeded",
        "case-a/selection": "blocked",
        "case-b/feed-a": "succeeded",
    }


def test_bounded_loop_does_not_retry_failed_nodes(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        _runner(calls, failing={"cases/ingest"}),
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("cases", "ingest", Weekdays()),
                    ScheduledPipeline(
                        "cases",
                        "selection",
                        Weekdays(),
                        depends_on=(FreshnessRequirement("ingest"),),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    results = orchestrator.run_until_complete(
        tmp_path,
        run_date=dt.date(2026, 6, 12),
        poll_seconds=0,
        max_idle_polls=2,
    )

    assert len(results) == 1
    assert calls == ["cases/ingest"]
    assert [decision.status for decision in results[0].decisions] == [
        "failed",
        "blocked",
    ]


def test_yaml_overrides_disable_schedule_and_freshness(tmp_path):
    calls: list[str] = []
    overrides = tmp_path / "overrides.yml"
    overrides.write_text(
        """
pipelines:
  - set: cases
    case_type: cases
    pipeline: ingest
    enabled: false
  - set: cases
    case_type: cases
    pipeline: selection
    schedule:
      type: specific_weekdays
      weekdays: [4]
    freshness_days: 2
""",
        encoding="utf-8",
    )
    sets = (
        PipelineSet(
            "cases",
            (
                ScheduledPipeline("cases", "ingest", Weekdays()),
                ScheduledPipeline(
                    "cases",
                    "selection",
                    ManualOnly(),
                    depends_on=(FreshnessRequirement("ingest"),),
                ),
            ),
        ),
    )

    orchestrator = Orchestrator.from_yaml(
        _runner(calls), sets, WorkingDayCalendar(), overrides
    )
    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert [decision.status for decision in result.decisions] == [
        "skipped",
        "succeeded",
    ]
    assert calls == ["cases/selection"]


def test_yaml_override_unknown_reference_fails_clearly(tmp_path):
    overrides = tmp_path / "bad.yml"
    overrides.write_text(
        """
pipelines:
  - set: missing
    case_type: cases
    pipeline: ingest
    enabled: false
""",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unknown scheduled pipeline"):
        Orchestrator.from_yaml(
            _runner([]),
            (
                PipelineSet(
                    "cases",
                    (ScheduledPipeline("cases", "ingest", Weekdays()),),
                ),
            ),
            WorkingDayCalendar(),
            overrides,
        )


def test_orchestration_store_records_decisions_separately(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        _runner(calls),
        (PipelineSet("cases", (ScheduledPipeline("cases", "ingest", Weekdays()),)),),
        WorkingDayCalendar(),
    )

    orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    records = OrchestrationStore(tmp_path / "_orchestration" / "runs.db").records()
    assert records[0]["item_key"] == "cases/cases/ingest/2026-06-12"
    assert records[0]["status"] == "succeeded"
