```python
"""Ordered stages — the authoring vocabulary for one single-feed ``Pipeline`` run.

A stage is one position-sensitive operation a caller composes into the middle of
a run via ``.add_stage(...)`` (or the ``.with_processor`` / ``.checkpoint``
shorthands). Stages are **specs, not executors**: each compiles to an internal
:class:`~framework.run.pipeline_steps.PipelineStep` through ``to_pipeline_step()``,
and ``.run()`` executes that one ordered step plan. A stage's behaviour, timing,
and row-trace observation live in its Step, with no second execution path.
Stages stay inside one class-level ``Pipeline`` run:
``Reader -> Dataset -> Stage* -> Writer``. The dataset->dataset *transform*
extension point is :class:`~framework.transform.processors.Processor`, not a
custom Stage.
"""

from __future__ import annotations

from typing import Iterable, Protocol, Sequence, runtime_checkable

from framework.core.protocols import Severity, Validator, Writer


@runtime_checkable
class Stage(Protocol):
    """A composed ordered operation in a pipeline authoring plan."""

    name: str


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


class ProcessingStage:
    """Run one or more processors at this exact point in a pipeline."""

    def __init__(self, *, name: str, processors: Sequence[Processor]) -> None:
        self.name = name
        self.processors = list(processors)
        if not self.processors:
            raise ValueError("ProcessingStage requires at least one processor")


class CheckpointStage:
    """Write the current dataset as an explicit side effect, then pass it on."""

    def __init__(self, *, name: str, writer: Writer) -> None:
        self.name = name
        self.writer = writer


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

```
