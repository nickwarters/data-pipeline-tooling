"""Minimal domain Pipeline runner with upstream freshness checks.

The builder-level :class:`framework.builder.Pipeline` still owns one tabular
read/process/write path. This module is the thin orchestration layer above it:
callers register domain Pipelines by ``(case_type, pipeline)``, then run one by
name. The runner records domain-level run summaries to ``RunLog`` using stable
labels such as ``cases/ingest`` so ``RunRegistry`` can answer whether an
upstream Pipeline is recent enough before a downstream Pipeline starts.
"""

from __future__ import annotations

import datetime as dt
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from framework.dataset import Dataset
from framework.run_context import RunContext
from framework.run_log import RunLog
from framework.run_registry import RunRegistry


class UnknownPipelineError(ValueError):
    """Raised when no domain Pipeline is registered for the requested key."""


class FreshnessError(RuntimeError):
    """Raised when a declared upstream has history, but it is stale."""


@dataclass(frozen=True)
class FreshnessRequirement:
    """The upstream domain Pipeline a run requires to be current."""

    upstream_pipeline: str
    upstream_case_type: str | None = None
    max_age_days: int = 0


def pipeline_label(case_type: str, pipeline: str) -> str:
    """Return the stable registry label for a domain Pipeline."""
    return f"{case_type}/{pipeline}"


class FreshnessGuard:
    """Checks that a declared upstream has a recent successful run."""

    def check(self, context: RunContext, requirement: FreshnessRequirement) -> None:
        upstream_case_type = requirement.upstream_case_type or context.case_type
        upstream = pipeline_label(upstream_case_type, requirement.upstream_pipeline)
        successful = [
            r
            for r in context.run_registry.query_runs(pipeline=upstream, status="ok")
            if r.get("timestamp")
        ]
        if not successful:
            context.run_log.record(
                context.run_id,
                context.label,
                "freshness",
                "ok",
                warn_hits=[
                    "no successful run history for upstream "
                    f"{upstream}; allowing first run"
                ],
            )
            return

        latest = max(
            successful,
            key=lambda r: _timestamp(r["timestamp"]),
        )
        latest_date = _timestamp(latest["timestamp"]).date()
        max_age_days = max(requirement.max_age_days, context.freshness_days)
        oldest_allowed = context.run_date - dt.timedelta(days=max_age_days)
        if latest_date >= oldest_allowed:
            context.run_log.record(
                context.run_id,
                context.label,
                "freshness",
                "ok",
                warn_hits=[],
            )
            return

        message = (
            f"upstream {upstream} is stale: latest successful run was "
            f"{latest_date.isoformat()}, required on or after "
            f"{oldest_allowed.isoformat()} for {context.label}"
        )
        context.run_log.record(
            context.run_id,
            context.label,
            "freshness",
            "error",
            errors=[message],
        )
        raise FreshnessError(message)


Handler = Callable[[RunContext], object]


@dataclass(frozen=True)
class _RegisteredPipeline:
    handler: Handler
    freshness: tuple[FreshnessRequirement, ...] = field(default_factory=tuple)


class PipelineRunner:
    """In-memory registry and dispatcher for domain Pipelines."""

    def __init__(self, freshness_guard: FreshnessGuard | None = None) -> None:
        self._registered: dict[tuple[str, str], _RegisteredPipeline] = {}
        self._freshness_guard = freshness_guard or FreshnessGuard()

    def register(
        self,
        case_type: str,
        pipeline: str,
        handler: Handler,
        *,
        freshness: tuple[FreshnessRequirement, ...] = (),
    ) -> None:
        self._registered[(case_type, pipeline)] = _RegisteredPipeline(
            handler, freshness
        )

    def run(
        self,
        case_type: str,
        pipeline: str,
        base_dir: str | Path,
        *,
        run_date: dt.date | None = None,
        logical_run_id: str | None = None,
        freshness_days: int = 0,
        freshness: tuple[FreshnessRequirement, ...] = (),
    ) -> object:
        registered = self._registered.get((case_type, pipeline))
        if registered is None:
            raise UnknownPipelineError(
                f"unknown pipeline {pipeline!r} for case type {case_type!r}"
            )

        root = Path(base_dir)
        run_log_path = root / "_runs" / f"{case_type}.log"
        registry_path = root / "_registry" / "runs.db"
        run_log = RunLog(run_log_path)
        run_registry = RunRegistry(registry_path)
        if run_log_path.exists():
            run_registry.ingest(run_log_path)

        context = RunContext(
            base_dir=root,
            case_type=case_type,
            pipeline=pipeline,
            run_date=run_date or dt.date.today(),
            execution_id=uuid.uuid4().hex,
            logical_run_id=logical_run_id,
            run_log=run_log,
            run_registry=run_registry,
            freshness_days=freshness_days,
        )

        started = time.perf_counter()
        try:
            for requirement in (*registered.freshness, *freshness):
                self._freshness_guard.check(context, requirement)
            result = registered.handler(context)
        except Exception as exc:
            if not context.run_summary_recorded:
                run_log.record(
                    context.run_id,
                    context.label,
                    "run",
                    "error",
                    duration=time.perf_counter() - started,
                    errors=[str(exc)],
                )
                context.mark_run_summary_recorded()
            run_registry.ingest(run_log_path)
            raise

        rows = len(result) if isinstance(result, Dataset) else None
        if not context.run_summary_recorded:
            run_log.record(
                context.run_id,
                context.label,
                "run",
                "ok",
                rows_in=rows,
                rows_out=rows,
                duration=time.perf_counter() - started,
            )
            context.mark_run_summary_recorded()
        run_registry.ingest(run_log_path)
        return result


def _timestamp(value: str) -> dt.datetime:
    """Parse the ISO timestamp emitted by RunLog."""
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
