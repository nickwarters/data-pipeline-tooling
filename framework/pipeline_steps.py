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
from framework.describe import component_summary
from framework.processors import JoinDependency
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

    def plan_entry(self) -> str | None:
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

    def materialize_dependencies(self, processors: list[object]) -> None:
        seen: set[int] = set()
        for processor in processors:
            dependencies = getattr(processor, "dependencies", [])
            for dependency in dependencies:
                if not isinstance(dependency, JoinDependency):
                    continue
                identity = id(dependency)
                if identity in seen or dependency.materialized:
                    seen.add(identity)
                    continue
                seen.add(identity)
                with self.timed_step(f"dependency:{dependency.name}") as metrics:
                    dataset = dependency.read()
                    metrics.rows_out = len(dataset)

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

    def plan_entry(self) -> str:
        return f"  read: {component_summary(self.reader)}"

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        with session.timed_step(self.name) as metrics:
            result = self.reader.read()
            _drain_retry_attempts(self.reader, metrics)
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

    def plan_entry(self) -> str | None:
        if not self.validators:
            return None
        if len(self.validators) == 1:
            v, sev = self.validators[0]
            return f"  {self.name}: {component_summary(v)} severity={sev}"
        lines = [f"  {self.name}:"]
        for v, sev in self.validators:
            lines.append(f"    - {component_summary(v)} severity={sev}")
        return "\n".join(lines)

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

    def plan_entry(self) -> str:
        return (
            f"  quarantine: {component_summary(self.row_validator)}"
            f" -> {component_summary(self.reject_writer)}"
        )

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

    def plan_entry(self) -> str:
        parts = [f"id_column={self.id_column!r}"]
        if self.score_column is not None:
            parts.append(f"score_column={self.score_column!r}")
        return f"  explain-trace: {', '.join(parts)}"

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        trace = RowTrace(self.id_column, score_column=self.score_column)
        trace.consider(dataset)
        session.trace = trace
        return dataset


@dataclass(frozen=True)
class ProcessorStageStep(PipelineStep):
    processors: list[object] = None

    def __init__(self, *, name: str, processors: list[object]) -> None:
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "kind", "processor")
        object.__setattr__(self, "order", -1)
        component = processors[0] if len(processors) == 1 else processors
        object.__setattr__(self, "component", component)
        object.__setattr__(self, "read_only", False)
        object.__setattr__(self, "side_effect", False)
        object.__setattr__(self, "processors", processors)

    def plan_entry(self) -> str:
        return f"  {self.name}: {component_summary(self.component)}"

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        current = dataset
        session.materialize_dependencies(self.processors)
        with session.timed_step(self.name, rows_in=len(dataset)) as metrics:
            for processor in self.processors:
                before = current
                current = processor.process(current)
                if session.trace is not None:
                    session.trace.observe(
                        getattr(processor, "trace_role", None),
                        getattr(processor, "trace_name", type(processor).__name__),
                        before,
                        current,
                    )
            metrics.rows_out = len(current)
        return current


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

    def plan_entry(self) -> str:
        label = self.name.split(":")[0]
        return f"  {label}: {component_summary(self.component)}"

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

    def plan_entry(self) -> str:
        return f"  explain: writer={component_summary(self.component)}"

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

    def plan_entry(self) -> str:
        return f"  write: {component_summary(self.component)}"

    def execute(
        self, dataset: Dataset | None, session: PipelineExecution
    ) -> Dataset:
        assert dataset is not None
        with session.timed_step(self.name, rows_in=len(dataset)) as metrics:
            self.writer.write(dataset)
            _drain_retry_attempts(self.writer, metrics)
            metrics.rows_out = len(dataset)
            return dataset


def _drain_retry_attempts(component: object, metrics: StepMetrics) -> None:
    """Surface a retrying reader/writer's attempts as this step's warn_hits.

    A :class:`~framework.retry.RetryingReader` / ``RetryingWriter`` collects a
    human note per retried attempt on ``retry_attempts``; draining them onto the
    open step's metrics records the attempts on the same correlated read/write
    record whose status already carries the final outcome. Duck-typed so this
    module stays free of any retry dependency.
    """
    attempts = getattr(component, "retry_attempts", None)
    if attempts:
        metrics.warn_hits.extend(attempts)


def ordered(steps: list[PipelineStep]) -> list[PipelineStep]:
    """Stamp steps with their position in the execution plan."""
    return [step.at(order) for order, step in enumerate(steps)]
