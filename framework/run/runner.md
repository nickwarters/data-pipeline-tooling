```python
"""Minimal domain Pipeline runner with upstream freshness checks.

The builder-level :class:`framework.run.builder.Pipeline` still owns one tabular
read/process/write path. This module is the thin orchestration layer above it:
callers register domain Pipelines by ``(subject, pipeline)``, then run one by
name. The runner records domain-level run summaries to ``RunLog`` using stable
labels such as ``cases/ingest`` so ``RunRegistry`` can answer whether an
upstream Pipeline or task satisfies a declared requirement before a downstream
Pipeline starts.
"""

from __future__ import annotations

import datetime as dt
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from framework.run.address import RunAddress
from framework.run.dry_run import DryRunReport
from framework.run.run_context import RunContext, active_context
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry


class UnknownPipelineError(PipelineError):
    """Raised when no domain Pipeline is registered for the requested key."""

    category = ErrorCategory.CONFIG


class FreshnessError(PipelineError):
    """Raised when a declared upstream has history, but it is stale."""

    category = ErrorCategory.OPERATIONAL


@dataclass(frozen=True)
class FreshnessRequirement:
    """The upstream domain Pipeline a run requires to be current."""

    upstream_pipeline: str
    upstream_subject: str | None = None
    max_age_days: int = 0

    def as_requirement(self, default_subject: str | None = None) -> "Requirement":
        """Return the equivalent public requirement predicate."""

        return Requirement.succeeded(
            RunAddress.pipeline(
                self.upstream_pipeline,
                subject=self.upstream_subject or default_subject,
            )
        ).within_days(self.max_age_days)


@dataclass(frozen=True)
class Requirement:
    """A run-history predicate that must pass before a downstream run starts."""

    address: RunAddress
    max_age_days: int | None = None
    require_same_day: bool = False
    first_run_policy: str = "warn"

    @classmethod
    def succeeded(cls, address: RunAddress | str) -> "Requirement":
        """Require a successful run record for a pipeline or task address."""

        target = RunAddress.parse(address) if isinstance(address, str) else address
        return cls(target)

    def within_days(self, days: int) -> "Requirement":
        """Require the latest success to be on or after run date minus ``days``."""

        if days < 0:
            raise ValueError("days must be zero or greater")
        return Requirement(
            self.address,
            max_age_days=days,
            require_same_day=False,
            first_run_policy=self.first_run_policy,
        )

    def same_day(self) -> "Requirement":
        """Require a success on the downstream run date."""

        return Requirement(
            self.address,
            max_age_days=self.max_age_days,
            require_same_day=True,
            first_run_policy=self.first_run_policy,
        )

    def on_first_run(self, policy: str) -> "Requirement":
        """Set the no-history policy: ``allow``, ``warn``, or ``block``."""

        if policy not in {"allow", "warn", "block"}:
            raise ValueError("first-run policy must be 'allow', 'warn', or 'block'")
        return Requirement(
            self.address,
            max_age_days=self.max_age_days,
            require_same_day=self.require_same_day,
            first_run_policy=policy,
        )


def pipeline_label(subject: str | None, pipeline: str) -> str:
    """Return the stable registry label for a domain Pipeline.

    Subject-qualified (``subject/pipeline``) when a medallion subject is given;
    the bare pipeline name when it is not (the path-addressed ``run`` case). This
    mirrors :attr:`RunContext.label` so an upstream resolves to the same identity
    its run recorded under.
    """
    return f"{subject}/{pipeline}" if subject else pipeline


class FreshnessGuard:
    """Checks that a declared upstream has a recent successful run."""

    def check(
        self, context: RunContext, requirement: FreshnessRequirement | Requirement
    ) -> None:
        predicate = _as_requirement(requirement, context)
        latest = context.run_registry.latest_success(predicate.address)
        if latest is None:
            _handle_first_run(context, predicate)
            return

        latest_date = _timestamp(latest["timestamp"]).date()
        if predicate.require_same_day:
            if latest_date == context.run_date:
                _record_requirement_ok(context)
                return
            message = (
                f"upstream {predicate.address.label} is stale: latest successful "
                f"run was {latest_date.isoformat()}, required on "
                f"{context.run_date.isoformat()} for {context.label}"
            )
            _record_requirement_error(context, message)
            raise FreshnessError(message)

        max_age_days = (
            context.freshness_days
            if predicate.max_age_days is None
            else max(predicate.max_age_days, context.freshness_days)
        )
        oldest_allowed = context.run_date - dt.timedelta(days=max_age_days)
        if latest_date >= oldest_allowed:
            _record_requirement_ok(context)
            return

        message = (
            f"upstream {predicate.address.label} is stale: latest successful run was "
            f"{latest_date.isoformat()}, required on or after "
            f"{oldest_allowed.isoformat()} for {context.label}"
        )
        _record_requirement_error(context, message)
        raise FreshnessError(message)


Handler = Callable[[RunContext], object]
RunRequirement = FreshnessRequirement | Requirement
RunParams = Mapping[str, str]


def run_pipeline(
    handler: Handler,
    name: str,
    base_dir: str | Path,
    *,
    subject: str | None = None,
    upstreams: tuple[RunRequirement, ...] = (),
    run_date: dt.date | None = None,
    logical_run_id: str | None = None,
    params: RunParams | None = None,
    freshness_days: int = 0,
    freshness_guard: FreshnessGuard | None = None,
    run_log: RunLog | None = None,
) -> object:
    """Execute one pipeline handler with freshness checks and run recording.

    The execution core shared by ``PipelineRunner`` (which addresses pipelines by
    a registered ``(subject, name)`` key) and the path-addressed ``run``
    command (which imports a ``pipelines/<name>/pipeline.py`` module and runs its
    ``run`` callable directly). ``name`` is the run-history identity; ``subject``
    is the optional medallion subject — when given, the label is ``subject/name``
    and the run log partitions under ``_runs/<subject>.log``; when ``None`` (the
    path-addressed case) both fall back to ``name``.

    ``run_log`` lets a caller supply its own sink; when ``None`` (the default) one
    is opened at ``<base_dir>/_runs/<subject or name>.log``. A supplied log placed
    outside ``_runs/`` won't be picked up by the freshness sweep below, so prefer
    the default unless you have a reason to redirect it.

    The shared ``RunRegistry`` is caught up from *every* ``_runs/*.log`` before
    freshness runs, so a declared upstream's history is visible no matter which
    log file partitioned it. ``ingest`` is incremental and idempotent, so the
    sweep is cheap and safe to repeat.
    """
    guard = freshness_guard or FreshnessGuard()
    root = Path(base_dir)
    runs_dir = root / "_runs"
    registry_path = root / "_registry" / "runs.db"
    if run_log is None:
        run_log = RunLog(runs_dir / f"{subject or name}.log")
    run_log_path = run_log.path
    run_registry = RunRegistry(registry_path)
    if runs_dir.exists():
        for log_file in sorted(runs_dir.glob("*.log")):
            run_registry.ingest(log_file)

    context = RunContext(
        base_dir=root,
        subject=subject,
        pipeline=name,
        run_date=run_date or dt.date.today(),
        pipeline_run_id=uuid.uuid4().hex,
        logical_run_id=logical_run_id,
        params=params,
        run_log=run_log,
        run_registry=run_registry,
        freshness_days=freshness_days,
    )

    started = time.perf_counter()
    try:
        for requirement in upstreams:
            guard.check(context, requirement)
        result = handler(context)
    except Exception as exc:
        if not context.run_summary_recorded:
            run_log.record(
                context.pipeline_run_id,
                context.label,
                "run",
                "error",
                logical_run_id=context.logical_run_id,
                duration=time.perf_counter() - started,
                errors=[str(exc)],
                params=_diagnostic_params(context.params),
            )
            context.mark_run_summary_recorded()
        run_registry.ingest(run_log_path)
        raise

    rows = len(result) if isinstance(result, Dataset) else None
    if not context.run_summary_recorded:
        run_log.record(
            context.pipeline_run_id,
            context.label,
            "run",
            "ok",
            logical_run_id=context.logical_run_id,
            rows_in=rows,
            rows_out=rows,
            duration=time.perf_counter() - started,
            params=_diagnostic_params(context.params),
        )
        context.mark_run_summary_recorded()
    run_registry.ingest(run_log_path)
    return result


def dry_run_pipeline(
    handler: Handler,
    name: str,
    base_dir: str | Path,
    *,
    subject: str | None = None,
    run_date: dt.date | None = None,
    logical_run_id: str | None = None,
    freshness_days: int = 0,
) -> DryRunReport:
    """Preview a pipeline handler without committing anything (issue #102).

    Runs ``handler`` under a dry-run :class:`RunContext` made ambient for the
    call, so every nested ``Pipeline.run()`` reads, processes, and validates real
    data but skips every write, quarantine commit, and explain trace. No run log
    or run registry is touched. Returns the accumulated :class:`DryRunReport`;
    a fail-fast :class:`PipelineError` (e.g. an error-severity validation
    failure) is recorded on the report rather than raised, so the caller still
    gets the preview of every step up to the stop.
    """
    context = RunContext(
        base_dir=Path(base_dir),
        subject=subject,
        pipeline=name,
        run_date=run_date or dt.date.today(),
        logical_run_id=logical_run_id,
        freshness_days=freshness_days,
        dry_run=True,
    )
    report = context.dry_run_report
    assert report is not None  # a dry-run context always carries one
    try:
        with active_context(context):
            handler(context)
    except PipelineError as exc:
        report.mark_failed(exc)
    return report


@dataclass(frozen=True)
class _RegisteredPipeline:
    handler: Handler
    freshness: tuple[RunRequirement, ...] = field(default_factory=tuple)
    run_log: RunLog | None = None


class PipelineRunner:
    """In-memory registry and dispatcher for domain Pipelines."""

    def __init__(self, freshness_guard: FreshnessGuard | None = None) -> None:
        self._registered: dict[tuple[str, str], _RegisteredPipeline] = {}
        self._freshness_guard = freshness_guard or FreshnessGuard()

    def register(
        self,
        subject: str,
        pipeline: str,
        handler: Handler,
        *,
        freshness: tuple[RunRequirement, ...] = (),
        run_log: RunLog | None = None,
    ) -> None:
        """Register a domain Pipeline under ``(subject, pipeline)``.

        ``run_log`` optionally supplies the sink the run records to; when omitted
        (the default) the run opens one at ``<base_dir>/_runs/<subject>.log``.
        """
        self._registered[(subject, pipeline)] = _RegisteredPipeline(
            handler, freshness, run_log
        )

    def run(
        self,
        subject: str,
        pipeline: str,
        base_dir: str | Path,
        *,
        run_date: dt.date | None = None,
        logical_run_id: str | None = None,
        params: RunParams | None = None,
        freshness_days: int = 0,
        freshness: tuple[RunRequirement, ...] = (),
    ) -> object:
        registered = self._registered.get((subject, pipeline))
        if registered is None:
            raise UnknownPipelineError(
                f"unknown pipeline {pipeline!r} for case type {subject!r}"
            )
        return run_pipeline(
            registered.handler,
            pipeline,
            base_dir,
            subject=subject,
            upstreams=(*registered.freshness, *freshness),
            run_date=run_date,
            logical_run_id=logical_run_id,
            params=params,
            freshness_days=freshness_days,
            freshness_guard=self._freshness_guard,
            run_log=registered.run_log,
        )


def _diagnostic_params(params: RunParams) -> dict[str, str]:
    """Return params suitable for operator logs without exposing likely secrets."""
    sensitive_markers = ("secret", "token", "password", "credential", "key")
    safe: dict[str, str] = {}
    for key, value in params.items():
        if any(marker in key.lower() for marker in sensitive_markers):
            safe[key] = "<redacted>"
        else:
            safe[key] = value
    return safe


def _timestamp(value: str) -> dt.datetime:
    """Parse the ISO timestamp emitted by RunLog."""
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def _as_requirement(
    requirement: FreshnessRequirement | Requirement, context: RunContext
) -> Requirement:
    if isinstance(requirement, FreshnessRequirement):
        return requirement.as_requirement(default_subject=context.subject)
    return requirement


def _handle_first_run(context: RunContext, requirement: Requirement) -> None:
    message = f"no successful run history for upstream {requirement.address.label}"
    if requirement.first_run_policy == "block":
        error = f"{message}; blocking first run"
        _record_requirement_error(context, error)
        raise FreshnessError(error)

    warn_hits = []
    if requirement.first_run_policy == "warn":
        warn_hits = [f"{message}; allowing first run"]
    context.run_log.record(
        context.pipeline_run_id,
        context.label,
        "freshness",
        "ok",
        logical_run_id=context.logical_run_id,
        warn_hits=warn_hits,
    )


def _record_requirement_ok(context: RunContext) -> None:
    context.run_log.record(
        context.pipeline_run_id,
        context.label,
        "freshness",
        "ok",
        logical_run_id=context.logical_run_id,
        warn_hits=[],
    )


def _record_requirement_error(context: RunContext, message: str) -> None:
    context.run_log.record(
        context.pipeline_run_id,
        context.label,
        "freshness",
        "error",
        logical_run_id=context.logical_run_id,
        errors=[message],
    )

```
