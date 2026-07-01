```python
"""Tests for Orchestrator.plan() and plan_for_each() (issue #245)."""

import datetime as dt
import json
from pathlib import Path

import pandas as pd

from framework.core.dataset import Dataset
from framework.run import PipelineRunner, Requirement, RunAddress
from tools.calendar import WorkingDayCalendar
from tools.orchestration import (
    ManualOnly,
    Orchestrator,
    PipelineSet,
    PlanResult,
    ScheduledPipeline,
    Weekdays,
    plan_for_each,
)

# ── Monday 2026-06-15 is a working day (used as a stable "due" date) ──────────
_DUE_DATE = dt.date(2026, 6, 15)  # Monday
_STALE_DATE = "2026-06-01T00:00:00+00:00"  # well before _DUE_DATE
_SAME_DAY_DATE = "2026-06-15T00:00:00+00:00"


def _simple_runner() -> tuple[PipelineRunner, list[str]]:
    """Return a runner that records calls and a shared call log."""
    calls: list[str] = []
    runner = PipelineRunner()

    def handler(context):
        calls.append(context.label)
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    runner.register("claims", "ingest", handler)
    runner.register("claims", "quality_check", handler)
    runner.register("claims", "reporting", handler)
    return runner, calls


def _record_run(
    log_path: Path,
    *,
    pipeline: str,
    step: str = "run",
    status: str = "ok",
    timestamp: str = _SAME_DAY_DATE,
    pipeline_run_id: str = "upstream",
) -> None:
    """Write a synthetic run record to a JSONL log file."""
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


# ── test_plan_returns_ready_for_due_item_without_calling_handler ───────────────


def test_plan_returns_ready_for_due_item_without_calling_handler(tmp_path):
    runner, calls = _simple_runner()
    orchestrator = Orchestrator(
        runner,
        (PipelineSet("claims", (ScheduledPipeline("claims", "ingest", Weekdays()),)),),
        WorkingDayCalendar(),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == [], "plan() must not invoke any pipeline handler"
    assert len(result.items) == 1
    item = result.items[0]
    assert item.status == "ready"
    assert "daily" in item.reason
    assert "is due" in item.reason


# ── test_plan_returns_skipped_for_not_due_item ────────────────────────────────


def test_plan_returns_skipped_for_not_due_item(tmp_path):
    runner, calls = _simple_runner()
    orchestrator = Orchestrator(
        runner,
        (
            PipelineSet(
                "claims",
                (ScheduledPipeline("claims", "ingest", ManualOnly()),),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == []
    assert result.items[0].status == "skipped"
    assert "manual only" in result.items[0].reason
    assert "is not due on" in result.items[0].reason


# ── test_plan_returns_disabled_for_disabled_item ──────────────────────────────


def test_plan_returns_disabled_for_disabled_item(tmp_path):
    runner, calls = _simple_runner()
    orchestrator = Orchestrator(
        runner,
        (
            PipelineSet(
                "claims",
                (ScheduledPipeline("claims", "ingest", Weekdays(), enabled=False),),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == []
    assert result.items[0].status == "disabled"


# ── test_plan_returns_blocked_when_freshness_requirement_is_stale ─────────────


def test_plan_returns_blocked_when_freshness_requirement_is_stale(tmp_path):
    """Write a stale upstream log; plan() must report blocked without calling handler.

    No pipeline handler should be invoked.
    """
    log_path = tmp_path / "_runs" / "claims.log"
    _record_run(
        log_path,
        pipeline="claims/ingest",
        step="run",
        status="ok",
        timestamp=_STALE_DATE,
    )

    runner, calls = _simple_runner()
    orchestrator = Orchestrator(
        runner,
        (
            PipelineSet(
                "claims",
                (
                    ScheduledPipeline(
                        "claims",
                        "reporting",
                        Weekdays(),
                        depends_on=(
                            Requirement.succeeded(
                                RunAddress.pipeline("ingest", subject="claims")
                            ).within_days(1),
                        ),
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == [], "plan() must not call any handler even when blocked"
    item = result.items[0]
    assert item.status == "blocked"
    assert "stale" in item.reason
    assert "claims/ingest" in item.reason


# ── test_plan_returns_already_satisfied_when_run_succeeded_today ──────────────


def test_plan_returns_already_satisfied_when_run_succeeded_today(tmp_path):
    """Write a same-day success; plan() must report already-satisfied."""
    log_path = tmp_path / "_runs" / "claims.log"
    _record_run(
        log_path,
        pipeline="claims/ingest",
        step="run",
        status="ok",
        timestamp=_SAME_DAY_DATE,
    )

    runner, calls = _simple_runner()
    orchestrator = Orchestrator(
        runner,
        (PipelineSet("claims", (ScheduledPipeline("claims", "ingest", Weekdays()),)),),
        WorkingDayCalendar(),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == []
    item = result.items[0]
    assert item.status == "already-satisfied"
    assert _DUE_DATE.isoformat() in item.reason


# ── test_plan_for_each_reports_multiple_planned_runs_without_executing ────────


def test_plan_for_each_reports_multiple_planned_runs_without_executing(tmp_path):
    source_files = [
        tmp_path / "file_a.csv",
        tmp_path / "file_b.csv",
        tmp_path / "file_c.csv",
    ]

    items = plan_for_each(
        source_files,
        subject="claims",
        pipeline="ingest",
        set_name="claims",
        run_date=_DUE_DATE,
    )

    assert len(items) == 3
    for item, source_file in zip(items, source_files):
        assert item.status == "ready"
        assert str(source_file) in item.reason
        assert item.subject == "claims"
        assert item.pipeline == "ingest"
        assert item.run_date == _DUE_DATE


def test_plan_for_each_uses_file_id_fn(tmp_path):
    source_files = ["share/claims_20260615_a.csv", "share/claims_20260615_b.csv"]

    items = plan_for_each(
        source_files,
        subject="claims",
        pipeline="ingest",
        set_name="claims",
        run_date=_DUE_DATE,
        file_id_fn=lambda f: Path(f).name,
    )

    assert items[0].reason == "source file: claims_20260615_a.csv"
    assert items[1].reason == "source file: claims_20260615_b.csv"


# ── test_plan_result_str_formats_table ────────────────────────────────────────


def test_plan_result_str_formats_table(tmp_path):
    runner, _ = _simple_runner()
    orchestrator = Orchestrator(
        runner,
        (
            PipelineSet(
                "claims",
                (
                    ScheduledPipeline("claims", "ingest", Weekdays()),
                    ScheduledPipeline("claims", "quality_check", ManualOnly()),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)
    output = str(result)

    assert "claims/ingest" in output
    assert "claims/quality_check" in output
    assert "ready" in output
    assert "skipped" in output
    # Lines should be aligned: every line should have the same leading date
    lines = output.splitlines()
    assert len(lines) == 2
    for line in lines:
        assert _DUE_DATE.isoformat() in line


def test_plan_result_str_empty():
    result = PlanResult(run_date=_DUE_DATE, items=())
    output = str(result)
    assert "no scheduled items" in output
    assert _DUE_DATE.isoformat() in output

```
