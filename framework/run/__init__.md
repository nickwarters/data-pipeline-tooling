```python
"""Public facade: composing, executing, and observing a pipeline.

The stable import surface for putting the pieces together and running them: the
deferred :class:`Pipeline` builder, ``ForEach`` orchestration, scheduled
``PipelineSet`` orchestration through ``Orchestrator``, the thin domain
``PipelineRunner`` with its ``RunContext`` / freshness guard, and the ``RunLog``
/ ``RunRegistry`` observability types. Medallion recipe helpers are re-exported
here for compatibility; their implementation home is ``framework.recipes``.

Import from here rather than the underlying modules::

    from framework.run import Pipeline, PipelineRunner, RunContext

The modules behind this facade (``framework.run.builder``,
``framework.run.stages``, ``framework.run.execution``,
``framework.run.pipeline_steps``, ``framework.run.orchestration``,
``framework.run.runner``, ``framework.run.run_context``, ``framework.run.run_log``,
``framework.run.run_registry``) are internal layout: re-exports here are the
public contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.run.builder import Pipeline
from framework.recipes.medallion import (
    current_silver_to_gold,
    detail_current_silver_to_gold,
    raw_to_silver,
    silver_to_gold,
)
from framework.run.orchestration import (
    DayOfMonth,
    ForEach,
    ForEachOutcome,
    ForEachPipelineError,
    LastWorkingDayOfMonth,
    ManualOnly,
    NthWorkingDayOfMonth,
    OrchestrationDecision,
    OrchestrationPassResult,
    OrchestrationStore,
    Orchestrator,
    PipelineSet,
    ScheduledPipeline,
    SpecificWeekdays,
    Weekdays,
)
from framework.run.run_context import RunContext
from framework.run.run_log import RunLog
from framework.run.run_registry import RunRegistry
from framework.run.runner import (
    FreshnessError,
    FreshnessRequirement,
    PipelineRunner,
    UnknownPipelineError,
    run_pipeline,
)
from framework.run.stages import (
    CheckpointStage,
    ProcessingStage,
    ValidationStage,
)

__all__ = [
    "Pipeline",
    "ValidationStage",
    "ProcessingStage",
    "CheckpointStage",
    "raw_to_silver",
    "silver_to_gold",
    "current_silver_to_gold",
    "detail_current_silver_to_gold",
    "ForEach",
    "ForEachOutcome",
    "ForEachPipelineError",
    "PipelineSet",
    "ScheduledPipeline",
    "Weekdays",
    "SpecificWeekdays",
    "DayOfMonth",
    "NthWorkingDayOfMonth",
    "LastWorkingDayOfMonth",
    "ManualOnly",
    "Orchestrator",
    "OrchestrationDecision",
    "OrchestrationPassResult",
    "OrchestrationStore",
    "PipelineRunner",
    "run_pipeline",
    "RunContext",
    "FreshnessRequirement",
    "FreshnessError",
    "UnknownPipelineError",
    "RunLog",
    "RunRegistry",
]

```
