```python
"""Orchestration primitives that sit outside the Pipeline builder."""

from __future__ import annotations

import datetime as dt
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Generic, TypeVar

from framework._internal.connection import connect
from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from framework.run.builder import Pipeline
from framework.run.run_context import RunContext
from framework.run.runner import (
    FreshnessError,
    FreshnessRequirement,
    PipelineRunner,
    Requirement,
    RunRequirement,
)
from tools.calendar import WorkingDayCalendar

_WEEKDAY_NAMES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]

_ORDINAL_SUFFIXES = {1: "st", 2: "nd", 3: "rd"}

Item = TypeVar("Item")


BuildPipeline = Callable[[Item, RunContext], Pipeline]
LogicalRunId = Callable[[Item, int, RunContext], str]


class ForEachPipelineError(PipelineError):
    """Raised when one item in a for-each orchestration fails."""

    category = ErrorCategory.OPERATIONAL


@dataclass(frozen=True)
class ForEachOutcome(Generic[Item]):
    """The per-item result of a best-effort for-each run."""

    item: Item
    index: int
    logical_run_id: str
    succeeded: bool
    dataset: Dataset | None = None
    exception: Exception | None = None

    @property
    def status(self) -> str:
        return "success" if self.succeeded else "failure"


class ForEach(Generic[Item]):
    """Run one freshly built Pipeline per item."""

    def __init__(
        self,
        items: Iterable[Item],
        pipeline_builder: BuildPipeline[Item],
        *,
        logical_run_id: LogicalRunId[Item] | None = None,
        continue_on_error: bool = False,
    ) -> None:
        self._items = items
        self._pipeline_builder = pipeline_builder
        self._logical_run_id = logical_run_id
        self._continue_on_error = continue_on_error

    def run(
        self, context: RunContext | None = None
    ) -> list[Dataset] | list[ForEachOutcome[Item]]:
        """Run the recipe once per item using per-item child contexts."""
        parent_context = context or RunContext()
        results: list[Dataset] = []
        outcomes: list[ForEachOutcome[Item]] = []
        for index, item in enumerate(self._items):
            item_context = _item_context(
                item, index, parent_context, self._logical_run_id
            )
            try:
                pipeline = self._pipeline_builder(item, item_context)
                dataset = pipeline.run(context=item_context)
            except Exception as exc:
                if self._continue_on_error:
                    outcomes.append(
                        ForEachOutcome(
                            item=item,
                            index=index,
                            logical_run_id=item_context.logical_run_id,
                            succeeded=False,
                            exception=exc,
                        )
                    )
                    continue
                raise ForEachPipelineError(f"for-each item failed: {item!r}") from exc
            if self._continue_on_error:
                outcomes.append(
                    ForEachOutcome(
                        item=item,
                        index=index,
                        logical_run_id=item_context.logical_run_id,
                        succeeded=True,
                        dataset=dataset,
                    )
                )
            else:
                results.append(dataset)
        if self._continue_on_error:
            return outcomes
        return results


class Schedule:
    """Base class for automatic schedule predicates.

    The concrete subclasses below (:class:`Weekdays`, :class:`SpecificWeekdays`,
    …) are the implementation vocabulary. Pipeline authors are encouraged to use
    the friendly constructors on this base class instead — ``Schedule.daily()``,
    ``Schedule.on_weekdays("monday", "wednesday")``, ``Schedule.day_of_month(21)``,
    and so on — so they need not remember class names or weekday integer ordinals.
    """

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        raise NotImplementedError

    def schedule_label(self) -> str:
        raise NotImplementedError

    # -- Friendly constructors -------------------------------------------------
    # Common operator language over the concrete schedule classes. These read
    # at call time, so referencing the subclasses defined later in this module
    # is fine.

    @classmethod
    def daily(cls) -> "Schedule":
        """Run on every working day (weekends and holidays skipped)."""
        return Weekdays()

    @classmethod
    def on_weekdays(cls, *names: str) -> "Schedule":
        """Run on the named weekdays, e.g. ``on_weekdays("monday", "wednesday")``.

        Names are matched case-insensitively against the full English weekday
        names (``"monday"`` … ``"sunday"``). At least one name is required, and
        an unrecognised name fails with a clear message.
        """
        if not names:
            raise ValueError("on_weekdays requires at least one weekday name")
        ordinals: list[int] = []
        for name in names:
            ordinal = _weekday_ordinal(name)
            ordinals.append(ordinal)
        return SpecificWeekdays(ordinals)

    @classmethod
    def day_of_month(cls, day: int) -> "Schedule":
        """Run on the given calendar day of the month when it is a working day."""
        return DayOfMonth(day)

    @classmethod
    def nth_working_day_of_month(cls, n: int) -> "Schedule":
        """Run on the ``n``-th working day of the month (``n`` is 1-based)."""
        return NthWorkingDayOfMonth(n)

    @classmethod
    def last_working_day_of_month(cls) -> "Schedule":
        """Run on the last working day of the month."""
        return LastWorkingDayOfMonth()

    @classmethod
    def manual_only(cls) -> "Schedule":
        """Never run in automatic due-work passes; only on explicit invocation."""
        return ManualOnly()


def _weekday_ordinal(name: str) -> int:
    """Map a weekday name to its ordinal (Monday=0 … Sunday=6), case-insensitive."""
    try:
        key = name.strip().lower()
    except AttributeError:
        raise ValueError(f"weekday name must be a string, got {name!r}") from None
    try:
        return _WEEKDAY_NAMES.index(key)
    except ValueError:
        valid = ", ".join(_WEEKDAY_NAMES)
        raise ValueError(
            f"unknown weekday name {name!r}; expected one of: {valid}"
        ) from None


@dataclass(frozen=True)
class Weekdays(Schedule):
    """Run on working days according to the supplied calendar."""

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        return calendar.is_working_day(run_date)

    def schedule_label(self) -> str:
        return "daily"


@dataclass(frozen=True)
class SpecificWeekdays(Schedule):
    """Run on specific weekday ordinals, Monday=0 through Sunday=6."""

    weekdays: frozenset[int]

    def __init__(self, weekdays: Iterable[int]) -> None:
        object.__setattr__(self, "weekdays", frozenset(weekdays))
        invalid = [day for day in self.weekdays if day < 0 or day > 6]
        if invalid:
            raise ValueError(f"weekday ordinals must be 0..6, got {invalid!r}")

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        return run_date.weekday() in self.weekdays and calendar.is_working_day(run_date)

    def schedule_label(self) -> str:
        names = sorted(_WEEKDAY_NAMES[day] for day in self.weekdays)
        return ",".join(names)


@dataclass(frozen=True)
class DayOfMonth(Schedule):
    """Run on the Nth calendar day when that day is a working day."""

    day: int

    def __post_init__(self) -> None:
        if self.day < 1 or self.day > 31:
            raise ValueError(f"day of month must be 1..31, got {self.day!r}")

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        return run_date.day == self.day and calendar.is_working_day(run_date)

    def schedule_label(self) -> str:
        return f"day {self.day} of month"


@dataclass(frozen=True)
class NthWorkingDayOfMonth(Schedule):
    """Run on the Nth working day of the month."""

    n: int

    def __post_init__(self) -> None:
        if self.n < 1:
            raise ValueError(f"working-day ordinal must be positive, got {self.n!r}")

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        if not calendar.is_working_day(run_date):
            return False
        day = run_date.replace(day=1)
        count = 0
        while day <= run_date:
            if calendar.is_working_day(day):
                count += 1
            day += dt.timedelta(days=1)
        return count == self.n

    def schedule_label(self) -> str:
        suffix = _ORDINAL_SUFFIXES.get(self.n, "th")
        return f"{self.n}{suffix} working day of month"


@dataclass(frozen=True)
class LastWorkingDayOfMonth(Schedule):
    """Run on the last working day of the month."""

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        if not calendar.is_working_day(run_date):
            return False
        day = run_date + dt.timedelta(days=1)
        while day.month == run_date.month:
            if calendar.is_working_day(day):
                return False
            day += dt.timedelta(days=1)
        return True

    def schedule_label(self) -> str:
        return "last working day of month"


@dataclass(frozen=True)
class ManualOnly(Schedule):
    """Never run in automatic due-work passes."""

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        return False

    def schedule_label(self) -> str:
        return "manual only"


@dataclass(frozen=True)
class ScheduledPipeline:
    """A scheduled reference to a registered domain Pipeline."""

    subject: str
    pipeline: str
    schedule: Schedule
    depends_on: tuple[RunRequirement, ...] = ()
    enabled: bool = True

    def __init__(
        self,
        subject: str,
        pipeline: str,
        schedule: Schedule,
        depends_on: Iterable[RunRequirement] = (),
        enabled: bool = True,
    ) -> None:
        object.__setattr__(self, "subject", subject)
        object.__setattr__(self, "pipeline", pipeline)
        object.__setattr__(self, "schedule", schedule)
        object.__setattr__(self, "depends_on", tuple(depends_on))
        object.__setattr__(self, "enabled", enabled)


@dataclass(frozen=True)
class PipelineSet:
    """Independent orchestration boundary, usually one Case Type."""

    name: str
    pipelines: tuple[ScheduledPipeline, ...]

    def __init__(self, name: str, pipelines: Iterable[ScheduledPipeline]) -> None:
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "pipelines", tuple(pipelines))


@dataclass(frozen=True)
class OrchestrationDecision:
    """One scheduled-item decision made by an orchestrator invocation."""

    orchestration_run_id: str
    item_key: str
    set_name: str
    subject: str
    pipeline: str
    run_date: dt.date
    status: str
    reason: str = ""
    duration: float | None = None


@dataclass(frozen=True)
class OrchestrationPassResult:
    """The result of one due-work pass."""

    orchestration_run_id: str
    decisions: tuple[OrchestrationDecision, ...]

    @property
    def ran_count(self) -> int:
        return sum(1 for decision in self.decisions if decision.status == "succeeded")


@dataclass(frozen=True)
class PlanItem:
    """One pipeline's projected status in an orchestration plan preview."""

    run_date: dt.date
    set_name: str
    subject: str
    pipeline: str
    status: str  # "ready" | "skipped" | "already-satisfied" | "blocked" | "disabled"
    reason: str


@dataclass(frozen=True)
class PlanResult:
    """The full projected plan for one run date."""

    run_date: dt.date
    items: tuple[PlanItem, ...]

    def __str__(self) -> str:
        if not self.items:
            return f"{self.run_date.isoformat()}  (no scheduled items)"
        rows = [
            (
                item.run_date.isoformat(),
                item.set_name,
                f"{item.subject}/{item.pipeline}",
                item.status,
                item.reason,
            )
            for item in self.items
        ]
        col_widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
        lines = []
        for row in rows:
            parts = [cell.ljust(col_widths[i]) for i, cell in enumerate(row[:-1])]
            parts.append(row[-1])
            lines.append("  ".join(parts))
        return "\n".join(lines)


class OrchestrationStore:
    """SQLite decision log for scheduled work, separate from RunRegistry."""

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = Path(db_path)

    def _connect(self):
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path)
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS orchestration_records (
                timestamp TEXT NOT NULL,
                orchestration_run_id TEXT NOT NULL,
                item_key TEXT NOT NULL,
                set_name TEXT NOT NULL,
                subject TEXT NOT NULL,
                pipeline TEXT NOT NULL,
                run_date TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT,
                duration REAL
            )
            """
        )
        return con

    def record(self, decision: OrchestrationDecision) -> None:
        con = self._connect()
        try:
            con.execute(
                """
                INSERT INTO orchestration_records (
                    timestamp, orchestration_run_id, item_key, set_name, subject,
                    pipeline, run_date, status, reason, duration
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    dt.datetime.now(dt.UTC).isoformat(),
                    decision.orchestration_run_id,
                    decision.item_key,
                    decision.set_name,
                    decision.subject,
                    decision.pipeline,
                    decision.run_date.isoformat(),
                    decision.status,
                    decision.reason,
                    decision.duration,
                ),
            )
            con.commit()
        finally:
            con.close()

    def records(self) -> list[dict]:
        con = self._connect()
        try:
            cur = con.execute(
                """
                SELECT timestamp, orchestration_run_id, item_key, set_name, subject,
                       pipeline, run_date, status, reason, duration
                FROM orchestration_records
                ORDER BY timestamp, rowid
                """
            )
            cols = [desc[0] for desc in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            con.close()


class Orchestrator:
    """Run due registered Pipelines through PipelineRunner."""

    def __init__(
        self,
        runner: PipelineRunner,
        sets: Iterable[PipelineSet],
        calendar: WorkingDayCalendar,
        overrides: dict | None = None,
    ) -> None:
        self._runner = runner
        self._sets = tuple(sets)
        self._calendar = calendar
        self._overrides = overrides or {}
        self._validate_overrides()

    @classmethod
    def from_yaml(
        cls,
        runner: PipelineRunner,
        sets: Iterable[PipelineSet],
        calendar: WorkingDayCalendar,
        path: str | Path,
    ) -> "Orchestrator":
        import yaml

        loaded = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        if not isinstance(loaded, dict):
            raise ValueError("orchestration overrides YAML must contain a mapping")
        return cls(runner, sets, calendar, overrides=loaded)

    def run_due_once(
        self,
        base_dir: str | Path,
        *,
        run_date: dt.date | None = None,
        orchestration_run_id: str | None = None,
    ) -> OrchestrationPassResult:
        root = Path(base_dir)
        day = run_date or dt.date.today()
        run_id = orchestration_run_id or uuid.uuid4().hex
        store = OrchestrationStore(root / "_orchestration" / "runs.db")
        decisions: list[OrchestrationDecision] = []
        terminal: dict[tuple[str, str], str] = {}

        for pipeline_set in self._sets:
            set_failed: set[tuple[str, str]] = set()
            for scheduled in pipeline_set.pipelines:
                item = self._apply_override(pipeline_set.name, scheduled)
                decision = self._decide_item(
                    root, day, run_id, pipeline_set.name, item, terminal, set_failed
                )
                decisions.append(decision)
                store.record(decision)
                if decision.status == "failed":
                    terminal[(item.subject, item.pipeline)] = "failed"
                    set_failed.add((item.subject, item.pipeline))
                elif decision.status in {"succeeded", "blocked"}:
                    terminal[(item.subject, item.pipeline)] = decision.status

        return OrchestrationPassResult(run_id, tuple(decisions))

    def run_until_complete(
        self,
        base_dir: str | Path,
        *,
        run_date: dt.date | None = None,
        poll_seconds: float = 5,
        max_idle_polls: int = 3,
    ) -> list[OrchestrationPassResult]:
        day = run_date or dt.date.today()
        run_id = uuid.uuid4().hex
        results: list[OrchestrationPassResult] = []
        idle = 0
        while idle < max_idle_polls:
            result = self.run_due_once(
                base_dir, run_date=day, orchestration_run_id=run_id
            )
            results.append(result)
            if result.ran_count:
                idle = 0
            else:
                idle += 1
            if self._all_due_terminal(result):
                break
            if idle < max_idle_polls:
                time.sleep(poll_seconds)
        return results

    def plan(
        self,
        base_dir: str | Path,
        *,
        run_date: dt.date | None = None,
    ) -> PlanResult:
        """Return a read-only projection of what would run, be skipped, or be blocked.

        No pipeline handler is called and no run log or orchestration store is
        written to. The plan sweeps the existing run registry once (the same
        incremental ingest used by ``run_due_once``) and then evaluates each
        ``ScheduledPipeline`` in order:

        * ``disabled`` — item has ``enabled=False``
        * ``skipped`` — schedule is not due on ``run_date``
        * ``already-satisfied`` — pipeline already succeeded on ``run_date``
        * ``blocked`` — a declared freshness/requirement dependency is not met
        * ``ready`` — all checks pass

        The returned :class:`PlanResult` formats as an aligned table via
        ``str(result)``.
        """
        from tools.observability.run_registry import RunRegistry

        root = Path(base_dir)
        day = run_date or dt.date.today()
        weekday_name = _WEEKDAY_NAMES[day.weekday()]

        # Sweep the registry once before evaluating any item.
        registry_path = root / "_registry" / "runs.db"
        runs_dir = root / "_runs"
        run_registry = RunRegistry(registry_path)
        if runs_dir.exists():
            for log_file in sorted(runs_dir.glob("*.log")):
                run_registry.ingest(log_file)

        items: list[PlanItem] = []
        for pipeline_set in self._sets:
            for scheduled in pipeline_set.pipelines:
                item = self._apply_override(pipeline_set.name, scheduled)
                plan_item = self._plan_item(
                    pipeline_set.name, item, day, weekday_name, run_registry
                )
                items.append(plan_item)

        return PlanResult(run_date=day, items=tuple(items))

    def _plan_item(
        self,
        set_name: str,
        item: ScheduledPipeline,
        run_date: dt.date,
        weekday_name: str,
        run_registry: object,
    ) -> PlanItem:
        from tools.observability.run_registry import RunRegistry

        assert isinstance(run_registry, RunRegistry)

        if not item.enabled:
            return PlanItem(
                run_date=run_date,
                set_name=set_name,
                subject=item.subject,
                pipeline=item.pipeline,
                status="disabled",
                reason="disabled",
            )

        if not item.schedule.is_due(run_date, self._calendar):
            return PlanItem(
                run_date=run_date,
                set_name=set_name,
                subject=item.subject,
                pipeline=item.pipeline,
                status="skipped",
                reason=(
                    f"schedule {item.schedule.schedule_label()}"
                    f" is not due on {weekday_name}"
                ),
            )

        # Check if it already succeeded today.
        from framework.run.address import RunAddress

        address = RunAddress.pipeline(item.pipeline, subject=item.subject)
        if run_registry.latest_success(address, on=run_date) is not None:
            return PlanItem(
                run_date=run_date,
                set_name=set_name,
                subject=item.subject,
                pipeline=item.pipeline,
                status="already-satisfied",
                reason=f"already succeeded on {run_date.isoformat()}",
            )

        # Check freshness requirements without running handlers.
        freshness_days = _freshness_days(item)
        for requirement in item.depends_on:
            blocked, reason = _check_requirement_plan(
                requirement, run_registry, run_date, freshness_days, item.subject
            )
            if blocked:
                return PlanItem(
                    run_date=run_date,
                    set_name=set_name,
                    subject=item.subject,
                    pipeline=item.pipeline,
                    status="blocked",
                    reason=reason,
                )

        return PlanItem(
            run_date=run_date,
            set_name=set_name,
            subject=item.subject,
            pipeline=item.pipeline,
            status="ready",
            reason=f"schedule {item.schedule.schedule_label()} is due",
        )

    def _decide_item(
        self,
        base_dir: Path,
        run_date: dt.date,
        orchestration_run_id: str,
        set_name: str,
        item: ScheduledPipeline,
        terminal: dict[tuple[str, str], str],
        set_failed: set[tuple[str, str]],
    ) -> OrchestrationDecision:
        key = _item_key(set_name, item, run_date)
        if not item.enabled:
            return _decision(
                orchestration_run_id,
                key,
                set_name,
                item,
                run_date,
                "skipped",
                "disabled",
            )
        if not item.schedule.is_due(run_date, self._calendar):
            return _decision(
                orchestration_run_id,
                key,
                set_name,
                item,
                run_date,
                "skipped",
                "not due",
            )
        blocked_by = self._blocked_dependency(item, set_failed)
        if blocked_by is not None:
            return _decision(
                orchestration_run_id,
                key,
                set_name,
                item,
                run_date,
                "blocked",
                f"blocked by failed upstream {blocked_by}",
            )
        existing = terminal.get((item.subject, item.pipeline))
        if existing in {"failed", "blocked", "succeeded"}:
            return _decision(
                orchestration_run_id,
                key,
                set_name,
                item,
                run_date,
                "skipped",
                f"already {existing} in this orchestration run",
            )
        started = time.perf_counter()
        try:
            self._runner.run(
                item.subject,
                item.pipeline,
                base_dir,
                run_date=run_date,
                freshness_days=_freshness_days(item),
                freshness=item.depends_on,
            )
        except FreshnessError as exc:
            return _decision(
                orchestration_run_id,
                key,
                set_name,
                item,
                run_date,
                "blocked",
                str(exc),
                time.perf_counter() - started,
            )
        except Exception as exc:
            return _decision(
                orchestration_run_id,
                key,
                set_name,
                item,
                run_date,
                "failed",
                str(exc),
                time.perf_counter() - started,
            )
        return _decision(
            orchestration_run_id,
            key,
            set_name,
            item,
            run_date,
            "succeeded",
            "",
            time.perf_counter() - started,
        )

    def _blocked_dependency(
        self,
        item: ScheduledPipeline,
        set_failed: set[tuple[str, str]],
    ) -> str | None:
        for dependency in item.depends_on:
            upstream = _dependency_pipeline_key(dependency, item.subject)
            if upstream in set_failed:
                upstream_subject, upstream_pipeline = upstream
                return f"{upstream_subject}/{upstream_pipeline}"
        return None

    def _all_due_terminal(self, result: OrchestrationPassResult) -> bool:
        due = [
            decision
            for decision in result.decisions
            if decision.reason not in {"not due", "disabled"}
        ]
        return bool(due) and all(
            decision.status in {"succeeded", "failed", "blocked", "skipped"}
            for decision in due
        )

    def _validate_overrides(self) -> None:
        if not self._overrides:
            return
        declared = {
            (pipeline_set.name, item.subject, item.pipeline)
            for pipeline_set in self._sets
            for item in pipeline_set.pipelines
        }
        for raw in _override_items(self._overrides):
            key = (raw["set"], raw["subject"], raw["pipeline"])
            if key not in declared:
                raise ValueError(
                    "orchestration override references unknown scheduled pipeline "
                    f"{key[0]}/{key[1]}/{key[2]}"
                )

    def _apply_override(
        self, set_name: str, item: ScheduledPipeline
    ) -> ScheduledPipeline:
        override = _find_override(
            self._overrides, set_name, item.subject, item.pipeline
        )
        if override is None:
            return item
        changed = item
        if "enabled" in override:
            changed = replace(changed, enabled=bool(override["enabled"]))
        if "schedule" in override:
            changed = replace(
                changed, schedule=_schedule_from_config(override["schedule"])
            )
        if "freshness_days" in override:
            changed = replace(
                changed,
                depends_on=tuple(
                    replace(dep, max_age_days=int(override["freshness_days"]))
                    for dep in changed.depends_on
                ),
            )
        return changed


def _check_requirement_plan(
    requirement: RunRequirement,
    run_registry: object,
    run_date: dt.date,
    freshness_days: int,
    default_subject: str,
) -> tuple[bool, str]:
    """Pure freshness check for plan preview — no side-effects.

    Returns ``(blocked, reason)``.  ``blocked=False`` means the requirement is
    satisfied (or has no history and the first-run policy allows it);
    ``blocked=True`` means the downstream should be marked ``blocked``.
    """
    from tools.observability.run_registry import RunRegistry

    assert isinstance(run_registry, RunRegistry)

    # Normalise to a Requirement so we have one code path.
    if isinstance(requirement, FreshnessRequirement):
        req = requirement.as_requirement(default_subject=default_subject)
    elif isinstance(requirement, Requirement):
        req = requirement
    else:
        raise TypeError(f"unsupported requirement type {requirement!r}")

    latest = run_registry.latest_success(req.address)

    if latest is None:
        # No history — consult the first-run policy.
        if req.first_run_policy == "block":
            return (
                True,
                f"no successful run history for upstream {req.address.label};"
                " blocking first run",
            )
        # "warn" or "allow" → not blocked
        return False, ""

    import datetime as _dt

    latest_date = _dt.datetime.fromisoformat(
        latest["timestamp"].replace("Z", "+00:00")
    ).date()

    if req.require_same_day:
        if latest_date == run_date:
            return False, ""
        return (
            True,
            f"upstream {req.address.label} is stale: latest successful run was "
            f"{latest_date.isoformat()}, required on {run_date.isoformat()}",
        )

    effective_max_age = (
        freshness_days
        if req.max_age_days is None
        else max(req.max_age_days, freshness_days)
    )
    oldest_allowed = run_date - dt.timedelta(days=effective_max_age)
    if latest_date >= oldest_allowed:
        return False, ""

    return (
        True,
        f"upstream {req.address.label} is stale: latest successful run was "
        f"{latest_date.isoformat()}, required on or after {oldest_allowed.isoformat()}",
    )


def plan_for_each(
    source_files: Iterable[str | Path],
    subject: str,
    pipeline: str,
    set_name: str,
    run_date: dt.date,
    *,
    file_id_fn: Callable[[str | Path], str] | None = None,
) -> list[PlanItem]:
    """Project one ``PlanItem`` per source file without executing any handler.

    Each item carries ``status="ready"`` and a ``reason`` that names the source
    file, using ``file_id_fn(file)`` if provided, otherwise the file's name as a
    string. No run history is consulted — this is a pure projection of planned
    per-file runs, useful for catch-up planning when a backlog of source files
    needs processing.
    """
    items: list[PlanItem] = []
    for source_file in source_files:
        file_id = (
            file_id_fn(source_file) if file_id_fn is not None else str(source_file)
        )
        items.append(
            PlanItem(
                run_date=run_date,
                set_name=set_name,
                subject=subject,
                pipeline=pipeline,
                status="ready",
                reason=f"source file: {file_id}",
            )
        )
    return items


def _decision(
    orchestration_run_id: str,
    item_key: str,
    set_name: str,
    item: ScheduledPipeline,
    run_date: dt.date,
    status: str,
    reason: str = "",
    duration: float | None = None,
) -> OrchestrationDecision:
    return OrchestrationDecision(
        orchestration_run_id=orchestration_run_id,
        item_key=item_key,
        set_name=set_name,
        subject=item.subject,
        pipeline=item.pipeline,
        run_date=run_date,
        status=status,
        reason=reason,
        duration=duration,
    )


def _item_key(set_name: str, item: ScheduledPipeline, run_date: dt.date) -> str:
    return f"{set_name}/{item.subject}/{item.pipeline}/{run_date.isoformat()}"


def _freshness_days(item: ScheduledPipeline) -> int:
    return max(
        (
            requirement.max_age_days
            for requirement in item.depends_on
            if requirement.max_age_days is not None
        ),
        default=0,
    )


def _dependency_pipeline_key(
    dependency: RunRequirement, default_subject: str
) -> tuple[str, str]:
    if isinstance(dependency, FreshnessRequirement):
        return (
            dependency.upstream_subject or default_subject,
            dependency.upstream_pipeline,
        )
    if isinstance(dependency, Requirement):
        return (
            dependency.address.subject or default_subject,
            dependency.address.pipeline,
        )
    raise TypeError(f"unsupported dependency requirement {dependency!r}")


def _override_items(overrides: dict) -> list[dict]:
    return list(overrides.get("pipelines", []))


def _find_override(
    overrides: dict, set_name: str, subject: str, pipeline: str
) -> dict | None:
    for item in _override_items(overrides):
        if (
            item.get("set") == set_name
            and item.get("subject") == subject
            and item.get("pipeline") == pipeline
        ):
            return item
    return None


def _schedule_from_config(config: dict | str) -> Schedule:
    if isinstance(config, str):
        config = {"type": config}
    kind = str(config.get("type", "")).replace("-", "_").lower()
    if kind in {"weekdays", "weekday"}:
        return Weekdays()
    if kind == "specific_weekdays":
        return SpecificWeekdays(config["weekdays"])
    if kind == "day_of_month":
        return DayOfMonth(int(config["day"]))
    if kind == "nth_working_day_of_month":
        return NthWorkingDayOfMonth(int(config["n"]))
    if kind == "last_working_day_of_month":
        return LastWorkingDayOfMonth()
    if kind == "manual_only":
        return ManualOnly()
    raise ValueError(f"unknown schedule override type {config.get('type')!r}")


def _item_context(
    item: Item,
    index: int,
    parent_context: RunContext,
    logical_run_id: LogicalRunId[Item] | None,
) -> RunContext:
    item_logical_run_id = (
        logical_run_id(item, index, parent_context)
        if logical_run_id is not None
        else f"{parent_context.logical_run_id}:{index}"
    )
    return RunContext(
        run_date=parent_context.run_date,
        logical_run_id=item_logical_run_id,
        load_date=parent_context.load_date,
        run_log=parent_context.run_log,
        run_registry=parent_context.run_registry,
        base_dir=parent_context.base_dir,
        subject=parent_context.subject,
        pipeline=parent_context.pipeline,
        freshness_days=parent_context.freshness_days,
    )

```
