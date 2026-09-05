```python
"""Test guard/plan parity through one freshness predicate.

UTC instants convert through an injected local timezone, keeping date boundaries
deterministic on Windows.
"""

import datetime as dt
import json

import pytest

from framework.run import Requirement, RunAddress
from framework.run.freshness import evaluate_requirement
from framework.run.run_context import RunContext
from framework.run.runner import FreshnessError, FreshnessGuard, FreshnessRequirement
from tools.calendar import WorkingDayCalendar
from tools.observability import timestamps
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry
from tools.orchestration import Orchestrator, PipelineSet, ScheduledPipeline, Weekdays

DUE_DATE = dt.date(2026, 6, 15)  # a Monday
STALE = "2026-06-01T00:00:00+00:00"


def _record_run(log_path, *, pipeline, timestamp, step="run", status="ok"):
    record = {
        "timestamp": timestamp,
        "pipeline_run_id": "upstream",
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


class _NeverInvoked:
    def run(self, *args, **kwargs):  # pragma: no cover - plan must not call it
        raise AssertionError("plan() must not invoke a pipeline")


def _guard_message(tmp_path, requirement, *, run_date=DUE_DATE) -> str:
    """Return the guard's message for the reporting pipeline."""
    registry = RunStoreRegistry(tmp_path)
    context = RunContext(
        base_dir=tmp_path,
        subject=None,
        pipeline="reporting",
        run_date=run_date,
        pipeline_run_id="reporting-run",
        run_log=RunLog(tmp_path / "guard.log"),
        run_registry=registry,
    )
    with pytest.raises(FreshnessError) as raised:
        FreshnessGuard().check(context, requirement)
    return str(raised.value)


def RunStoreRegistry(tmp_path) -> RunRegistry:
    """A registry caught up from the run logs written under ``tmp_path``."""
    registry = RunRegistry(tmp_path / "_registry" / "runs.db")
    for log in sorted((tmp_path / "_runs").glob("*.log")):
        registry.ingest(log)
    return registry


def _plan_reason(tmp_path, requirement, *, run_date=DUE_DATE) -> str:
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "claims",
                (
                    ScheduledPipeline(
                        "pipelines/reporting", Weekdays(), depends_on=(requirement,)
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_NeverInvoked(),
    )
    item = orchestrator.plan(tmp_path, run_date=run_date).items[0]
    assert item.status == "blocked", item
    return item.reason


# Guard/plan parity


@pytest.mark.parametrize(
    "requirement",
    [
        Requirement.succeeded(RunAddress.for_pipeline("ingest")).within_days(1),
        Requirement.succeeded(RunAddress.for_pipeline("ingest")).same_day(),
        Requirement.succeeded(RunAddress.task("ingest", "normalise")).within_days(2),
        FreshnessRequirement("ingest"),
    ],
)
def test_the_guard_and_the_plan_render_one_condition_identically(tmp_path, requirement):
    _record_run(tmp_path / "_runs" / "ingest.log", pipeline="ingest", timestamp=STALE)
    _record_run(
        tmp_path / "_runs" / "ingest.log",
        pipeline="ingest",
        step="normalise",
        timestamp=STALE,
    )

    assert _plan_reason(tmp_path, requirement) == _guard_message(tmp_path, requirement)


def test_a_blocking_first_run_reads_the_same_both_ways(tmp_path):
    requirement = Requirement.succeeded(RunAddress.for_pipeline("ingest")).on_first_run(
        "block"
    )

    assert _plan_reason(tmp_path, requirement) == _guard_message(tmp_path, requirement)


# Shared predicate


def test_both_callers_go_through_the_shared_predicate(tmp_path, monkeypatch):
    """Substituting the shared predicate changes both callers' decisions."""
    import framework.run.freshness as freshness_module
    import framework.run.runner as runner_module
    import tools.orchestration as orchestration_module

    _record_run(tmp_path / "_runs" / "ingest.log", pipeline="ingest", timestamp=STALE)
    requirement = Requirement.succeeded(RunAddress.for_pipeline("ingest")).within_days(
        1
    )

    def always_blocked(*args, **kwargs):
        return freshness_module.FreshnessVerdict(
            satisfied=False, reason="substituted verdict"
        )

    monkeypatch.setattr(runner_module, "evaluate_requirement", always_blocked)
    monkeypatch.setattr(orchestration_module, "evaluate_requirement", always_blocked)

    assert _plan_reason(tmp_path, requirement) == "substituted verdict"
    assert _guard_message(tmp_path, requirement) == "substituted verdict"


# Local-date semantics

_UTC_PLUS_ONE = dt.timezone(dt.timedelta(hours=1))
# 23:10 UTC the day before DUE_DATE is 00:10 local on DUE_DATE at UTC+1.
_JUST_AFTER_LOCAL_MIDNIGHT = "2026-06-14T23:10:00+00:00"


class _SummerTimeZone(dt.tzinfo):
    """A zone that shifts by an hour at a fixed instant, like a real DST change.

    Written out rather than taken from ``zoneinfo`` because the IANA database is
    not present on every Windows box, and this framework's primary target is
    Windows. Offsets are resolved per instant, which is the property under test.
    """

    _SHIFT = dt.datetime(2026, 3, 29, 1, 0, tzinfo=dt.timezone.utc)

    def utcoffset(self, moment):
        reference = moment.replace(tzinfo=dt.timezone.utc) if moment else self._SHIFT
        return dt.timedelta(hours=1 if reference >= self._SHIFT else 0)

    def dst(self, moment):
        return dt.timedelta(0)

    def tzname(self, moment):
        return "TEST"


class _Latest:
    def __init__(self, timestamp: str | None) -> None:
        self._timestamp = timestamp

    def latest_success(self, address):
        return None if self._timestamp is None else {"timestamp": self._timestamp}


def _verdict(history, requirement, run_date=DUE_DATE):
    return evaluate_requirement(
        requirement, history, run_date=run_date, label="reporting"
    )


def test_the_shared_predicate_reads_the_stored_instant_as_a_local_date(monkeypatch):
    monkeypatch.setattr(timestamps, "local_timezone", lambda: _UTC_PLUS_ONE)
    requirement = Requirement.succeeded(RunAddress.for_pipeline("ingest")).same_day()

    verdict = _verdict(_Latest(_JUST_AFTER_LOCAL_MIDNIGHT), requirement)

    assert verdict.satisfied, verdict.reason


def test_the_shared_predicate_would_disagree_reading_the_instant_as_utc(monkeypatch):
    monkeypatch.setattr(timestamps, "local_timezone", lambda: dt.timezone.utc)
    requirement = Requirement.succeeded(RunAddress.for_pipeline("ingest")).same_day()

    verdict = _verdict(_Latest(_JUST_AFTER_LOCAL_MIDNIGHT), requirement)

    assert not verdict.satisfied
    assert "2026-06-14" in verdict.reason


def test_the_shared_predicate_uses_the_offset_in_force_on_the_day(monkeypatch):
    """Use the offset in force at each instant across a summer-time change."""
    monkeypatch.setattr(timestamps, "local_timezone", _SummerTimeZone)
    same_day = Requirement.succeeded(RunAddress.for_pipeline("ingest")).same_day()

    after_the_change = _verdict(
        _Latest("2026-03-30T23:30:00+00:00"), same_day, run_date=dt.date(2026, 3, 31)
    )
    before_the_change = _verdict(
        _Latest("2026-03-28T23:30:00+00:00"), same_day, run_date=dt.date(2026, 3, 28)
    )

    assert after_the_change.satisfied, after_the_change.reason
    assert before_the_change.satisfied, before_the_change.reason


def test_both_callers_agree_across_the_local_midnight_boundary(tmp_path, monkeypatch):
    monkeypatch.setattr(timestamps, "local_timezone", lambda: _UTC_PLUS_ONE)
    _record_run(
        tmp_path / "_runs" / "ingest.log",
        pipeline="ingest",
        timestamp=_JUST_AFTER_LOCAL_MIDNIGHT,
    )
    requirement = Requirement.succeeded(RunAddress.for_pipeline("ingest")).same_day()

    # The plan reports ready…
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "claims",
                (
                    ScheduledPipeline(
                        "pipelines/reporting", Weekdays(), depends_on=(requirement,)
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_NeverInvoked(),
    )
    item = orchestrator.plan(tmp_path, run_date=DUE_DATE).items[0]
    assert item.status == "ready", item.reason

    # …and the guard lets the run through, rather than raising.
    context = RunContext(
        base_dir=tmp_path,
        subject=None,
        pipeline="reporting",
        run_date=DUE_DATE,
        pipeline_run_id="reporting-run",
        run_log=RunLog(tmp_path / "guard.log"),
        run_registry=RunStoreRegistry(tmp_path),
    )
    FreshnessGuard().check(context, requirement)


# First-run logging


def test_first_run_warn_still_lands_on_the_run_log_as_a_warning(tmp_path):
    log_path = tmp_path / "guard.log"
    context = RunContext(
        base_dir=tmp_path,
        subject=None,
        pipeline="reporting",
        run_date=DUE_DATE,
        pipeline_run_id="reporting-run",
        run_log=RunLog(log_path),
        run_registry=RunStoreRegistry(tmp_path),
    )

    FreshnessGuard().check(context, FreshnessRequirement("ingest"))

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert records[-1]["status"] == "ok"
    assert "allowing first run" in records[-1]["warn_hits"][0]


def test_first_run_allow_is_silent_on_the_run_log(tmp_path):
    log_path = tmp_path / "guard.log"
    context = RunContext(
        base_dir=tmp_path,
        subject=None,
        pipeline="reporting",
        run_date=DUE_DATE,
        pipeline_run_id="reporting-run",
        run_log=RunLog(log_path),
        run_registry=RunStoreRegistry(tmp_path),
    )

    FreshnessGuard().check(
        context,
        Requirement.succeeded(RunAddress.for_pipeline("ingest")).on_first_run("allow"),
    )

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert records[-1]["status"] == "ok"
    assert records[-1]["warn_hits"] == []

```
