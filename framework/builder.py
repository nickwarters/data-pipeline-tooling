"""The deferred fluent builder — describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a feed's reader and its destination Writer (and, in
later slices, processors and validators) without running anything. Execution
happens only at the ``.run()`` terminus, which owns the cross-cutting concerns
— timing, logging, lineage, error handling — for every stage. The builder makes
**no** write decisions: it hands the read ``DataHandle`` to the composed Writer,
which owns its own location and load strategy (ADR-0003, ADR-0006).
"""

from __future__ import annotations

import logging
import time
import uuid
from functools import partial

from framework.data_handle import DataHandle
from framework.readers import Reader
from framework.run_log import NULL_RUN_LOG, RunLog, StepMetrics
from framework.validators import Severity, ValidationError, Validator
from framework.writers import Writer

log = logging.getLogger(__name__)


class Pipeline:
    """A deferred pipeline for one feed: read, then hand off to a Writer."""

    def __init__(
        self, name: str, reader: Reader, run_log: RunLog | None = None
    ) -> None:
        # `name` labels the feed/pipeline (for lineage in later slices); it is
        # not a write decision — the Writer owns the target table. Nothing runs
        # at construction.
        self._name = name
        self._reader = reader
        self._writer: Writer | None = None
        # The run-log sink (ADR-0007); when none is composed, a null sink lets
        # `.run()` drive the same branch-free code path while emitting nothing.
        # `run_id` is minted per `.run()` (see below) and correlates every
        # record of that run.
        self._run_log = run_log or NULL_RUN_LOG
        self.run_id: str | None = None
        # Validators are attached with their severity and run in attach order:
        # pre-validators gate the input, post-validators gate the output that is
        # about to be written.
        self._pre_validators: list[tuple[Validator, Severity]] = []
        self._post_validators: list[tuple[Validator, Severity]] = []

    def with_validator(
        self, validator: Validator, severity: Severity = "error"
    ) -> "Pipeline":
        """Attach a pre-validator (checks the input). Deferred — nothing runs."""
        self._pre_validators.append((validator, severity))
        return self

    def with_post_validator(
        self, validator: Validator, severity: Severity = "error"
    ) -> "Pipeline":
        """Attach a post-validator (checks the output). Deferred."""
        self._post_validators.append((validator, severity))
        return self

    def write_to(self, writer: Writer) -> "Pipeline":
        """Compose in the destination Writer. Deferred — nothing runs yet."""
        self._writer = writer
        return self

    def run(self) -> DataHandle:
        """Execute: read, validate, hand the handle to the Writer, return it.

        Fail-fast and atomic (ADR-0007): an error-severity validator aborts the
        run *before* the Writer is called, so nothing partial lands; a
        warn-severity failure logs and continues. The write itself is a single
        SQLite transaction owned by the Writer. Returns the bulk-tier
        ``DataHandle`` (ADR-0003).

        ``.run()`` is also the home of cross-cutting observability: it mints a
        fresh ``run_id`` (exposed as :attr:`run_id`) and drives the composed
        :class:`RunLog` per step plus a final ``run`` summary, so every record
        of this run correlates and an abort is still recorded before it raises.
        """
        self.run_id = uuid.uuid4().hex
        # Bind the per-run identity once so each step/summary call stays terse.
        step = partial(self._run_log.step, self.run_id, self._name)
        record = partial(self._run_log.record, self.run_id, self._name)
        started = time.perf_counter()
        warn_hits: list[str] = []
        try:
            with step("read") as metrics:
                handle = self._reader.read()
                metrics.rows_out = len(handle)

            with step("pre-validate", rows_in=len(handle)) as metrics:
                self._validate(self._pre_validators, handle, "pre-validate", metrics)
                metrics.rows_out = len(handle)
            warn_hits += metrics.warn_hits

            # Processors transform the handle here in a later slice;
            # post-validators then gate that output. Today the output is the
            # read handle unchanged.
            with step("post-validate", rows_in=len(handle)) as metrics:
                self._validate(self._post_validators, handle, "post-validate", metrics)
                metrics.rows_out = len(handle)
            warn_hits += metrics.warn_hits

            if self._writer is not None:
                with step("write", rows_in=len(handle)) as metrics:
                    self._writer.write(handle)
                    metrics.rows_out = len(handle)
        except Exception as exc:
            # Fail-fast (ADR-0007): the failing step already logged its own
            # `error` record; the run summary closes the run as aborted before
            # the exception propagates to the caller.
            record(
                "run",
                "error",
                duration=time.perf_counter() - started,
                errors=[str(exc)],
            )
            raise

        record(
            "run",
            "ok",
            rows_in=len(handle),
            rows_out=len(handle),
            duration=time.perf_counter() - started,
            warn_hits=warn_hits,
        )
        return handle

    def _validate(
        self,
        validators: list[tuple[Validator, Severity]],
        handle: DataHandle,
        phase: str,
        metrics: StepMetrics,
    ) -> None:
        for validator, severity in validators:
            try:
                validator.validate(handle)
            except ValidationError as exc:
                if severity == "error":
                    raise ValidationError(
                        f"{self._name} {phase} failed: {exc}"
                    ) from exc
                # warn is the explicit escape hatch (ADR-0007): log it and
                # record it as a warn-hit so the run record names what was
                # tolerated, then continue.
                log.warning("%s %s warn: %s", self._name, phase, exc)
                metrics.warn_hits.append(str(exc))
