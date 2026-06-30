import datetime as dt
import json
from pathlib import Path

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.readers import DatasetReader, SqliteReader
from framework.io.strategy import AccumulateByRun
from framework.run import Requirement
from framework.run.builder import Pipeline
from framework.run.runner import (
    FreshnessError,
    FreshnessGuard,
    FreshnessRequirement,
    PipelineRunner,
    RunContext,
    UnknownPipelineError,
    run_pipeline,
)
from tools.medallion import medallion
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry
from tools.store import StoreRegistry


def _record_run(
    log_path: Path,
    *,
    pipeline: str,
    step: str = "run",
    status: str = "ok",
    timestamp: str = "2026-05-29T00:00:00+00:00",
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


def _context(tmp_path, *, run_date=dt.date(2026, 5, 29)) -> RunContext:
    log_path = tmp_path / "runs.log"
    registry = RunRegistry(tmp_path / "registry.db")
    if log_path.exists():
        registry.ingest(log_path)
    return RunContext(
        base_dir=tmp_path,
        subject="cases",
        pipeline="selection",
        run_date=run_date,
        pipeline_run_id="selection-run",
        run_log=RunLog(log_path),
        run_registry=registry,
    )


def _records(log_path: Path) -> list[dict]:
    return [json.loads(line) for line in log_path.read_text().splitlines()]


def test_freshness_guard_allows_current_successful_upstream_run(tmp_path):
    log_path = tmp_path / "runs.log"
    _record_run(log_path, pipeline="cases/ingest")
    context = _context(tmp_path)

    FreshnessGuard().check(context, FreshnessRequirement("ingest"))

    freshness = [r for r in _records(log_path) if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "ok"
    assert freshness[-1]["warn_hits"] == []


def test_requirement_within_days_allows_recent_successful_task(tmp_path):
    log_path = tmp_path / "runs.log"
    _record_run(
        log_path,
        pipeline="cases/ingest",
        step="normalise",
        timestamp="2026-05-23T00:00:00+00:00",
    )
    context = _context(tmp_path, run_date=dt.date(2026, 5, 29))

    FreshnessGuard().check(
        context,
        Requirement.succeeded("cases/ingest.normalise").within_days(7),
    )

    freshness = [r for r in _records(log_path) if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "ok"
    assert freshness[-1]["warn_hits"] == []


def test_requirement_same_day_requires_success_on_run_date(tmp_path):
    log_path = tmp_path / "runs.log"
    _record_run(
        log_path,
        pipeline="cases/ingest",
        timestamp="2026-05-28T23:59:00+00:00",
        pipeline_run_id="yesterday",
    )
    context = _context(tmp_path, run_date=dt.date(2026, 5, 29))

    with pytest.raises(FreshnessError, match="required on 2026-05-29"):
        FreshnessGuard().check(
            context,
            Requirement.succeeded("cases/ingest").same_day(),
        )

    freshness = [r for r in _records(log_path) if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "error"


def test_requirement_same_day_allows_success_on_run_date(tmp_path):
    log_path = tmp_path / "runs.log"
    _record_run(
        log_path,
        pipeline="cases/ingest",
        timestamp="2026-05-29T23:59:00+00:00",
    )
    context = _context(tmp_path, run_date=dt.date(2026, 5, 29))

    FreshnessGuard().check(context, Requirement.succeeded("cases/ingest").same_day())

    freshness = [r for r in _records(log_path) if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "ok"
    assert freshness[-1]["warn_hits"] == []


def test_requirement_first_run_policy_can_allow_without_warning(tmp_path):
    context = _context(tmp_path)

    FreshnessGuard().check(
        context,
        Requirement.succeeded("cases/ingest").on_first_run("allow"),
    )

    freshness = [r for r in _records(tmp_path / "runs.log") if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "ok"
    assert freshness[-1]["warn_hits"] == []


def test_requirement_first_run_policy_can_block(tmp_path):
    context = _context(tmp_path)

    with pytest.raises(FreshnessError, match="blocking first run"):
        FreshnessGuard().check(
            context,
            Requirement.succeeded("cases/ingest").on_first_run("block"),
        )

    freshness = [r for r in _records(tmp_path / "runs.log") if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "error"


def test_freshness_requirement_adapts_to_requirement_with_default_subject():
    requirement = FreshnessRequirement("ingest", max_age_days=3)

    adapted = requirement.as_requirement(default_subject="cases")

    assert adapted == Requirement.succeeded("cases/ingest").within_days(3)


def test_freshness_guard_aborts_when_successful_upstream_is_too_old(tmp_path):
    log_path = tmp_path / "runs.log"
    _record_run(
        log_path,
        pipeline="cases/ingest",
        timestamp="2026-05-27T00:00:00+00:00",
    )
    context = _context(tmp_path, run_date=dt.date(2026, 5, 29))

    with pytest.raises(FreshnessError, match="upstream cases/ingest is stale"):
        FreshnessGuard().check(context, FreshnessRequirement("ingest"))

    freshness = [r for r in _records(log_path) if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "error"


def test_freshness_guard_ignores_failed_upstream_runs(tmp_path):
    log_path = tmp_path / "runs.log"
    _record_run(
        log_path,
        pipeline="cases/ingest",
        status="error",
        timestamp="2026-05-29T00:00:00+00:00",
    )
    context = _context(tmp_path)

    FreshnessGuard().check(context, FreshnessRequirement("ingest"))

    freshness = [r for r in _records(log_path) if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "ok"
    assert "no successful run history" in freshness[-1]["warn_hits"][0]


def test_freshness_guard_allows_and_warns_when_no_history_exists(tmp_path):
    context = _context(tmp_path)

    FreshnessGuard().check(context, FreshnessRequirement("ingest"))

    freshness = [r for r in _records(tmp_path / "runs.log") if r["step"] == "freshness"]
    assert freshness[-1]["status"] == "ok"
    assert "allowing first run" in freshness[-1]["warn_hits"][0]


def test_runner_registers_and_runs_handler_by_subject_and_pipeline(tmp_path):
    runner = PipelineRunner()
    seen = []

    def handler(context):
        seen.append((context.subject, context.pipeline, context.label))
        return Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))

    runner.register("cases", "ingest", handler)

    result = runner.run("cases", "ingest", tmp_path, run_date=dt.date(2026, 5, 29))

    assert len(result) == 2
    assert seen == [("cases", "ingest", "cases/ingest")]
    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    (run,) = registry.query_runs(pipeline="cases/ingest")
    assert run["status"] == "ok"


def test_run_context_carries_explicit_params():
    context = RunContext(params={"source_file": "/share/upstream/claims/a.csv"})

    assert context.params == {"source_file": "/share/upstream/claims/a.csv"}


def test_run_pipeline_passes_params_to_handler_and_records_safe_diagnostics(tmp_path):
    seen = []

    def handler(context):
        seen.append(context.params)
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    run_pipeline(
        handler,
        "ingest",
        tmp_path,
        run_date=dt.date(2026, 6, 22),
        params={
            "source_file": "/share/upstream/claims/claims_20260622_a.csv",
            "api_secret": "super-secret-token",
        },
    )

    assert seen == [
        {
            "source_file": "/share/upstream/claims/claims_20260622_a.csv",
            "api_secret": "super-secret-token",
        }
    ]
    log_records = _records(tmp_path / "_runs" / "ingest.log")
    run_summary = [record for record in log_records if record["step"] == "run"][-1]
    assert run_summary["params"] == {
        "source_file": "/share/upstream/claims/claims_20260622_a.csv",
        "api_secret": "<redacted>",
    }


def test_runner_context_correlates_logs_registry_and_accumulated_rows(tmp_path):
    runner = PipelineRunner()

    def handler(context):
        gold = medallion(StoreRegistry(context.base_dir), context.subject).gold
        source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))
        p = Pipeline(context.label)
        r = p.read(DatasetReader(source), name="read")
        writer = gold.writer(
            "selection_pool",
            AccumulateByRun.from_context(context),
        )
        p.write(writer, r, name="write")
        return p.run(context=context)

    runner.register("cases", "selection", handler)

    runner.run("cases", "selection", tmp_path, run_date=dt.date(2026, 5, 29))

    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    (run,) = registry.query_runs(pipeline="cases/selection")
    landed = (
        SqliteReader(tmp_path / "cases" / "gold.db", "selection_pool")
        .read()
        .to_pandas()
    )

    assert set(landed["pipeline_run_id"]) == {run["pipeline_run_id"]}
    assert set(landed["logical_run_id"]) == {"cases/selection:2026-05-29"}
    assert set(landed["load_date"]) == {"2026-05-29"}


def test_runner_redrives_a_business_run_under_an_explicit_logical_run_id(tmp_path):
    # Re-driving a business run: two distinct executions sharing one
    # logical_run_id must replace the same rows (idempotent), each traceable by
    # its own pipeline_run_id.
    runner = PipelineRunner()

    def handler(context):
        gold = medallion(StoreRegistry(context.base_dir), context.subject).gold
        source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))
        p = Pipeline(context.label)
        r = p.read(DatasetReader(source), name="read")
        writer = gold.writer("selection_pool", AccumulateByRun.from_context(context))
        p.write(writer, r, name="write")
        return p.run(context=context)

    runner.register("cases", "selection", handler)

    runner.run("cases", "selection", tmp_path, logical_run_id="REDRIVE-7")
    runner.run("cases", "selection", tmp_path, logical_run_id="REDRIVE-7")

    landed = (
        SqliteReader(tmp_path / "cases" / "gold.db", "selection_pool")
        .read()
        .to_pandas()
    )
    # Replaced, not duplicated: still two rows, all under the one logical run id.
    assert len(landed) == 2
    assert set(landed["logical_run_id"]) == {"REDRIVE-7"}
    # Each execution stays individually traceable.
    assert len(set(landed["pipeline_run_id"])) == 1  # the latest execution's rows


def test_runner_defaults_run_log_to_runs_dir_under_base_dir(tmp_path):
    runner = PipelineRunner()
    runner.register("cases", "ingest", lambda context: None)

    runner.run("cases", "ingest", tmp_path, run_date=dt.date(2026, 5, 29))

    # With no run_log supplied, the run records under <base_dir>/_runs/<subject>.log.
    assert (tmp_path / "_runs" / "cases.log").exists()


def test_runner_records_to_a_run_log_supplied_at_register(tmp_path):
    custom_log = tmp_path / "elsewhere" / "ingest.log"
    runner = PipelineRunner()
    runner.register("cases", "ingest", lambda context: None, run_log=RunLog(custom_log))

    runner.run("cases", "ingest", tmp_path, run_date=dt.date(2026, 5, 29))

    # The supplied sink is used instead of the default <base_dir>/_runs/ location.
    assert custom_log.exists()
    assert not (tmp_path / "_runs" / "cases.log").exists()
    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    (run,) = registry.query_runs(pipeline="cases/ingest")
    assert run["status"] == "ok"


def test_runner_unknown_pipeline_raises_clear_error(tmp_path):
    runner = PipelineRunner()

    with pytest.raises(UnknownPipelineError, match="unknown pipeline 'missing'"):
        runner.run("cases", "missing", tmp_path)


def test_runner_stale_guard_prevents_handler_and_records_error_run(tmp_path):
    _record_run(
        tmp_path / "_runs" / "cases.log",
        pipeline="cases/ingest",
        timestamp="2026-05-27T00:00:00+00:00",
    )
    runner = PipelineRunner()
    called = False

    def handler(context):
        nonlocal called
        called = True

    runner.register(
        "cases",
        "selection",
        handler,
        freshness=(FreshnessRequirement("ingest"),),
    )

    with pytest.raises(FreshnessError):
        runner.run("cases", "selection", tmp_path, run_date=dt.date(2026, 5, 29))

    assert called is False
    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    records = registry.query_runs(pipeline="cases/selection", status="error")
    assert len(records) == 1
    freshness = [
        r
        for r in registry.records_for_run(records[0]["pipeline_run_id"])
        if r["step"] == "freshness"
    ]
    assert freshness[0]["status"] == "error"
