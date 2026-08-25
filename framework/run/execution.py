"""Execution state for one deferred ``Pipeline`` run."""

from __future__ import annotations

from functools import partial
from typing import Any

from framework.run.run_context import RunContext
from framework.run.trace import RowTrace
from tools.observability.run_log import RunLog


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
        self.step = partial(
            run_log.step,
            context.pipeline_run_id,
            pipeline_name,
            logical_run_id=context.logical_run_id,
        )

    def record(self, step: str, status: str, **fields: Any) -> None:
        """Emit one run-log record for ``step``."""
        self.run_log.record(
            self.context.pipeline_run_id,
            self.pipeline_name,
            step,
            status,
            logical_run_id=self.context.logical_run_id,
            **fields,
        )

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
                with self.step(f"dependency:{name}") as metrics:
                    dataset = read()
                    metrics.rows_out = len(dataset)
