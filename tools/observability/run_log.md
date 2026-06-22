```python
"""Structured JSONL run observability for registry ingestion.

A ``RunLog`` emits one JSON object per line to a ``.log`` file and a
human-readable line to the console for each record of a run. The builder's
``.run()`` drives it per step (read, validate, write) and with a final run-level
summary; every record of a single run carries the same correlating ``run_id``.
Structured-but-file-only keeps local runs simple while giving the run registry
machine-readable records to ingest.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from framework._internal.describe import render

log = logging.getLogger(__name__)


class StepMetrics:
    """Mutable per-step tally the caller fills in while a ``step`` is open.

    The builder sets whichever of ``rows_in`` / ``rows_out`` / ``rows_quarantined``
    a step produces and appends to ``warn_hits``; the :class:`RunLog` reads them
    back when the step closes. Keeps the timed-block body free of bookkeeping.
    """

    def __init__(self) -> None:
        self.rows_in: int | None = None
        self.rows_out: int | None = None
        self.rows_quarantined: int | None = None
        self.rows_excluded: int | None = None
        self.warn_hits: list[str] = []


class RunLog:
    """A structured JSONL sink (plus human-readable console) for one run-log file."""

    def __init__(self, log_path: str | os.PathLike[str]) -> None:
        self._path = Path(log_path)

    @property
    def path(self) -> Path:
        """The ``.log`` file this sink appends to (and the registry ingests)."""
        return self._path

    def describe(self) -> str:
        return render(self, path=str(self._path))

    @contextmanager
    def step(
        self,
        run_id: str,
        pipeline: str,
        step: str,
        rows_in: int | None = None,
        committed: bool = False,
    ) -> Iterator[StepMetrics]:
        """Time a step; emit one record when it closes — or `error` if it raises.

        A raising step is recorded with ``status="error"`` and the exception
        message, then the exception is re-raised so the run still aborts.
        Nothing is swallowed.

        ``committed`` marks a step that durably wrote an artifact (a write,
        quarantine, explain/trace, or checkpoint) — independently committed
        evidence that survives a *later* step's failure (ADR-0007 amd 03). It is
        recorded only on the success path: a step that raised committed nothing.
        """
        metrics = StepMetrics()
        metrics.rows_in = rows_in
        started = time.perf_counter()
        try:
            yield metrics
        except Exception as exc:
            self.record(
                run_id,
                pipeline,
                step,
                "error",
                rows_in=metrics.rows_in,
                rows_out=metrics.rows_out,
                rows_quarantined=metrics.rows_quarantined,
                rows_excluded=metrics.rows_excluded,
                duration=time.perf_counter() - started,
                errors=[str(exc)],
                # An expected PipelineError carries its triage category; a raw
                # exception (a genuine bug) has none — that absence is the signal.
                error_category=getattr(exc, "category", None),
                warn_hits=metrics.warn_hits,
            )
            raise
        self.record(
            run_id,
            pipeline,
            step,
            "ok",
            rows_in=metrics.rows_in,
            rows_out=metrics.rows_out,
            rows_quarantined=metrics.rows_quarantined,
            rows_excluded=metrics.rows_excluded,
            duration=time.perf_counter() - started,
            warn_hits=metrics.warn_hits,
            committed=committed,
        )

    def record(
        self,
        run_id: str,
        pipeline: str,
        step: str,
        status: str,
        *,
        rows_in: int | None = None,
        rows_out: int | None = None,
        rows_quarantined: int | None = None,
        rows_excluded: int | None = None,
        duration: float | None = None,
        errors: list[str] | None = None,
        error_category: str | None = None,
        warn_hits: list[str] | None = None,
        committed: bool = False,
    ) -> None:
        """Append one JSONL record and echo a human-readable line to the console."""
        record = {
            # The registry orders by the event time the emitter writes.
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "run_id": run_id,
            "pipeline": pipeline,
            "step": step,
            "status": status,
            "rows_in": rows_in,
            "rows_out": rows_out,
            "rows_quarantined": rows_quarantined,
            "rows_excluded": rows_excluded,
            "duration": duration,
            "errors": errors or [],
            # The triage category of the failure (data/operational/config), or
            # None for a non-PipelineError bug. See framework.core.ErrorCategory.
            "error_category": error_category,
            "warn_hits": warn_hits or [],
            # True when this step durably wrote an artifact (write / quarantine /
            # explain / checkpoint). Independently committed evidence — it stays
            # on disk even if a *later* step aborts the run (ADR-0007 amd 03).
            "committed": committed,
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
        self._console(record)

    @staticmethod
    def _console(record: dict) -> None:
        """Echo a record to the console as a human-readable line, not raw JSON."""
        parts = [f"{record['pipeline']} {record['step']}: {record['status']}"]
        if record["rows_in"] is not None:
            parts.append(f"rows_in={record['rows_in']}")
        if record["rows_out"] is not None:
            parts.append(f"rows_out={record['rows_out']}")
        if record.get("rows_quarantined"):
            parts.append(f"quarantined={record['rows_quarantined']}")
        if record.get("rows_excluded"):
            parts.append(f"excluded={record['rows_excluded']}")
        if record["duration"] is not None:
            parts.append(f"{record['duration']:.3f}s")
        if record["errors"]:
            parts.append(f"errors={'; '.join(record['errors'])}")
        if record.get("error_category"):
            parts.append(f"category={record['error_category']}")
        if record.get("committed"):
            parts.append("committed")
        if record["warn_hits"]:
            parts.append(f"warn={'; '.join(record['warn_hits'])}")
        parts.append(f"[run {record['run_id'][:8]}]")
        log.info(" ".join(parts))


class _NullRunLog(RunLog):
    """A no-op run log: lets ``.run()`` stay branch-free when none is composed."""

    def __init__(self) -> None:  # noqa: D107 - deliberately stores no path
        pass

    @contextmanager
    def step(
        self,
        run_id: str,
        pipeline: str,
        step: str,
        rows_in: int | None = None,
        committed: bool = False,
    ) -> Iterator[StepMetrics]:
        metrics = StepMetrics()
        metrics.rows_in = rows_in
        yield metrics

    def record(self, *args, **kwargs) -> None:
        pass


# Shared sentinel so a builder without a run log drives the same code path.
NULL_RUN_LOG = _NullRunLog()

```
