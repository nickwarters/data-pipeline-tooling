import datetime as dt
import json

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.run import FreshnessRequirement, PipelineRunner, Requirement, RunAddress
from tools.calendar import WorkingDayCalendar
from tools.orchestration import (
    DayOfMonth,
    LastWorkingDayOfMonth,
    ManualOnly,
    NthWorkingDayOfMonth,
    OrchestrationStore,
    Orchestrator,
    PipelineSet,
    ScheduledPipeline,
    SpecificWeekdays,
    Weekdays,
)


def _runner(calls: list[str], failing: set[str] | None = None) -> PipelineRunner:
    runner = PipelineRunner()
    failing = failing or set()

    def register(subject: str, pipeline: str) -> None:
        def handler(_context):
            label = f"{subject}/{pipeline}"
            calls.append(label)
            if label in failing:
                raise RuntimeError(f"{label} failed")
            return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

        runner.register(subject, pipeline, handler)

    for subject in ("case-a", "case-b", "cases"):
        for pipeline in ("feed-a", "feed-b", "feed-c", "ingest", "selection"):
            register(subject, pipeline)
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
                    ScheduledPipeline(
                        "cases",
                        "selection",
                        Weekdays(),
                        depends_on=(
                            FreshnessRequirement("feed-a"),
                            FreshnessRequirement("feed-b"),
                            FreshnessRequirement("feed-c"),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == ["cases/selection"]
    assert result.decisions[0].status == "succeeded"


def test_task_level_requirement_allows_downstream_when_task_success_is_fresh(tmp_path):
    calls: list[str] = []
    runner = PipelineRunner()

    def upstream(context):
        calls.append(context.label)
        context.run_log.record(context.pipeline_run_id, context.label, "step-4", "ok")
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    def downstream(context):
        calls.append(context.label)
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    runner.register("case-a", "pipeline-2", upstream)
    runner.register("case-a", "pipeline-3", downstream)
    orchestrator = Orchestrator(
        runner,
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline("case-a", "pipeline-2", Weekdays()),
                    ScheduledPipeline(
                        "case-a",
                        "pipeline-3",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.task(
                                    "pipeline-2", "step-4", subject="case-a"
                                )
                            ).within_days(7),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    # A fixed working day (Friday) like the sibling tests: the pipelines are
    # scheduled Weekdays(), so run_date must be a working day or nothing is due.
    # Pinning it keeps the test deterministic (dt.date.today() failed on weekends
    # and holidays); freshness still holds because the upstream runs in the same
    # pass on the same run_date.
    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == ["case-a/pipeline-2", "case-a/pipeline-3"]
    assert [decision.status for decision in result.decisions] == [
        "succeeded",
        "succeeded",
    ]


def test_task_level_requirement_blocks_downstream_when_task_success_is_stale(
    tmp_path,
):
    calls: list[str] = []
    log_path = tmp_path / "_runs" / "case-a.log"
    _record_run(
        log_path,
        pipeline="case-a/pipeline-2",
        step="step-4",
        timestamp="2026-06-01T00:00:00+00:00",
    )
    runner = PipelineRunner()

    def downstream(context):
        calls.append(context.label)
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    runner.register("case-a", "pipeline-3", downstream)
    orchestrator = Orchestrator(
        runner,
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline(
                        "case-a",
                        "pipeline-3",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.task(
                                    "pipeline-2", "step-4", subject="case-a"
                                )
                            ).within_days(7),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == []
    assert result.decisions[0].status == "blocked"
    assert "upstream case-a/pipeline-2.step-4 is stale" in result.decisions[0].reason
    records = OrchestrationStore(tmp_path / "_orchestration" / "runs.db").records()
    assert records[0]["status"] == "blocked"
    assert "upstream case-a/pipeline-2.step-4 is stale" in records[0]["reason"]


def test_task_level_requirement_blocks_downstream_when_required_task_is_missing(
    tmp_path,
):
    calls: list[str] = []
    runner = PipelineRunner()

    def downstream(context):
        calls.append(context.label)
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    runner.register("case-a", "pipeline-3", downstream)
    orchestrator = Orchestrator(
        runner,
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline(
                        "case-a",
                        "pipeline-3",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.task(
                                    "pipeline-2", "step-4", subject="case-a"
                                )
                            ).on_first_run("block"),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == []
    assert result.decisions[0].status == "blocked"
    assert "no successful run history for upstream case-a/pipeline-2.step-4" in (
        result.decisions[0].reason
    )


def _record_run(
    log_path,
    *,
    pipeline: str,
    step: str = "run",
    status: str = "ok",
    timestamp: str = "2026-06-12T00:00:00+00:00",
    pipeline_run_id: str = "upstream",
) -> None:
    record = {
        "timestamp": timestamp,
        "pipeline_run_id": pipeline_run_id,
        "pipeline": pipeline,
        "step": step,
        "status": status,
        "rows_in": None,
        "rows_out": None,
        "rows_quarantined": None,
        "rows_excluded": None,
        "duration": 0,
        "errors": [],
        "warn_hits": [],
    }
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")


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
        f"{decision.subject}/{decision.pipeline}": decision.status
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
    subject: cases
    pipeline: ingest
    enabled: false
  - set: cases
    subject: cases
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
    subject: cases
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


def test_orchestration_lineage_links_a_pass_to_each_pipeline_execution(tmp_path):
    # One orchestration pass fans out to several pipeline runs. Each decision
    # records the logical_run_id the pass assigned (the stable business key) and
    # the pipeline_run_id it read back from the registry, so lineage(pass_id)
    # joins straight to RunRegistry.records_for_run(pipeline_run_id) — the link
    # from a runner invocation to every pipeline execution it triggered.
    from tools.observability.run_registry import RunRegistry

    calls: list[str] = []
    orchestrator = Orchestrator(
        _runner(calls),
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("cases", "feed-a", Weekdays()),
                    ScheduledPipeline("cases", "feed-b", Weekdays()),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    # Every triggered item carries both correlation ids.
    assert [d.status for d in result.decisions] == ["succeeded", "succeeded"]
    for decision in result.decisions:
        assert decision.logical_run_id == f"cases/{decision.pipeline}:2026-06-12"
        assert decision.pipeline_run_id  # read back from the registry

    # The umbrella id fans out to each pipeline execution via the join key.
    store = OrchestrationStore(tmp_path / "_orchestration" / "runs.db")
    lineage = store.lineage(result.orchestration_run_id)
    assert {row["pipeline"] for row in lineage} == {"feed-a", "feed-b"}

    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    for row in lineage:
        records = registry.records_for_run(row["pipeline_run_id"])
        # The pipeline's step records are reachable from the pass, and the run
        # summary's logical_run_id matches the business key the pass assigned.
        assert {r["pipeline_run_id"] for r in records} == {row["pipeline_run_id"]}
        summary = [r for r in records if r["step"] == "run"]
        assert summary and summary[0]["logical_run_id"] == row["logical_run_id"]
