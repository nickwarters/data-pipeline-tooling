"""Public facade: composing, executing, and observing a pipeline.

The stable import surface for putting the pieces together and running them: the
deferred :class:`Pipeline` builder, the layer-composing builders
(``raw_to_silver`` / ``silver_to_gold`` / the current-grain reducers),
``ForEach`` orchestration, the thin domain ``PipelineRunner`` with its
``RunContext`` / freshness guard, and the ``RunLog`` / ``RunRegistry``
observability seam.

Import from here rather than the underlying modules::

    from framework.run import Pipeline, PipelineRunner, RunContext

The modules behind this facade (``framework.builder``, ``framework.silver``,
``framework.gold``, ``framework.orchestration``, ``framework.runner``,
``framework.run_context``, ``framework.run_log``, ``framework.run_registry``)
are internal layout: re-exports here are the public contract, the submodule
paths are not. See ``docs/public-api.md``.
"""

from framework.builder import Pipeline
from framework.gold import (
    current_silver_to_gold,
    detail_current_silver_to_gold,
    silver_to_gold,
)
from framework.orchestration import (
    ForEach,
    ForEachOutcome,
    ForEachPipelineError,
)
from framework.processors import Runnable
from framework.run_context import RunContext
from framework.run_log import RunLog
from framework.run_registry import RunRegistry
from framework.runner import (
    FreshnessError,
    FreshnessRequirement,
    PipelineRunner,
    UnknownPipelineError,
)
from framework.silver import raw_to_silver
from framework.stages import (
    CheckpointStage,
    ProcessingStage,
    Stage,
    ValidationStage,
)

__all__ = [
    # The builder + its contract
    "Pipeline",
    "Runnable",
    "Stage",
    "ValidationStage",
    "ProcessingStage",
    "CheckpointStage",
    # Layer-composing builders
    "raw_to_silver",
    "silver_to_gold",
    "current_silver_to_gold",
    "detail_current_silver_to_gold",
    # Repeated independent runs
    "ForEach",
    "ForEachOutcome",
    "ForEachPipelineError",
    # Thin domain orchestration + freshness
    "PipelineRunner",
    "RunContext",
    "FreshnessRequirement",
    "FreshnessError",
    "UnknownPipelineError",
    # Observability
    "RunLog",
    "RunRegistry",
]
