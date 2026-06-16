```python
"""The deferred fluent builder: describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a feed's reader, its validators and processors, and its
destination Writer without running anything. Execution
happens only at the ``.run()`` terminus, which owns the cross-cutting concerns
of timing, logging, lineage, and error handling. The builder makes no write
decisions: it hands the read ``Dataset`` to the composed Writer, which owns its
own location and load strategy.
"""

from __future__ import annotations

import logging
import time

from framework._internal.describe import component_summary
from framework.core.protocols import Processor, Reader, Severity, Validator, Writer
from framework.core.dataset import Dataset
from framework.run.execution import PipelineExecution
from framework.run.pipeline_steps import (
    CheckpointStep,
    ExplainWriteStep,
    PipelineStep,
    ProcessorStageStep,
    QuarantineStep,
    ReadStep,
    TraceStartStep,
    ValidatorStep,
    WriteStep,
    ordered,
)
from framework.run.run_context import RunContext
from framework.run.run_log import NULL_RUN_LOG, RunLog
from framework.run.stages import (
    CheckpointStage,
    ProcessingStage,
    Stage,
    ValidationStage,
)

log = logging.getLogger(__name__)


class Pipeline:
    """A deferred pipeline for one feed: read, then hand off to a Writer."""

    def __init__(
        self, name: str, reader: Reader, run_log: RunLog | None = None
    ) -> None:
        # `name` labels the feed/pipeline; it is not a write decision because
        # the Writer owns the target table.
        self._name = name
        self._reader = reader
        self._writer: Writer | None = None
        # When no run log is composed, a null sink keeps `.run()` branch-free.
        # `run_id` is the execution identity of the most recent `.run()` and
        # correlates every RunLog/RunRegistry record for that execution.
        self._run_log = run_log or NULL_RUN_LOG
        self.run_id: str | None = None
        # Validators are attached with their severity and run in attach order:
        # pre-validators gate the input, post-validators gate the output that is
        # about to be written.
        self._pre_validators: list[tuple[Validator, Severity]] = []
        self._post_validators: list[tuple[Validator, Severity]] = []
        # Stages run in attach order between the read and final write.
        self._stages: list[Stage] = []
        # Value-rule-failing rows are routed to the reject writer; good rows
        # continue through the pipeline.
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
        """Attach a pre-validator for the input dataset."""
        self._pre_validators.append((validator, severity))
        return self

    def with_post_validator(
        self, validator: Validator, severity: Severity = "error"
    ) -> "Pipeline":
        """Attach a post-validator for the output dataset."""
        self._post_validators.append((validator, severity))
        return self

    def add_stage(self, stage: Stage) -> "Pipeline":
        """Append an ordered stage."""
        self._stages.append(stage)
        return self

    def with_processor(self, processor: Processor) -> "Pipeline":
        """Attach a processor that transforms the dataset mid-run."""
        self.add_stage(ProcessingStage(name="process", processors=[processor]))
        return self

    def quarantine(self, row_validator, reject_writer: Writer) -> "Pipeline":
        """Configure opt-in row-level quarantine.

        After pre-validation, value-rule-failing rows are routed to
        ``reject_writer`` with the current context's run metadata; good rows
        continue through the pipeline. Structural breaches (missing columns,
        wrong dtypes) still abort via the pre-validators — quarantine is only
        for value-rule breaches.
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
        """Configure row-level explainability.

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
        """Attach a mid-run lineage write.

        The writer receives the current dataset at this point in the stage
        sequence and the dataset passes through unchanged so the pipeline
        continues. A checkpoint failure aborts the run.
        """
        name = f"checkpoint:{self._checkpoint_count()}"
        self.add_stage(CheckpointStage(name=name, writer=writer))
        return self

    def write_to(self, writer: Writer) -> "Pipeline":
        """Compose in the destination Writer."""
        self._writer = writer
        return self

    def describe(self) -> str:
        """Return a human-readable plan of the deferred run.

        The plan is an authoring/debugging aid: it reports the components that
        will participate in execution, in execution order, without touching the
        Reader, processors, checkpoints, or Writer. Each step renders its own
        entry via ``plan_entry()``; absent/empty steps return ``None`` and are
        omitted (no ``none`` placeholders). The builder never introspects a
        component's attributes, so a value stored under any name cannot leak
        into the plan (credentials are self-redacted by the component).
        """
        plan = self._execution_plan()
        lines = [f"Pipeline {self._name}"]
        for step in plan:
            entry = step.plan_entry()
            if entry is not None:
                lines.append(entry)
        if self._run_log is not NULL_RUN_LOG:
            lines.append(f"  run-log: {component_summary(self._run_log)}")
        return "\n".join(lines)

    def _execution_plan(self) -> list[PipelineStep]:
        """Build the ordered internal step plan used by ``describe`` and ``run``."""
        steps: list[PipelineStep] = [
            ReadStep(self._reader),
            ValidatorStep(name="pre-validate", validators=self._pre_validators),
        ]
        if self._quarantine_validator is not None:
            steps.append(
                QuarantineStep(self._quarantine_validator, self._quarantine_writer)
            )
        if self._explain_writer is not None:
            steps.append(
                TraceStartStep(
                    id_column=self._explain_id_column,
                    score_column=self._explain_score_column,
                )
            )

        for stage in self._stages:
            steps.append(_compile_stage(stage))

        steps.append(
            ValidatorStep(name="post-validate", validators=self._post_validators)
        )
        if self._explain_writer is not None:
            steps.append(ExplainWriteStep(self._explain_writer))
        if self._writer is not None:
            steps.append(WriteStep(self._writer))
        return ordered(steps)

    def _checkpoint_count(self) -> int:
        return sum(1 for stage in self._stages if isinstance(stage, CheckpointStage))

    def run(self, context: RunContext | None = None) -> Dataset:
        """Execute: read, validate, hand the dataset to the Writer, return it.

        Fail-fast and atomic: an error-severity validator aborts the run
        *before* the Writer is called, so nothing partial lands; a warn-severity
        failure logs and continues. The write itself is a single SQLite
        transaction owned by the Writer. Returns the bulk-tier ``Dataset``.

        ``.run()`` is also the home of cross-cutting observability: it uses the
        supplied :class:`RunContext` or creates one for ad hoc builder execution.
        The context's execution id is exposed as :attr:`run_id` and drives the
        composed :class:`RunLog` per step plus a final ``run`` summary, so every
        record of this execution correlates and an abort is still recorded before
        it raises.
        """
        context = context or RunContext(pipeline=self._name, run_log=self._run_log)
        run_log = (
            context.run_log if context.run_log is not NULL_RUN_LOG else self._run_log
        )
        self.run_id = context.execution_id
        session = PipelineExecution(
            pipeline_name=self._name,
            context=context,
            run_log=run_log,
        )
        started = time.perf_counter()
        dataset: Dataset | None = None
        try:
            for plan_step in self._execution_plan():
                dataset = plan_step.execute(dataset, session)
        except Exception as exc:
            # The failing step already logged its own `error` record; the run
            # summary closes the run as aborted before the exception propagates.
            session.record(
                "run",
                "error",
                duration=time.perf_counter() - started,
                errors=[str(exc)],
            )
            context.mark_run_summary_recorded()
            raise

        assert dataset is not None
        session.record(
            "run",
            "ok",
            rows_in=len(dataset),
            rows_out=len(dataset),
            duration=time.perf_counter() - started,
            warn_hits=session.warn_hits,
        )
        context.mark_run_summary_recorded()
        return dataset


def _compile_stage(stage: Stage) -> PipelineStep:
    if isinstance(stage, ValidationStage):
        return ValidatorStep(name=stage.name, validators=stage.validators)
    if isinstance(stage, ProcessingStage):
        return ProcessorStageStep(name=stage.name, processors=stage.processors)
    if isinstance(stage, CheckpointStage):
        return CheckpointStep(name=stage.name, writer=stage.writer)
    raise TypeError(f"unknown stage type {type(stage).__name__}")

```
