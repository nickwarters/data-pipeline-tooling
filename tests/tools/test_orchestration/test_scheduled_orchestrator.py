import datetime as dt
import json
import warnings

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
    OrchestrationDecision,
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


def test_last_working_day_of_month_counts_against_a_seeded_holiday():
    # June 2026 ends on Tuesday the 30th; seeding it makes Monday the 29th the
    # month's last working day. This schedule walks the month forward from the
    # run date, the opposite direction to the nth-working-day walk.
    calendar = WorkingDayCalendar(holidays={dt.date(2026, 6, 30)})

    assert not LastWorkingDayOfMonth().is_due(dt.date(2026, 6, 30), calendar)
    assert LastWorkingDayOfMonth().is_due(dt.date(2026, 6, 29), calendar)


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

    # The disabled item is not due work, so it is decided after the due one —
    # ordering seats work that is going to run ahead of work that is not.
    assert [(d.pipeline, d.status) for d in result.decisions] == [
        ("selection", "succeeded"),
        ("ingest", "skipped"),
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


def test_freshness_days_override_on_an_item_without_dependencies_warns(tmp_path):
    """An override that cannot change anything must say so, not pass silently.

    ``freshness_days`` is applied by rewriting each declared dependency, so an
    item that declares none absorbs the override into an empty loop. The
    reference check only proved the set/pipeline names resolved, so an operator
    who tuned freshness on the wrong item got a clean start-up and no effect.
    """
    overrides = tmp_path / "overrides.yml"
    overrides.write_text(
        """
pipelines:
  - set: cases
    pipeline: ingest
    freshness_days: 2
""",
        encoding="utf-8",
    )
    sets = (
        PipelineSet(
            "cases",
            (ScheduledPipeline("pipelines/ingest", Weekdays()),),
        ),
    )

    with pytest.warns(UserWarning, match="freshness_days"):
        Orchestrator.from_yaml(
            sets, WorkingDayCalendar(), overrides, invoker=_FakeInvoker([])
        )


def test_freshness_days_override_on_an_item_with_dependencies_is_silent(tmp_path):
    overrides = tmp_path / "overrides.yml"
    overrides.write_text(
        """
pipelines:
  - set: cases
    pipeline: selection
    freshness_days: 2
""",
        encoding="utf-8",
    )
    sets = (
        PipelineSet(
            "cases",
            (
                ScheduledPipeline(
                    "pipelines/selection",
                    Weekdays(),
                    depends_on=(FreshnessRequirement("ingest"),),
                ),
            ),
        ),
    )

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        Orchestrator.from_yaml(
            sets, WorkingDayCalendar(), overrides, invoker=_FakeInvoker([])
        )


# ── ordering decides the sequence, never the runnability ──────────────────────


def test_invocation_order_follows_deadline_pressure(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline(
                        "pipelines/afternoon", Weekdays(), due_time="16:00"
                    ),
                    ScheduledPipeline(
                        "pipelines/morning", Weekdays(), due_time="09:00"
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    orchestrator.run_due_once(
        tmp_path, run_date=dt.date(2026, 6, 12), now=dt.time(7, 0)
    )

    assert calls == ["morning", "afternoon"]


def test_a_pipeline_set_is_the_outer_boundary_and_never_reordered(tmp_path):
    """Deadline pressure orders work *within* a set; it cannot cross sets.

    The second set's item is overdue and the first set's has no deadline at all,
    so a single pooled ordering would seat it first. Sets run in declared order.
    """
    calls: list[str] = []
    orchestrator = Orchestrator(
        (
            PipelineSet("first", (ScheduledPipeline("pipelines/relaxed", Weekdays()),)),
            PipelineSet(
                "second",
                (ScheduledPipeline("pipelines/overdue", Weekdays(), due_time="06:00"),),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    orchestrator.run_due_once(
        tmp_path, run_date=dt.date(2026, 6, 12), now=dt.time(9, 0)
    )

    assert calls == ["relaxed", "overdue"]


def test_an_upstream_runs_before_a_downstream_that_carries_a_tighter_deadline(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline(
                        "pipelines/selection",
                        Weekdays(),
                        depends_on=(FreshnessRequirement("ingest"),),
                        due_time="09:00",
                        priority=9,
                    ),
                    ScheduledPipeline("pipelines/ingest", Weekdays()),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    result = orchestrator.run_due_once(
        tmp_path, run_date=dt.date(2026, 6, 12), now=dt.time(7, 0)
    )

    assert calls == ["ingest", "selection"]
    assert [d.status for d in result.decisions] == ["succeeded", "succeeded"]


def test_a_gated_item_is_skipped_with_its_window_and_never_invoked(tmp_path):
    calls: list[str] = []
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline(
                        "pipelines/nightly", Weekdays(), earliest_run="23:00"
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    result = orchestrator.run_due_once(
        tmp_path, run_date=dt.date(2026, 6, 12), now=dt.time(9, 0)
    )

    assert calls == []
    assert result.decisions[0].status == "skipped"
    assert result.decisions[0].reason == "before earliest_run 23:00"
    # Still due work for the day, so the loop keeps its promise about settling.
    assert result.decisions[0].was_due is True


def test_the_dependent_of_a_gated_upstream_is_blocked_by_freshness_not_by_the_gate(
    tmp_path,
):
    """The gate orders; freshness decides. The two must not be confused.

    ``earliest_run`` holds its own item back for the pass. Its dependent is
    still evaluated, and what stops it is the ordinary freshness rule finding no
    same-day upstream success — the same verdict it would reach if the upstream
    had simply not run yet.
    """
    calls: list[str] = []
    # Yesterday's success, so the same-day requirement has history to judge and
    # finds it stale rather than falling through its first-run allowance.
    _record_run(
        tmp_path / "_runs" / "ingest.log",
        pipeline="ingest",
        timestamp="2026-06-11T09:00:00+00:00",
    )
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline(
                        "pipelines/ingest", Weekdays(), earliest_run="23:00"
                    ),
                    ScheduledPipeline(
                        "pipelines/selection",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.for_pipeline("ingest")
                            ).same_day(),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_FakeInvoker(calls),
    )

    result = orchestrator.run_due_once(
        tmp_path, run_date=dt.date(2026, 6, 12), now=dt.time(9, 0)
    )

    assert calls == []
    statuses = {d.pipeline: d.status for d in result.decisions}
    assert statuses == {"ingest": "skipped", "selection": "blocked"}
    assert (
        "ingest" in dict((d.pipeline, d.reason) for d in result.decisions)["selection"]
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


def test_a_store_predating_the_correlation_columns_migrates_in_place(tmp_path):
    # The decision store is a live file on the share: one created before the
    # correlation columns joined the schema must keep recording, so the shared
    # additive migration adds what the declaration names.
    import sqlite3

    db_path = tmp_path / "_orchestration" / "runs.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.execute(
        """
        CREATE TABLE orchestration_records (
            timestamp TEXT NOT NULL,
            orchestration_run_id TEXT NOT NULL,
            item_key TEXT NOT NULL,
            set_name TEXT NOT NULL,
            pipeline TEXT NOT NULL,
            run_date TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT,
            duration REAL
        )
        """
    )
    con.execute(
        "INSERT INTO orchestration_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "2026-06-11T00:00:00",
            "orch-0",
            "k0",
            "daily",
            "feed_a",
            "2026-06-11",
            "succeeded",
            None,
            0.5,
        ),
    )
    con.commit()
    con.close()

    store = OrchestrationStore(db_path)
    store.record(
        OrchestrationDecision(
            orchestration_run_id="orch-1",
            item_key="k1",
            set_name="daily",
            pipeline="feed_a",
            run_date=dt.date(2026, 6, 12),
            status="succeeded",
            reason="",
            duration=1.0,
            logical_run_id="feed_a:2026-06-12",
            pipeline_run_id="run-1",
        )
    )

    records = store.records()
    assert [r["orchestration_run_id"] for r in records] == ["orch-0", "orch-1"]
    # The pre-migration row reads back with the new columns empty.
    assert records[0]["pipeline_run_id"] is None
    assert records[1]["pipeline_run_id"] == "run-1"
