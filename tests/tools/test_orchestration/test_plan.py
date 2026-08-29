"""Tests for Orchestrator.plan() and plan_for_each()."""

import datetime as dt
import json
from pathlib import Path

from framework.run import FreshnessRequirement, Requirement, RunAddress
from tools.calendar import WorkingDayCalendar
from tools.observability import timestamps
from tools.orchestration import (
    DayOfMonth,
    ManualOnly,
    Orchestrator,
    PipelineSet,
    PlanResult,
    ScheduledPipeline,
    Weekdays,
    plan_for_each,
)

_DUE_DATE = dt.date(2026, 6, 15)
_STALE_DATE = "2026-06-01T00:00:00+00:00"
_SAME_DAY_DATE = "2026-06-15T00:00:00+00:00"


class _RecordingInvoker:
    """Record path-addressed invocations."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def run(
        self, path, base_dir, *, run_date, logical_run_id, freshness_days, freshness
    ):
        self.calls.append(path)


def _orchestrator(*pipeline_sets) -> tuple[Orchestrator, list[str]]:
    invoker = _RecordingInvoker()
    orchestrator = Orchestrator(pipeline_sets, WorkingDayCalendar(), invoker=invoker)
    return orchestrator, invoker.calls


def _record_run(
    log_path: Path,
    *,
    pipeline: str,
    step: str = "run",
    status: str = "ok",
    timestamp: str = _SAME_DAY_DATE,
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


def test_plan_returns_ready_for_due_item_without_calling_handler(tmp_path):
    orchestrator, calls = _orchestrator(
        PipelineSet("claims", (ScheduledPipeline("pipelines/ingest", Weekdays()),))
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == [], "plan() must not invoke any pipeline handler"
    assert len(result.items) == 1
    item = result.items[0]
    assert item.status == "ready"
    assert "daily" in item.reason
    assert "is due" in item.reason


def test_plan_returns_skipped_for_not_due_item(tmp_path):
    orchestrator, calls = _orchestrator(
        PipelineSet(
            "claims",
            (ScheduledPipeline("pipelines/ingest", ManualOnly()),),
        ),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == []
    assert result.items[0].status == "skipped"
    assert "manual only" in result.items[0].reason
    assert "is not due on" in result.items[0].reason


def test_plan_not_due_reason_names_the_schedule_that_was_not_due(tmp_path):
    """A monthly schedule must not explain itself in weekday language.

    Each schedule explains why *it* was not due; a day-of-month schedule must
    not send an operator looking for a weekday rule that does not exist.
    """
    orchestrator, _ = _orchestrator(
        PipelineSet(
            "claims",
            (ScheduledPipeline("pipelines/monthly_snapshot", DayOfMonth(21)),),
        ),
    )

    # _DUE_DATE is Monday the 15th, so a day-21 schedule is not due.
    item = orchestrator.plan(tmp_path, run_date=_DUE_DATE).items[0]

    assert item.status == "skipped"
    assert "day 21 of month" in item.reason
    assert "monday" not in item.reason.lower(), (
        f"a monthly schedule explained itself as a weekday: {item.reason!r}"
    )


def test_plan_returns_disabled_for_disabled_item(tmp_path):
    orchestrator, calls = _orchestrator(
        PipelineSet(
            "claims",
            (ScheduledPipeline("pipelines/ingest", Weekdays(), enabled=False),),
        ),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == []
    assert result.items[0].status == "disabled"


def test_plan_returns_blocked_when_freshness_requirement_is_stale(tmp_path):
    """A stale upstream is blocked without invoking the pipeline."""
    log_path = tmp_path / "_runs" / "ingest.log"
    _record_run(
        log_path,
        pipeline="ingest",
        step="run",
        status="ok",
        timestamp=_STALE_DATE,
    )

    orchestrator, calls = _orchestrator(
        PipelineSet(
            "claims",
            (
                ScheduledPipeline(
                    "pipelines/reporting",
                    Weekdays(),
                    depends_on=(
                        Requirement.succeeded(
                            RunAddress.for_pipeline("ingest")
                        ).within_days(1),
                    ),
                ),
            ),
        ),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == [], "plan() must not call any handler even when blocked"
    item = result.items[0]
    assert item.status == "blocked"
    assert "stale" in item.reason
    assert "ingest" in item.reason


def test_plan_returns_already_satisfied_when_run_succeeded_today(tmp_path):
    """Write a same-day success; plan() must report already-satisfied."""
    log_path = tmp_path / "_runs" / "ingest.log"
    _record_run(
        log_path,
        pipeline="ingest",
        step="run",
        status="ok",
        timestamp=_SAME_DAY_DATE,
    )

    orchestrator, calls = _orchestrator(
        PipelineSet("claims", (ScheduledPipeline("pipelines/ingest", Weekdays()),))
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)

    assert calls == []
    item = result.items[0]
    assert item.status == "already-satisfied"
    assert _DUE_DATE.isoformat() in item.reason


def test_plan_for_each_reports_multiple_planned_runs_without_executing(tmp_path):
    source_files = [
        tmp_path / "file_a.csv",
        tmp_path / "file_b.csv",
        tmp_path / "file_c.csv",
    ]

    items = plan_for_each(
        source_files,
        pipeline="ingest",
        set_name="claims",
        run_date=_DUE_DATE,
    )

    assert len(items) == 3
    for item, source_file in zip(items, source_files):
        assert item.status == "ready"
        assert str(source_file) in item.reason
        assert item.pipeline == "ingest"
        assert item.run_date == _DUE_DATE


def test_plan_for_each_uses_file_id_fn(tmp_path):
    source_files = ["share/claims_20260615_a.csv", "share/claims_20260615_b.csv"]

    items = plan_for_each(
        source_files,
        pipeline="ingest",
        set_name="claims",
        run_date=_DUE_DATE,
        file_id_fn=lambda f: Path(f).name,
    )

    assert items[0].reason == "source file: claims_20260615_a.csv"
    assert items[1].reason == "source file: claims_20260615_b.csv"


def test_plan_result_str_formats_table(tmp_path):
    orchestrator, _ = _orchestrator(
        PipelineSet(
            "claims",
            (
                ScheduledPipeline("pipelines/ingest", Weekdays()),
                ScheduledPipeline("pipelines/quality_check", ManualOnly()),
            ),
        ),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE)
    output = str(result)

    assert "ingest" in output
    assert "quality_check" in output
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


def test_plan_rows_are_ordered_by_deadline_pressure(tmp_path):
    orchestrator, _ = _orchestrator(
        PipelineSet(
            "claims",
            (
                ScheduledPipeline("pipelines/afternoon", Weekdays(), due_time="16:00"),
                ScheduledPipeline("pipelines/overdue", Weekdays(), due_time="08:00"),
                ScheduledPipeline("pipelines/no_deadline", Weekdays()),
            ),
        ),
    )

    result = orchestrator.plan(tmp_path, run_date=_DUE_DATE, now=dt.time(9, 0))

    assert [item.pipeline for item in result.items] == [
        "overdue",
        "afternoon",
        "no_deadline",
    ]


def test_plan_names_the_deadline_and_whether_it_has_passed(tmp_path):
    orchestrator, _ = _orchestrator(
        PipelineSet(
            "claims",
            (ScheduledPipeline("pipelines/ingest", Weekdays(), due_time="08:00"),),
        ),
    )

    item = orchestrator.plan(tmp_path, run_date=_DUE_DATE, now=dt.time(9, 0)).items[0]

    assert item.status == "ready"
    assert "overdue since 08:00" in item.reason


def test_plan_names_where_an_inherited_deadline_came_from(tmp_path):
    orchestrator, _ = _orchestrator(
        PipelineSet(
            "claims",
            (
                ScheduledPipeline("pipelines/ingest", Weekdays()),
                ScheduledPipeline(
                    "pipelines/reporting",
                    Weekdays(),
                    depends_on=(FreshnessRequirement("ingest"),),
                    due_time="09:00",
                ),
            ),
        ),
    )

    items = {
        item.pipeline: item
        for item in orchestrator.plan(
            tmp_path, run_date=_DUE_DATE, now=dt.time(7, 0)
        ).items
    }

    assert "due by 09:00 (inherited from reporting)" in items["ingest"].reason
    assert "inherited" not in items["reporting"].reason


def test_plan_reports_a_gated_item_as_skipped_naming_the_window(tmp_path):
    orchestrator, calls = _orchestrator(
        PipelineSet(
            "claims",
            (ScheduledPipeline("pipelines/nightly", Weekdays(), earliest_run="23:00"),),
        ),
    )

    item = orchestrator.plan(tmp_path, run_date=_DUE_DATE, now=dt.time(9, 0)).items[0]

    assert calls == []
    assert item.status == "skipped"
    assert item.reason == "before earliest_run 23:00"


#
# A 23:10 UTC success is 00:10 on the next local calendar date at UTC+1; the
# preview must apply the same conversion as the runner.

_BST = dt.timezone(dt.timedelta(hours=1))
_JUST_AFTER_LOCAL_MIDNIGHT = "2026-06-14T23:10:00+00:00"


def test_plan_is_not_blocked_by_an_upstream_that_landed_after_local_midnight(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(timestamps, "local_timezone", lambda: _BST)
    log_path = tmp_path / "_runs" / "ingest.log"
    _record_run(
        log_path,
        pipeline="ingest",
        step="run",
        status="ok",
        timestamp=_JUST_AFTER_LOCAL_MIDNIGHT,
    )

    orchestrator, _ = _orchestrator(
        PipelineSet(
            "claims",
            (
                ScheduledPipeline(
                    "pipelines/reporting",
                    Weekdays(),
                    depends_on=(
                        Requirement.succeeded(
                            RunAddress.for_pipeline("ingest")
                        ).same_day(),
                    ),
                ),
            ),
        ),
    )

    item = orchestrator.plan(tmp_path, run_date=_DUE_DATE).items[0]

    assert item.status == "ready", item.reason
