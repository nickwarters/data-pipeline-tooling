"""Structured JSONL run observability for registry ingestion.

A ``RunLog`` emits one JSON object per line to a ``.log`` file and a
human-readable line to the console for each record of a run. The builder's
``.run()`` drives it per step (read, validate, write) and with a final run-level
summary; every record of a single run carries the same correlating
``pipeline_run_id`` (the concrete pipeline attempt) plus the ``logical_run_id``
(the business run / idempotency key) it belongs to. Structured-but-file-only
keeps local runs simple while giving the run registry machine-readable records
to ingest.

What a record *contains* is not decided here: the fields, their order, their
empty-value defaults and their console form come from the single declaration in
:mod:`tools.observability.record_schema`. This module owns the sink — where a
record goes and when it is emitted.
"""

from __future__ import annotations

import json
import logging
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from framework._internal.describe import render
from tools.observability.record_schema import build_run_record, console_parts
from tools.observability.timestamps import utc_now_iso

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
        pipeline_run_id: str,
        pipeline: str,
        step: str,
        rows_in: int | None = None,
        committed: bool = False,
        logical_run_id: str | None = None,
    ) -> Iterator[StepMetrics]:
        """Time a step; emit one record when it closes — or `error` if it raises.

        A raising step is recorded with ``status="error"`` and the exception
        message, then the exception is re-raised so the run still aborts.
        Nothing is swallowed.

        ``committed`` marks a step that durably wrote an artifact (a write,
        quarantine, explain/trace, or checkpoint) — independently committed
        evidence that survives a *later* step's failure. It is
        recorded only on the success path: a step that raised committed nothing.
        """
        metrics = StepMetrics()
        metrics.rows_in = rows_in
        started = time.perf_counter()
        try:
            yield metrics
        except Exception as exc:
            self.record(
                pipeline_run_id,
                pipeline,
                step,
                "error",
                logical_run_id=logical_run_id,
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
            pipeline_run_id,
            pipeline,
            step,
            "ok",
            logical_run_id=logical_run_id,
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
        pipeline_run_id: str,
        pipeline: str,
        step: str,
        status: str,
        *,
        logical_run_id: str | None = None,
        rows_in: int | None = None,
        rows_out: int | None = None,
        rows_quarantined: int | None = None,
        rows_excluded: int | None = None,
        duration: float | None = None,
        errors: list[str] | None = None,
        error_category: str | None = None,
        warn_hits: list[str] | None = None,
        committed: bool = False,
        step_address: str | None = None,
        params: dict[str, str] | None = None,
        profile: dict | None = None,
        data_locations: list[dict[str, str]] | None = None,
    ) -> None:
        """Append one JSONL record and echo a human-readable line to the console.

        The keyword parameters are the explicit contract callers write against;
        the *record* they produce — its keys, their order, and the empty-value
        defaults — comes from the single field declaration in
        :mod:`tools.observability.record_schema`. Its instant comes from
        :mod:`tools.observability.timestamps`, which is where the UTC-instant /
        local-date rule lives.
        """
        record = build_run_record(
            timestamp=utc_now_iso(),
            pipeline_run_id=pipeline_run_id,
            logical_run_id=logical_run_id,
            pipeline=pipeline,
            step=step,
            step_address=step_address,
            status=status,
            rows_in=rows_in,
            rows_out=rows_out,
            rows_quarantined=rows_quarantined,
            rows_excluded=rows_excluded,
            duration=duration,
            errors=errors,
            error_category=error_category,
            warn_hits=warn_hits,
            committed=committed,
            params=params,
            profile=profile,
            data_locations=data_locations,
        )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
        self._console(record)

    @staticmethod
    def _console(record: dict) -> None:
        """Echo a record to the console as a human-readable line, not raw JSON.

        The identifying head and tail are this method's; everything between them
        is rendered by the fields that declare a console form, so a new field
        shows up here without a new branch.
        """
        parts = [f"{record['pipeline']} {record['step']}: {record['status']}"]
        parts.extend(console_parts(record))
        parts.append(f"[run {record['pipeline_run_id'][:8]}]")
        log.info(" ".join(parts))


class _NullRunLog(RunLog):
    """A no-op run log: lets ``.run()`` stay branch-free when none is composed."""

    def __init__(self) -> None:  # noqa: D107 - deliberately stores no path
        pass

    @contextmanager
    def step(
        self,
        pipeline_run_id: str,
        pipeline: str,
        step: str,
        rows_in: int | None = None,
        committed: bool = False,
        logical_run_id: str | None = None,
    ) -> Iterator[StepMetrics]:
        metrics = StepMetrics()
        metrics.rows_in = rows_in
        yield metrics

    def record(self, *args, **kwargs) -> None:
        pass


# Shared sentinel so a builder without a run log drives the same code path.
NULL_RUN_LOG = _NullRunLog()
