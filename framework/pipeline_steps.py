"""Internal execution steps for the deferred ``Pipeline`` builder.

The public builder keeps the fluent authoring API; this module gives a run an
inspectable, ordered plan of small steps that each own one execution concern.
"""

from __future__ import annotations

import logging
from copy import copy
from dataclasses import dataclass
from functools import partial
from typing import ContextManager, Literal

from framework.dataset import Dataset
from framework.run_context import RunContext
from framework.run_log import RunLog, StepMetrics
from framework.trace import RowTrace
from framework.validators import Severity, ValidationError, Validator

log = logging.getLogger(__name__)

StepKind = Literal[
    "read",
    "validator",
    "quarantine",
    "trace",
    "processor",
    "checkpoint",
    "explain",
    "write",
]


@dataclass(frozen=True)
class PipelineStep:
    """One planned step in a single-feed/table builder run."""

    name: str
    kind: StepKind
    order: int
    component: object | None = None
    read_only: bool = True
    side_effect: bool = False

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset | None:
        raise NotImplementedError

    def at(self, order: int) -> "PipelineStep":
        """Return this step stamped with its execution order."""
        stamped = copy(self)
        object.__setattr__(stamped, "order", order)
        return stamped


class PipelineExecution:
    """Mutable state for one ``Pipeline.run()`` execution."""

    def __init__(
        self,
        *,
        pipeline_name: str,
        context: RunContext,
        run_log: RunLog,
    ) -> None:
        self.pipeline_name = pipeline_name
        self.context = context
        self.run_log = run_log
        self.warn_hits: list[str] = []
        self.trace: RowTrace | None = None
        self.step = partial(run_log.step, context.execution_id, pipeline_name)
        self.record = partial(run_log.record, context.execution_id, pipeline_name)

    def timed_step(
        self, name: str, rows_in: int | None = None
    ) -> ContextManager[StepMetrics]:
        return self.step(name, rows_in=rows_in)

    def validate(
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
                        f"{self.pipeline_name} {phase} failed: {exc}"
                    ) from exc
                log.warning("%s %s warn: %s", self.pipeline_name, phase, exc)
                metrics.warn_hits.append(str(exc))


@dataclass(frozen=True)
class ReadStep(PipelineStep):
    reader: object = None

    def __init__(self, reader: object) -> None:
        object.__setattr__(self, "name", "read")
        object.__setattr__(self, "kind", "read")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", reader)
        object.__setattr__(self, "read_only", True)
        object.__setattr__(self, "side_effect", False)
        object.__setattr__(self, "reader", reader)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        with session.timed_step(self.name) as metrics:
            result = self.reader.read()
            metrics.rows_out = len(result)
            return result


@dataclass(frozen=True)
class ValidatorStep(PipelineStep):
    validators: list[tuple[Validator, Severity]] = None

    def __init__(
        self,
        *,
        name: str,
        validators: list[tuple[Validator, Severity]],
    ) -> None:
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "kind", "validator")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", None)
        object.__setattr__(self, "read_only", True)
        object.__setattr__(self, "side_effect", False)
        object.__setattr__(self, "validators", validators)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        with session.timed_step(self.name, rows_in=len(dataset)) as metrics:
            session.validate(self.validators, dataset, self.name, metrics)
            metrics.rows_out = len(dataset)
        session.warn_hits += metrics.warn_hits
        return dataset


@dataclass(frozen=True)
class QuarantineStep(PipelineStep):
    row_validator: object = None
    reject_writer: object = None

    def __init__(self, row_validator: object, reject_writer: object) -> None:
        object.__setattr__(self, "name", "quarantine")
        object.__setattr__(self, "kind", "quarantine")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", row_validator)
        object.__setattr__(self, "read_only", False)
        object.__setattr__(self, "side_effect", True)
        object.__setattr__(self, "row_validator", row_validator)
        object.__setattr__(self, "reject_writer", reject_writer)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        with session.timed_step(self.name, rows_in=len(dataset)) as metrics:
            good, rejected = self.row_validator.partition(dataset)
            metrics.rows_out = len(good)
            metrics.rows_quarantined = len(rejected)
            if len(rejected) > 0 and self.reject_writer is not None:
                stamped = rejected.with_columns(
                    run_id=session.context.logical_run_id,
                    logical_run_id=session.context.logical_run_id,
                    execution_id=session.context.execution_id,
                    load_date=session.context.load_date,
                )
                self.reject_writer.write(stamped)
            return good


@dataclass(frozen=True)
class TraceStartStep(PipelineStep):
    id_column: str = ""
    score_column: str | None = None

    def __init__(self, *, id_column: str, score_column: str | None) -> None:
        object.__setattr__(self, "name", "explain:trace")
        object.__setattr__(self, "kind", "trace")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", None)
        object.__setattr__(self, "read_only", True)
        object.__setattr__(self, "side_effect", False)
        object.__setattr__(self, "id_column", id_column)
        object.__setattr__(self, "score_column", score_column)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        trace = RowTrace(self.id_column, score_column=self.score_column)
        trace.consider(dataset)
        session.trace = trace
        return dataset


@dataclass(frozen=True)
class ProcessorStep(PipelineStep):
    processor: object = None

    def __init__(self, processor: object) -> None:
        object.__setattr__(self, "name", "process")
        object.__setattr__(self, "kind", "processor")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", processor)
        object.__setattr__(self, "read_only", False)
        object.__setattr__(self, "side_effect", False)
        object.__setattr__(self, "processor", processor)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        with session.timed_step(self.name, rows_in=len(dataset)) as metrics:
            before = dataset
            result = self.processor.process(dataset)
            metrics.rows_out = len(result)
        if session.trace is not None:
            session.trace.observe(
                getattr(self.processor, "trace_role", None),
                getattr(self.processor, "trace_name", type(self.processor).__name__),
                before,
                result,
            )
        return result


@dataclass(frozen=True)
class CheckpointStep(PipelineStep):
    writer: object = None

    def __init__(self, *, name: str, writer: object) -> None:
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "kind", "checkpoint")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", writer)
        object.__setattr__(self, "read_only", True)
        object.__setattr__(self, "side_effect", True)
        object.__setattr__(self, "writer", writer)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        with session.timed_step(self.name, rows_in=len(dataset)) as metrics:
            self.writer.write(dataset)
            metrics.rows_out = len(dataset)
            return dataset


@dataclass(frozen=True)
class ExplainWriteStep(PipelineStep):
    writer: object = None

    def __init__(self, writer: object) -> None:
        object.__setattr__(self, "name", "explain")
        object.__setattr__(self, "kind", "explain")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", writer)
        object.__setattr__(self, "read_only", True)
        object.__setattr__(self, "side_effect", True)
        object.__setattr__(self, "writer", writer)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        assert session.trace is not None
        with session.timed_step(self.name, rows_in=session.trace.considered) as metrics:
            self.writer.write(session.trace.finalize(dataset))
            metrics.rows_out = session.trace.selected
            metrics.rows_excluded = session.trace.excluded
            return dataset


@dataclass(frozen=True)
class WriteStep(PipelineStep):
    writer: object = None

    def __init__(self, writer: object) -> None:
        object.__setattr__(self, "name", "write")
        object.__setattr__(self, "kind", "write")
        object.__setattr__(self, "order", -1)
        object.__setattr__(self, "component", writer)
        object.__setattr__(self, "read_only", True)
        object.__setattr__(self, "side_effect", True)
        object.__setattr__(self, "writer", writer)

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        with session.timed_step(self.name, rows_in=len(dataset)) as metrics:
            self.writer.write(dataset)
            metrics.rows_out = len(dataset)
            return dataset


def ordered(steps: list[PipelineStep]) -> list[PipelineStep]:
    """Stamp steps with their position in the execution plan."""
    return [step.at(order) for order, step in enumerate(steps)]
