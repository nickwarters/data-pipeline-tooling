import datetime as dt
import json

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.run import FreshnessRequirement, Requirement, RunAddress, run_pipeline
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


class _FakeInvoker:
    """A path-addressed invoker that runs in-memory handlers, not disk modules.

    It behaves exactly like ``PathPipelineInvoker`` — resolving the pipeline by
    the leaf of its ``pipelines/<name>`` path and executing through
    ``run_pipeline`` so real run logs and registry records are written — but
    resolves the handler from a dict instead of importing a module. That lets the
    orchestrator's decision, freshness, and lineage logic be exercised without
    real pipeline packages on disk.
    """

    def __init__(self, calls: list[str], failing: set[str] | None = None) -> None:
        self._calls = calls
        self._failing = failing or set()

    def run(
        self,
        path,
        base_dir,
        *,
        run_date,
        logical_run_id,
        freshness_days,
        freshness,
    ):
        name = path.strip("/").split("/")[-1]

        def handler(context):
            # Recorded inside the handler (after any freshness check in
            # run_pipeline), so a freshness-blocked item never counts as a call
            # while a handler that runs and then fails still does.
            self._calls.append(name)
            if name in self._failing:
                raise RuntimeError(f"{name} failed")
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
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline(
                        "pipelines/selection",
                        Weekdays(),
                        depends_on=(
                            FreshnessRequirement("feed_a"),
                            FreshnessRequirement("feed_b"),
                            FreshnessRequirement("feed_c"),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == ["selection"]
    assert result.decisions[0].status == "succeeded"


def test_task_level_requirement_allows_downstream_when_task_success_is_fresh(tmp_path):
    calls: list[str] = []

    def upstream(context):
        calls.append(context.label)
        context.run_log.record(context.pipeline_run_id, context.label, "step-4", "ok")
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    def downstream(context):
        calls.append(context.label)
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    handlers = {"pipeline-2": upstream, "pipeline-3": downstream}

    class _Invoker:
        def run(
            self, path, base_dir, *, run_date, logical_run_id, freshness_days, freshness
        ):
            name = path.strip("/").split("/")[-1]
            return run_pipeline(
                handlers[name],
                name,
                base_dir,
                upstreams=freshness,
                run_date=run_date,
                logical_run_id=logical_run_id,
                freshness_days=freshness_days,
            )

    orchestrator = Orchestrator(
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline("pipelines/pipeline-2", Weekdays()),
                    ScheduledPipeline(
                        "pipelines/pipeline-3",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.task("pipeline-2", "step-4")
                            ).within_days(7),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_Invoker(),
    )

    # A fixed working day (Friday) like the sibling tests: the pipelines are
    # scheduled Weekdays(), so run_date must be a working day or nothing is due.
    # Pinning it keeps the test deterministic (dt.date.today() failed on weekends
    # and holidays); freshness still holds because the upstream runs in the same
    # pass on the same run_date.
    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == ["pipeline-2", "pipeline-3"]
    assert [decision.status for decision in result.decisions] == [
        "succeeded",
        "succeeded",
    ]


def test_task_level_requirement_blocks_downstream_when_task_success_is_stale(
    tmp_path,
):
    calls: list[str] = []
    log_path = tmp_path / "_runs" / "pipeline-2.log"
    _record_run(
        log_path,
        pipeline="pipeline-2",
        step="step-4",
        timestamp="2026-06-01T00:00:00+00:00",
    )
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline(
                        "pipelines/pipeline-3",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.task("pipeline-2", "step-4")
                            ).within_days(7),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == []
    assert result.decisions[0].status == "blocked"
    assert "upstream pipeline-2.step-4 is stale" in result.decisions[0].reason
    records = OrchestrationStore(tmp_path / "_orchestration" / "runs.db").records()
    assert records[0]["status"] == "blocked"
    assert "upstream pipeline-2.step-4 is stale" in records[0]["reason"]


def test_task_level_requirement_blocks_downstream_when_required_task_is_missing(
    tmp_path,
):
    calls: list[str] = []
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline(
                        "pipelines/pipeline-3",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.task("pipeline-2", "step-4")
                            ).on_first_run("block"),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert calls == []
    assert result.decisions[0].status == "blocked"
    assert "no successful run history for upstream pipeline-2.step-4" in (
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
        (
            PipelineSet(
                "case-a",
                (
                    ScheduledPipeline("pipelines/feed_a", Weekdays()),
                    ScheduledPipeline("pipelines/feed_b", Weekdays()),
                    ScheduledPipeline(
                        "pipelines/selection",
                        Weekdays(),
                        depends_on=(FreshnessRequirement("feed_a"),),
                    ),
                ),
            ),
            PipelineSet(
                "case-b",
                (ScheduledPipeline("pipelines/feed_d", Weekdays()),),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls, failing={"feed_a"}),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    statuses = {
        f"{decision.set_name}/{decision.pipeline}": decision.status
        for decision in result.decisions
    }
    assert calls == ["feed_a", "feed_b", "feed_d"]
    assert statuses == {
        "case-a/feed_a": "failed",
        "case-a/feed_b": "succeeded",
        "case-a/selection": "blocked",
        "case-b/feed_d": "succeeded",
    }


def test_bounded_loop_does_not_retry_failed_nodes(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("pipelines/ingest", Weekdays()),
                    ScheduledPipeline(
                        "pipelines/selection",
                        Weekdays(),
                        depends_on=(FreshnessRequirement("ingest"),),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls, failing={"ingest"}),
    )

    results = orchestrator.run_until_complete(
        tmp_path,
        run_date=dt.date(2026, 6, 12),
        poll_seconds=0,
        max_idle_polls=2,
    )

    assert len(results) == 1
    assert calls == ["ingest"]
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
    pipeline: ingest
    enabled: false
  - set: cases
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
                ScheduledPipeline("pipelines/ingest", Weekdays()),
                ScheduledPipeline(
                    "pipelines/selection",
                    ManualOnly(),
                    depends_on=(FreshnessRequirement("ingest"),),
                ),
            ),
        ),
    )

    orchestrator = Orchestrator.from_yaml(
        sets, WorkingDayCalendar(), overrides, invoker=_FakeInvoker(calls)
    )
    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    assert [decision.status for decision in result.decisions] == [
        "skipped",
        "succeeded",
    ]
    assert calls == ["selection"]


def test_yaml_override_unknown_reference_fails_clearly(tmp_path):
    overrides = tmp_path / "bad.yml"
    overrides.write_text(
        """
pipelines:
  - set: missing
    pipeline: ingest
    enabled: false
""",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unknown scheduled pipeline"):
        Orchestrator.from_yaml(
            (
                PipelineSet(
                    "cases",
                    (ScheduledPipeline("pipelines/ingest", Weekdays()),),
                ),
            ),
            WorkingDayCalendar(),
            overrides,
            invoker=_FakeInvoker([]),
        )


def test_orchestration_store_records_decisions_separately(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        (PipelineSet("cases", (ScheduledPipeline("pipelines/ingest", Weekdays()),)),),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    records = OrchestrationStore(tmp_path / "_orchestration" / "runs.db").records()
    assert records[0]["item_key"] == "cases/ingest/2026-06-12"
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
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("pipelines/feed_a", Weekdays()),
                    ScheduledPipeline("pipelines/feed_b", Weekdays()),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    result = orchestrator.run_due_once(tmp_path, run_date=dt.date(2026, 6, 12))

    # Every triggered item carries both correlation ids.
    assert [d.status for d in result.decisions] == ["succeeded", "succeeded"]
    for decision in result.decisions:
        assert decision.logical_run_id == f"{decision.pipeline}:2026-06-12"
        assert decision.pipeline_run_id  # read back from the registry

    # The umbrella id fans out to each pipeline execution via the join key.
    store = OrchestrationStore(tmp_path / "_orchestration" / "runs.db")
    lineage = store.lineage(result.orchestration_run_id)
    assert {row["pipeline"] for row in lineage} == {"feed_a", "feed_b"}

    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    for row in lineage:
        records = registry.records_for_run(row["pipeline_run_id"])
        # The pipeline's step records are reachable from the pass, and the run
        # summary's logical_run_id matches the business key the pass assigned.
        assert {r["pipeline_run_id"] for r in records} == {row["pipeline_run_id"]}
        summary = [r for r in records if r["step"] == "run"]
        assert summary and summary[0]["logical_run_id"] == row["logical_run_id"]
