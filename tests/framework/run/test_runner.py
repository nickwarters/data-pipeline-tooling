import datetime as dt
import json
from pathlib import Path

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.readers import DatasetReader, SqliteReader
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun
from framework.run.builder import Pipeline
from framework.run.run_log import RunLog
from framework.run.run_registry import RunRegistry
from framework.run.runner import (
    FreshnessError,
    FreshnessGuard,
    FreshnessRequirement,
    PipelineRunner,
    RunContext,
    UnknownPipelineError,
)


def _record_run(
    log_path: Path,
    *,
    pipeline: str,
    status: str = "ok",
    timestamp: str = "2026-05-29T00:00:00+00:00",
    run_id: str = "upstream",
) -> None:
    record = {
        "timestamp": timestamp,
        "run_id": run_id,
        "pipeline": pipeline,
        "step": "run",
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
        case_type="cases",
        pipeline="selection",
        run_date=run_date,
        run_id="selection-run",
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


def test_runner_registers_and_runs_handler_by_case_type_and_pipeline(tmp_path):
    runner = PipelineRunner()
    seen = []

    def handler(context):
        seen.append((context.case_type, context.pipeline, context.label))
        return Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))

    runner.register("cases", "ingest", handler)

    result = runner.run("cases", "ingest", tmp_path, run_date=dt.date(2026, 5, 29))

    assert isinstance(result, Dataset)
    assert len(result) == 2
    assert seen == [("cases", "ingest", "cases/ingest")]
    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    (run,) = registry.query_runs(pipeline="cases/ingest")
    assert run["status"] == "ok"


def test_runner_context_correlates_logs_registry_and_accumulated_rows(tmp_path):
    runner = PipelineRunner()

    def handler(context):
        store = Store(context.base_dir / context.case_type)
        source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))
        return (
            Pipeline(context.label, DatasetReader(source))
            .write_to(
                store.writer(
                    "gold",
                    "selection_pool",
                    AccumulateByRun.from_context(context),
                )
            )
            .run(context=context)
        )

    runner.register("cases", "selection", handler)

    runner.run("cases", "selection", tmp_path, run_date=dt.date(2026, 5, 29))

    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    (run,) = registry.query_runs(pipeline="cases/selection")
    landed = (
        SqliteReader(tmp_path / "cases" / "gold.db", "selection_pool")
        .read()
        .to_pandas()
    )

    assert set(landed["execution_id"]) == {run["run_id"]}
    assert set(landed["run_id"]) == {"cases/selection:2026-05-29"}
    assert set(landed["logical_run_id"]) == {"cases/selection:2026-05-29"}
    assert set(landed["load_date"]) == {"2026-05-29"}


def test_runner_redrives_a_business_run_under_an_explicit_logical_run_id(tmp_path):
    # Re-driving a business run: two distinct executions sharing one
    # logical_run_id must replace the same rows (idempotent), each traceable by
    # its own execution_id.
    runner = PipelineRunner()

    def handler(context):
        store = Store(context.base_dir / context.case_type)
        source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))
        return (
            Pipeline(context.label, DatasetReader(source))
            .write_to(
                store.writer(
                    "gold", "selection_pool", AccumulateByRun.from_context(context)
                )
            )
            .run(context=context)
        )

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
    assert set(landed["run_id"]) == {"REDRIVE-7"}
    assert set(landed["logical_run_id"]) == {"REDRIVE-7"}
    # Each execution stays individually traceable.
    assert len(set(landed["execution_id"])) == 1  # the latest execution's rows


def test_second_run_under_same_logical_run_id_records_replaced_in_log(tmp_path):
    # Running a pipeline twice under the same logical_run_id must report
    # replaced=True in the run-level log record for the second execution so an
    # operator can distinguish a fresh load from an idempotent re-run.
    runner = PipelineRunner()

    def handler(context):
        store = Store(context.base_dir / context.case_type)
        source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))
        return (
            Pipeline(context.label, DatasetReader(source))
            .write_to(
                store.writer(
                    "gold", "pool", AccumulateByRun.from_context(context)
                )
            )
            .run(context=context)
        )

    runner.register("cases", "ingest", handler)

    runner.run("cases", "ingest", tmp_path, logical_run_id="LR-1")
    runner.run("cases", "ingest", tmp_path, logical_run_id="LR-1")

    log_path = tmp_path / "_runs" / "cases.log"
    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    run_records = [r for r in records if r.get("step") == "run"]
    assert len(run_records) == 2
    # First run: not replaced; second run: replaced.
    assert run_records[0].get("replaced") is False
    assert run_records[1].get("replaced") is True


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
        for r in registry.records_for_run(records[0]["run_id"])
        if r["step"] == "freshness"
    ]
    assert freshness[0]["status"] == "error"
