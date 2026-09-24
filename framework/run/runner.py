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
import importlib
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from framework._internal.source_location import located, raised_at
from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from framework.run.dry_run import DryRunReport
from framework.run.freshness import (
    FreshnessRequirement,
    FreshnessVerdict,
    Requirement,
    evaluate_requirement,
)
from framework.run.run_context import RunContext, active_context
from tools.observability.run_log import RunLog
from tools.observability.run_store import RunStore

# The requirement vocabulary is defined alongside the rule that evaluates it and
# re-exported here, so the long-standing ``framework.run.runner`` import path
# keeps working for both requirement types.
__all__ = [
    "FreshnessError",
    "FreshnessGuard",
    "FreshnessRequirement",
    "FreshnessVerdict",
    "LoadedPipeline",
    "PipelineRunner",
    "Requirement",
    "RunRequirement",
    "PipelineLoadError",
    "UnknownPipelineError",
    "dry_run_pipeline",
    "evaluate_requirement",
    "load_pipeline",
    "pipeline_label",
    "run_pipeline",
]


class UnknownPipelineError(PipelineError):
    """Raised when no domain Pipeline is registered for the requested key."""

    category = ErrorCategory.CONFIG


class PipelineLoadError(PipelineError):
    """A pipeline exists at the requested path but failed while being imported.

    Distinct from :class:`UnknownPipelineError` on purpose: "there is no such
    pipeline" sends an operator hunting for a typo in the path, when the module
    is right there and one of *its* imports is missing, or its top level raised.
    The message names the error and the line of the pipeline code it came from;
    the original is chained as ``__cause__`` for the full traceback.
    """

    category = ErrorCategory.CODE


class FreshnessError(PipelineError):
    """Raised when a declared upstream has history, but it is stale."""

    category = ErrorCategory.OPERATIONAL


def pipeline_label(subject: str | None, pipeline: str) -> str:
    """Return the stable registry label for a domain Pipeline.

    Subject-qualified (``subject/pipeline``) when a medallion subject is given;
    the bare pipeline name when it is not (the path-addressed ``run`` case). This
    mirrors :attr:`RunContext.label` so an upstream resolves to the same identity
    its run recorded under.
    """
    return f"{subject}/{pipeline}" if subject else pipeline


class FreshnessGuard:
    """Blocks a run whose declared upstream has no recent enough success.

    The side-effecting half of the freshness rule: it asks
    :func:`~framework.run.freshness.evaluate_requirement` — the same predicate
    the orchestration plan preview reads — and then does what only a real run
    can do, namely record the outcome to the run log and refuse to continue. The
    decision, and the sentence explaining it, come from the shared rule, so a
    preview and the run it previews can never disagree.
    """

    def check(
        self, context: RunContext, requirement: FreshnessRequirement | Requirement
    ) -> None:
        verdict = evaluate_requirement(
            requirement,
            context.run_registry,
            run_date=context.run_date,
            label=context.label,
            freshness_days=context.freshness_days,
            default_subject=context.subject,
        )
        if not verdict.satisfied:
            _record_requirement_error(context, verdict.reason)
            raise FreshnessError(verdict.reason)
        # A satisfied first run is still worth saying out loud: there was no
        # history to check, so the reason carries the warning (empty under the
        # "allow" policy, which asks for silence).
        warn_hits = [verdict.reason] if verdict.first_run and verdict.reason else []
        _record_requirement_ok(context, warn_hits)


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

    Where those files sit under ``base_dir`` is not decided here: ``RunStore``
    owns the run-metadata layout, and the shared ``RunRegistry`` it opens is
    caught up from *every* run log before freshness runs, so a declared
    upstream's history is visible no matter which log file partitioned it.
    ``ingest`` is incremental and idempotent, so the sweep is cheap and safe to
    repeat.
    """
    guard = freshness_guard or FreshnessGuard()
    root = Path(base_dir)
    run_store = RunStore(root)
    if run_log is None:
        run_log = run_store.log_for(subject or name)
    run_log_path = run_log.path
    run_registry = run_store.catch_up()

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
        # Make the context ambient so a handler's bare ``p.run()`` calls inherit
        # this attempt's identity (one ``pipeline_run_id`` across every one's
        # run-log records and the rows they stamp) rather than minting fresh ids.
        with active_context(context):
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


@dataclass(frozen=True)
class LoadedPipeline:
    """A path-addressed pipeline resolved to its runnable pieces.

    ``run`` is the ``run(context)`` callable to execute; ``name`` is the leaf of
    the ``pipelines/<name>`` path and doubles as the run-history label (the
    identity ``status`` / ``runs`` / ``log`` key on); ``upstreams`` is the
    module's optional ``UPSTREAMS`` freshness tuple.
    """

    name: str
    run: Handler
    upstreams: tuple[RunRequirement, ...]


def load_pipeline(path: str) -> LoadedPipeline:
    """Resolve a ``pipelines/<name>`` disk path to its runnable pipeline.

    The pipeline's address *is* its location on disk: ``pipelines/orders`` maps
    to the module ``pipelines.orders.pipeline``, imported *at runtime* (never a
    static framework dependency, so ``pipelines/`` depends on ``framework`` and
    not the reverse). The module must expose a ``run(context)`` callable and may
    declare an ``UPSTREAMS`` tuple of freshness requirements.

    Shared by the operator CLI's ``run`` command and the path-addressed
    :class:`~tools.orchestration.Orchestrator`, so both resolve a scheduled or
    requested pipeline by exactly the same rule. Raises
    :class:`UnknownPipelineError` when there is no pipeline module at the path
    or it defines no ``run(context)`` callable, and :class:`PipelineLoadError`
    when the module is there but raises while it is imported -- a missing
    dependency, a syntax error, a top-level statement that fails.
    """
    address = path.strip("/")
    module_path = address.replace("/", ".") + ".pipeline"
    try:
        module = importlib.import_module(module_path)
    except ModuleNotFoundError as exc:
        if not _names_the_pipeline_itself(exc.name, module_path):
            raise _load_error(path, module_path, exc) from exc
        raise UnknownPipelineError(
            f"no pipeline at {path!r}: cannot import {module_path!r} "
            "(expected pipelines/<name>/pipeline.py, run from the repo root)"
        ) from exc
    except Exception as exc:
        raise _load_error(path, module_path, exc) from exc
    handler = getattr(module, "run", None)
    if not callable(handler):
        raise UnknownPipelineError(
            f"pipeline {path!r} ({module_path}) defines no run(context) callable"
        )
    name = address.split("/")[-1]
    return LoadedPipeline(name, handler, tuple(getattr(module, "UPSTREAMS", ())))


def _names_the_pipeline_itself(missing: str | None, module_path: str) -> bool:
    """Whether a ``ModuleNotFoundError`` is about the pipeline's own module path.

    ``pipelines.nope.pipeline`` missing -- or ``pipelines.nope``, or
    ``pipelines`` -- means there is no pipeline there. Anything else missing is
    something the pipeline imports, which means the pipeline *is* there.
    """
    if missing is None:
        return True
    return module_path == missing or module_path.startswith(missing + ".")


def _load_error(path: str, module_path: str, exc: Exception) -> PipelineLoadError:
    """The located message for a pipeline module that raised while importing."""
    reason = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
    lines = [
        f"pipeline {path!r} exists but could not be loaded: importing "
        f"{module_path!r} raised {reason}"
    ]
    if isinstance(exc, SyntaxError) and exc.filename and exc.lineno:
        # A syntax error is raised by the compiler, not from a frame in the file
        # it is about, so its location lives on the exception itself.
        location = located(exc.filename, exc.lineno)
    else:
        location = raised_at(exc)
    if location is not None:
        where, code = location
        lines.append(f"raised at {where}")
        if code:
            lines.append(f"  {code}")
    return PipelineLoadError("\n".join(lines))


def dry_run_pipeline(
    handler: Handler,
    name: str,
    base_dir: str | Path,
    *,
    subject: str | None = None,
    run_date: dt.date | None = None,
    logical_run_id: str | None = None,
    params: RunParams | None = None,
    freshness_days: int = 0,
) -> DryRunReport:
    """Preview a pipeline handler without committing anything.

    Runs ``handler`` under a dry-run :class:`RunContext` made ambient for the
    call, so every nested ``Pipeline.run()`` reads, processes, and validates real
    data but skips every write, quarantine commit, and explain trace. No run log
    or run registry is touched. Returns the accumulated :class:`DryRunReport`;
    a fail-fast :class:`PipelineError` (e.g. an error-severity validation
    failure) is recorded on the report rather than raised, so the caller still
    gets the preview of every step up to the stop.

    ``params`` carries the same run parameters a real run passes, so a handler
    that reads ``context.params`` behaves identically under a preview — a preview
    that dropped them would fail on exactly the pipelines it exists to check.
    """
    context = RunContext(
        base_dir=Path(base_dir),
        subject=subject,
        pipeline=name,
        run_date=run_date or dt.date.today(),
        logical_run_id=logical_run_id,
        params=params,
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


def _record_requirement_ok(context: RunContext, warn_hits: list[str]) -> None:
    context.run_log.record(
        context.pipeline_run_id,
        context.label,
        "freshness",
        "ok",
        logical_run_id=context.logical_run_id,
        warn_hits=warn_hits,
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
