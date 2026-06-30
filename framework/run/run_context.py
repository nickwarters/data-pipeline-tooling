"""Run context — execution identity, logical identity, dates, and collaborators."""

from __future__ import annotations

import contextvars
import datetime as dt
import uuid
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from framework.run.dry_run import DryRunReport
from tools.observability.run_log import NULL_RUN_LOG, RunLog
from tools.observability.run_registry import RunRegistry

RunParams = Mapping[str, str]


class RunContext:
    """The execution context shared by orchestration, builders, and writers.

    The three run identifiers, widest to narrowest scope:

    * ``orchestration_run_id`` — the umbrella id of one runner/orchestrator pass,
      shared by every pipeline it triggers. Owned by ``tools.orchestration``; it
      is not minted here (a bare ``Pipeline.run()`` has no orchestration above it).
    * ``pipeline_run_id`` — this one concrete pipeline attempt. A fresh id per
      execution; the correlating key every RunLog/RunRegistry record carries.
    * ``logical_run_id`` — the business run / idempotency key (``<label>:<run_date>``)
      whose rows a re-drive replaces. Stable across re-drives of the same run date.
    """

    def __init__(
        self,
        *,
        run_date: dt.date | None = None,
        pipeline_run_id: str | None = None,
        logical_run_id: str | None = None,
        load_date: dt.date | str | None = None,
        run_log: RunLog | None = None,
        run_registry: RunRegistry | None = None,
        base_dir: str | Path | None = None,
        subject: str | None = None,
        pipeline: str | None = None,
        freshness_days: int = 0,
        params: RunParams | None = None,
        dry_run: bool = False,
    ) -> None:
        self.dry_run = dry_run
        self.dry_run_report: DryRunReport | None = DryRunReport() if dry_run else None
        self.base_dir = Path(base_dir) if base_dir is not None else None
        self.subject = subject
        self.pipeline = pipeline
        self.params: RunParams = dict(params or {})
        self.run_date = run_date or dt.date.today()
        self.pipeline_run_id = pipeline_run_id or uuid.uuid4().hex
        self.logical_run_id = logical_run_id or self._default_logical_run_id()
        self.load_date = _date_text(load_date or self.run_date)
        self.run_log = run_log or NULL_RUN_LOG
        self.run_registry = run_registry
        self.freshness_days = freshness_days
        self._run_summary_recorded = False

    @property
    def label(self) -> str:
        """Stable run-history label for a domain Pipeline."""
        if self.subject and self.pipeline:
            return f"{self.subject}/{self.pipeline}"
        return self.pipeline or ""

    @property
    def run_summary_recorded(self) -> bool:
        """Whether this execution already emitted its run-level summary."""
        return self._run_summary_recorded

    def mark_run_summary_recorded(self) -> None:
        """Mark that the run-level summary has been emitted."""
        self._run_summary_recorded = True

    def _default_logical_run_id(self) -> str:
        if self.pipeline:
            return f"{self.label}:{self.run_date.isoformat()}"
        return self.pipeline_run_id


def _date_text(value: dt.date | str) -> str:
    return value.isoformat() if isinstance(value, dt.date) else value


# The ambient run context for the current call stack. A handler runs inside
# ``active_context(ctx)``; a ``Pipeline.run()`` invoked with no explicit context
# falls back to this. That makes a dry run safe even for the common
# ``p.run()`` (no-arg) authoring style: the dry-run flag reaches every nested
# pipeline without each call having to thread the context through by hand.
_ACTIVE_CONTEXT: contextvars.ContextVar["RunContext | None"] = contextvars.ContextVar(
    "active_run_context", default=None
)


@contextmanager
def active_context(context: "RunContext") -> "Iterator[RunContext]":
    """Make ``context`` the ambient run context for the duration of the block."""
    token = _ACTIVE_CONTEXT.set(context)
    try:
        yield context
    finally:
        _ACTIVE_CONTEXT.reset(token)


def current_context() -> "RunContext | None":
    """Return the ambient run context, or ``None`` outside an active block."""
    return _ACTIVE_CONTEXT.get()
