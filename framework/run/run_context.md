```python
"""Run context — execution identity, logical identity, dates, and collaborators."""

from __future__ import annotations

import datetime as dt
import uuid
from pathlib import Path

from tools.observability.run_log import NULL_RUN_LOG, RunLog
from tools.observability.run_registry import RunRegistry


class RunContext:
    """The execution context shared by orchestration, builders, and writers.

    ``execution_id`` identifies this concrete execution for logs and traceability.
    ``logical_run_id`` identifies the business run/idempotency key whose rows a
    re-drive replaces. ``run_id`` remains as the execution-id compatibility alias
    for RunLog/RunRegistry records.
    """

    def __init__(
        self,
        *,
        run_date: dt.date | None = None,
        execution_id: str | None = None,
        logical_run_id: str | None = None,
        load_date: dt.date | str | None = None,
        run_id: str | None = None,
        run_log: RunLog | None = None,
        run_registry: RunRegistry | None = None,
        base_dir: str | Path | None = None,
        subject: str | None = None,
        pipeline: str | None = None,
        freshness_days: int = 0,
    ) -> None:
        self.base_dir = Path(base_dir) if base_dir is not None else None
        self.subject = subject
        self.pipeline = pipeline
        self.run_date = run_date or dt.date.today()
        self.execution_id = execution_id or run_id or uuid.uuid4().hex
        self.logical_run_id = logical_run_id or self._default_logical_run_id()
        self.load_date = _date_text(load_date or self.run_date)
        self.run_log = run_log or NULL_RUN_LOG
        self.run_registry = run_registry
        self.freshness_days = freshness_days
        self._run_summary_recorded = False

    @property
    def run_id(self) -> str:
        """Compatibility alias for the execution id used by RunLog/RunRegistry."""
        return self.execution_id

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
        return self.execution_id


def _date_text(value: dt.date | str) -> str:
    return value.isoformat() if isinstance(value, dt.date) else value

```
