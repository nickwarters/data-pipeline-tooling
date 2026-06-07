"""The deferred fluent builder — describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a feed's reader, its validators and processors, and its
destination Writer without running anything. Execution
happens only at the ``.run()`` terminus, which owns the cross-cutting concerns
— timing, logging, lineage, error handling — for every stage. The builder makes
**no** write decisions: it hands the read ``Dataset`` to the composed Writer,
which owns its own location and load strategy (ADR-0003, ADR-0006).
"""

from __future__ import annotations

import logging
import time
from functools import partial

from framework.dataset import Dataset
from framework.processors import Processor
from framework.readers import Reader
from framework.run_context import RunContext
from framework.run_log import NULL_RUN_LOG, RunLog, StepMetrics
from framework.trace import RowTrace
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
        # `run_id` is the execution identity of the most recent `.run()` and
        # correlates every RunLog/RunRegistry record for that execution.
        self._run_log = run_log or NULL_RUN_LOG
        self.run_id: str | None = None
        # Validators are attached with their severity and run in attach order:
        # pre-validators gate the input, post-validators gate the output that is
        # about to be written.
        self._pre_validators: list[tuple[Validator, Severity]] = []
        self._post_validators: list[tuple[Validator, Severity]] = []
        # Stages are processors and checkpoints in attach order; they run
        # between pre- and post-validators. A "processor" stage transforms the
        # dataset; a "checkpoint" stage writes a snapshot and passes through.
        self._stages: list[tuple[str, Processor | Writer]] = []
        # Optional row-level quarantine (issue #50): value-rule-failing rows are
        # routed to the reject writer; good rows continue through the pipeline.
        self._quarantine_validator = None
        self._quarantine_writer: Writer | None = None
        # Optional row-level explainability: a per-row trace of why each
        # considered row survived or was excluded, routed to a caller-chosen table.
        self._explain_writer: Writer | None = None
        self._explain_id_column: str | None = None
        self._explain_score_column: str | None = None

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

    def with_processor(self, processor: Processor) -> "Pipeline":
        """Attach a processor (transforms the dataset mid-run). Deferred."""
        self._stages.append(("processor", processor))
        return self

    def quarantine(self, row_validator, reject_writer: Writer) -> "Pipeline":
        """Configure opt-in row-level quarantine. Deferred — nothing runs until .run().

        After pre-validation, value-rule-failing rows are routed to
        ``reject_writer`` with the current context's run metadata; good rows
        continue through the pipeline. Structural breaches (missing columns,
        wrong dtypes) still abort via the pre-validators — quarantine is only
        for value-rule breaches (ADR-0007 §2).
        """
        self._quarantine_validator = row_validator
        self._quarantine_writer = reject_writer
        return self

    def explain(
        self,
        writer: Writer,
        *,
        id_column: str,
        score_column: str | None = None,
    ) -> "Pipeline":
        """Configure row-level explainability. Deferred — nothing runs until .run().

        When configured, ``.run()`` follows each considered row (identified by
        ``id_column``) across the processor stages and writes a per-row verdict
        to ``writer``. Application code gives the trace its domain meaning by
        choosing the writer, table name, id column, and processor labels.
        """
        self._explain_writer = writer
        self._explain_id_column = id_column
        self._explain_score_column = score_column
        return self

    def checkpoint(self, writer: Writer) -> "Pipeline":
        """Attach a mid-run lineage write. Deferred — nothing runs until .run().

        The writer receives the current dataset at this point in the stage
        sequence and the dataset passes through unchanged so the pipeline
        continues. A checkpoint failure aborts the run (ADR-0007 fail-fast).
        """
        self._stages.append(("checkpoint", writer))
        return self

    def write_to(self, writer: Writer) -> "Pipeline":
        """Compose in the destination Writer. Deferred — nothing runs yet."""
        self._writer = writer
        return self

    def run(self, context: RunContext | None = None) -> Dataset:
        """Execute: read, validate, hand the dataset to the Writer, return it.

        Fail-fast and atomic (ADR-0007): an error-severity validator aborts the
        run *before* the Writer is called, so nothing partial lands; a
        warn-severity failure logs and continues. The write itself is a single
        SQLite transaction owned by the Writer. Returns the bulk-tier
        ``Dataset`` (ADR-0003).

        ``.run()`` is also the home of cross-cutting observability: it uses the
        supplied :class:`RunContext` or creates one for ad hoc builder execution.
        The context's execution id is exposed as :attr:`run_id` and drives the
        composed :class:`RunLog` per step plus a final ``run`` summary, so every
        record of this execution correlates and an abort is still recorded before
        it raises.
        """
        context = context or RunContext(pipeline=self._name, run_log=self._run_log)
        run_log = context.run_log if context.run_log is not NULL_RUN_LOG else self._run_log
        self.run_id = context.execution_id
        # Bind the per-run identity once so each step/summary call stays terse.
        step = partial(run_log.step, context.execution_id, self._name)
        record = partial(run_log.record, context.execution_id, self._name)
        started = time.perf_counter()
        warn_hits: list[str] = []
        try:
            with step("read") as metrics:
                dataset = self._reader.read()
                metrics.rows_out = len(dataset)

            with step("pre-validate", rows_in=len(dataset)) as metrics:
                self._validate(self._pre_validators, dataset, "pre-validate", metrics)
                metrics.rows_out = len(dataset)
            warn_hits += metrics.warn_hits

            # Quarantine (issue #50): row-level value-rule partitioning runs after
            # structural pre-validators (which abort on missing columns / wrong dtypes)
            # and before stages (processors/checkpoints on the clean subset).
            if self._quarantine_validator is not None:
                with step("quarantine", rows_in=len(dataset)) as metrics:
                    good, rejected = self._quarantine_validator.partition(dataset)
                    metrics.rows_out = len(good)
                    metrics.rows_quarantined = len(rejected)
                    if len(rejected) > 0 and self._quarantine_writer is not None:
                        stamped = rejected.with_columns(
                            run_id=context.logical_run_id,
                            logical_run_id=context.logical_run_id,
                            execution_id=context.execution_id,
                            load_date=context.load_date,
                        )
                        self._quarantine_writer.write(stamped)
                    dataset = good

            # Row-level explainability: when configured, seed the trace with the
            # considered population, then watch each processor stage.
            trace = None
            if self._explain_writer is not None:
                trace = RowTrace(
                    self._explain_id_column,
                    score_column=self._explain_score_column,
                )
                trace.consider(dataset)

            # Stages (processors and checkpoints) run in attach order between
            # the pre- and post-validators. Processors transform the dataset;
            # checkpoints snapshot it and pass it through unchanged. Both are
            # fail-fast (ADR-0007): a failure aborts the run before any write.
            checkpoint_idx = 0
            for kind, component in self._stages:
                if kind == "processor":
                    with step("process", rows_in=len(dataset)) as metrics:
                        before = dataset
                        dataset = component.process(dataset)  # type: ignore[union-attr]
                        metrics.rows_out = len(dataset)
                    if trace is not None:
                        trace.observe(
                            getattr(component, "trace_role", None),
                            getattr(component, "trace_name", type(component).__name__),
                            before,
                            dataset,
                        )
                else:
                    cp_name = f"checkpoint:{checkpoint_idx}"
                    with step(cp_name, rows_in=len(dataset)) as metrics:
                        component.write(dataset)  # type: ignore[union-attr]
                        metrics.rows_out = len(dataset)
                    checkpoint_idx += 1

            with step("post-validate", rows_in=len(dataset)) as metrics:
                self._validate(self._post_validators, dataset, "post-validate", metrics)
                metrics.rows_out = len(dataset)
            warn_hits += metrics.warn_hits

            # Explainability: the post-stage dataset contains the survivors, so
            # finalize the trace against it and land it through the configured writer.
            if trace is not None:
                with step("explain", rows_in=trace.considered) as metrics:
                    self._explain_writer.write(trace.finalize(dataset))
                    metrics.rows_out = trace.selected
                    metrics.rows_excluded = trace.excluded

            if self._writer is not None:
                with step("write", rows_in=len(dataset)) as metrics:
                    self._writer.write(dataset)
                    metrics.rows_out = len(dataset)
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
            context.mark_run_summary_recorded()
            raise

        record(
            "run",
            "ok",
            rows_in=len(dataset),
            rows_out=len(dataset),
            duration=time.perf_counter() - started,
            warn_hits=warn_hits,
        )
        context.mark_run_summary_recorded()
        return dataset

    def _validate(
        self,
        validators: list[tuple[Validator, Severity]],
        dataset: Dataset,
        phase: str,
        metrics: StepMetrics,
    ) -> None:
        for validator, severity in validators:
            try:
                validator.validate(dataset)
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
