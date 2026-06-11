"""Ordered stages — the authoring vocabulary for one single-feed ``Pipeline`` run.

A stage is one position-sensitive operation a caller composes into the middle of
a run via ``.add_stage(...)`` (or the ``.with_processor`` / ``.checkpoint``
shorthands). Stages are **specs, not executors**: each compiles to an internal
:class:`~framework.pipeline_steps.PipelineStep` through ``to_pipeline_step()``,
and ``.run()`` executes that one ordered step plan. A stage's behaviour, timing,
and row-trace observation live in its Step, with no second execution path.
Stages stay inside one class-level ``Pipeline`` run:
``Reader -> Dataset -> Stage* -> Writer``. The dataset->dataset *transform*
extension point is :class:`~framework.processors.Processor`, not a custom Stage.
"""

from __future__ import annotations

from typing import Iterable, Protocol, Sequence, runtime_checkable

from framework.pipeline_steps import (
    CheckpointStep,
    PipelineStep,
    ProcessorStageStep,
    ValidatorStep,
)
from framework.processors import Processor
from framework.validators import Severity, Validator
from framework.writers import Writer


@runtime_checkable
class Stage(Protocol):
    """A composed ordered operation that compiles to an executable step.

    Internal: the concrete stages below are the public authoring vocabulary; this
    protocol is the shared shape the builder composes and converts. A stage owns
    no execution — it returns the :class:`~framework.pipeline_steps.PipelineStep`
    that does.
    """

    name: str

    def to_pipeline_step(self) -> PipelineStep:
        """Return the executable step this stage compiles to."""
        ...


class ValidationStage:
    """Run one or more validators at this exact point in a pipeline."""

    def __init__(
        self,
        *,
        name: str,
        validators: Iterable[Validator | tuple[Validator, Severity]],
        severity: Severity = "error",
    ) -> None:
        self.name = name
        self.validators = _normalise_validators(validators, severity)
        if not self.validators:
            raise ValueError("ValidationStage requires at least one validator")

    def to_pipeline_step(self) -> PipelineStep:
        return ValidatorStep(name=self.name, validators=self.validators)


class ProcessingStage:
    """Run one or more processors at this exact point in a pipeline."""

    def __init__(self, *, name: str, processors: Sequence[Processor]) -> None:
        self.name = name
        self.processors = list(processors)
        if not self.processors:
            raise ValueError("ProcessingStage requires at least one processor")

    def to_pipeline_step(self) -> PipelineStep:
        return ProcessorStageStep(name=self.name, processors=self.processors)


class CheckpointStage:
    """Write the current dataset as an explicit side effect, then pass it on."""

    def __init__(self, *, name: str, writer: Writer) -> None:
        self.name = name
        self.writer = writer

    def to_pipeline_step(self) -> PipelineStep:
        return CheckpointStep(name=self.name, writer=self.writer)


def _normalise_validators(
    validators: Iterable[Validator | tuple[Validator, Severity]],
    default_severity: Severity,
) -> list[tuple[Validator, Severity]]:
    normalised: list[tuple[Validator, Severity]] = []
    for validator in validators:
        if isinstance(validator, tuple):
            normalised.append(validator)
        else:
            normalised.append((validator, default_severity))
    return normalised
