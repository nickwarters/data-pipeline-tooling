"""Public facade: composing, executing, and observing a pipeline.

The stable import surface for putting the pieces together and running them: the
deferred :class:`Pipeline` builder, the thin domain
``PipelineRunner`` with its ``RunContext`` / freshness guard, and the ``RunLog``
/ ``RunRegistry`` observability types.

Import from here rather than the underlying modules::

    from framework.run import Pipeline, PipelineRunner, RunContext

The modules behind this facade (``framework.run.builder``,
``framework.run.execution``,
``framework.run.pipeline_steps``, ``framework.run.runner``,
``framework.run.run_context``, ``framework.run.run_log``,
``framework.run.run_registry``) are internal layout: re-exports here are the
public contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.run.builder import Pipeline
from framework.run.run_context import RunContext
from framework.run.runner import (
    FreshnessError,
    FreshnessRequirement,
    PipelineRunner,
    UnknownPipelineError,
    run_pipeline,
)
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry

__all__ = [
    "Pipeline",
    "PipelineRunner",
    "run_pipeline",
    "RunContext",
    "RunLog",
    "RunRegistry",
    "FreshnessRequirement",
    "FreshnessError",
    "UnknownPipelineError",
]
