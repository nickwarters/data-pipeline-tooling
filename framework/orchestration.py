"""Small orchestration helpers that sit outside the Pipeline builder."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import TypeVar

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.run_context import RunContext

Item = TypeVar("Item")


BuildPipeline = Callable[[Item, RunContext], Pipeline]
LogicalRunId = Callable[[Item, int, RunContext], str]


class ForEachPipelineError(RuntimeError):
    """Raised when one item in a for-each orchestration fails."""


def run_for_each(
    items: Iterable[Item],
    build_pipeline: BuildPipeline[Item],
    *,
    context: RunContext | None = None,
    logical_run_id: LogicalRunId[Item] | None = None,
) -> list[Dataset]:
    """Run a freshly built Pipeline for each item and return the results."""
    parent_context = context or RunContext()
    results: list[Dataset] = []
    for index, item in enumerate(items):
        item_context = _item_context(item, index, parent_context, logical_run_id)
        try:
            pipeline = build_pipeline(item, item_context)
            results.append(pipeline.run(context=item_context))
        except Exception as exc:
            raise ForEachPipelineError(f"for-each item failed: {item!r}") from exc
    return results


def _item_context(
    item: Item,
    index: int,
    parent_context: RunContext,
    logical_run_id: LogicalRunId[Item] | None,
) -> RunContext:
    item_logical_run_id = (
        logical_run_id(item, index, parent_context)
        if logical_run_id is not None
        else f"{parent_context.logical_run_id}:{index}"
    )
    return RunContext(
        run_date=parent_context.run_date,
        logical_run_id=item_logical_run_id,
        load_date=parent_context.load_date,
        run_log=parent_context.run_log,
        run_registry=parent_context.run_registry,
        base_dir=parent_context.base_dir,
        case_type=parent_context.case_type,
        pipeline=parent_context.pipeline,
        freshness_days=parent_context.freshness_days,
    )
