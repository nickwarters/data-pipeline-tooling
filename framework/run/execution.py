"""Execution state for one deferred ``Pipeline`` run."""

from __future__ import annotations

import logging
from functools import partial
from typing import ContextManager

from framework.core.protocols import Severity, Validator
from framework.core.dataset import Dataset
from framework.run.run_context import RunContext
from framework.run.run_log import RunLog, StepMetrics
from framework.run.trace import RowTrace
from framework.validate.validators import ValidationError

log = logging.getLogger(__name__)


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
                read = getattr(dependency, "read", None)
                if not callable(read):
                    continue
                identity = id(dependency)
                if identity in seen or getattr(dependency, "materialized", False):
                    seen.add(identity)
                    continue
                seen.add(identity)
                name = getattr(dependency, "name", "dependency")
                with self.timed_step(f"dependency:{name}") as metrics:
                    dataset = read()
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
