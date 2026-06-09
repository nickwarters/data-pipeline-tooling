"""Public ordered stages for a single-feed ``Pipeline`` run.

A stage is one position-sensitive operation over the current ``Dataset``. It
receives the dataset produced by the previous step and returns the dataset for
the next step. Stages are still inside one class-level ``Pipeline`` run:
``Reader -> Dataset -> Stage* -> Writer``.
"""

from __future__ import annotations

import logging
from typing import Iterable, Protocol, Sequence, runtime_checkable

from framework.dataset import Dataset
from framework.pipeline_steps import (
    CheckpointStep,
    PipelineStep,
    ProcessorStageStep,
    ValidatorStep,
)
from framework.processors import Processor
from framework.validators import Severity, ValidationError, Validator
from framework.writers import Writer

log = logging.getLogger(__name__)


@runtime_checkable
class Stage(Protocol):
    """A supported ordered operation inside one ``Pipeline`` run."""

    name: str

    def apply(self, dataset: Dataset) -> Dataset:
        """Return the dataset that should continue to the next stage."""
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

    def apply(self, dataset: Dataset) -> Dataset:
        for validator, severity in self.validators:
            try:
                validator.validate(dataset)
            except ValidationError:
                if severity == "error":
                    raise
                log.warning("%s warn: validator failed", self.name, exc_info=True)
        return dataset

    def to_pipeline_step(self) -> PipelineStep:
        return ValidatorStep(name=self.name, validators=self.validators)


class ProcessingStage:
    """Run one or more processors at this exact point in a pipeline."""

    def __init__(self, *, name: str, processors: Sequence[Processor]) -> None:
        self.name = name
        self.processors = list(processors)
        if not self.processors:
            raise ValueError("ProcessingStage requires at least one processor")

    def apply(self, dataset: Dataset) -> Dataset:
        current = dataset
        for processor in self.processors:
            current = processor.process(current)
        return current

    def to_pipeline_step(self) -> PipelineStep:
        return ProcessorStageStep(name=self.name, processors=self.processors)


class CheckpointStage:
    """Write the current dataset as an explicit side effect, then pass it on."""

    def __init__(self, *, name: str, writer: Writer) -> None:
        self.name = name
        self.writer = writer

    def apply(self, dataset: Dataset) -> Dataset:
        self.writer.write(dataset)
        return dataset

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
