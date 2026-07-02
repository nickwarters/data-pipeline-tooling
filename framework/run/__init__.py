"""Public facade: composing, executing, and observing a pipeline.

The stable import surface for putting the pieces together and running them: the
deferred :class:`Pipeline` builder, stable ``RunAddress`` dependency labels,
the thin domain ``PipelineRunner`` with its ``RunContext`` / freshness guard,
and the ``RunLog`` / ``RunRegistry`` observability types.

Import from here rather than the underlying modules::

    from framework.run import Pipeline, PipelineRunner, RunAddress, RunContext

The modules behind this facade (``framework.run.builder``,
``framework.run.address``,
``framework.run.execution``,
``framework.run.pipeline_steps``, ``framework.run.runner``,
``framework.run.run_context``, ``framework.run.run_log``,
``framework.run.run_registry``) are internal layout: re-exports here are the
public contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.run.address import RunAddress, RunAddressError
from framework.run.builder import Pipeline
from framework.run.dry_run import DryRunReport
from framework.run.run_context import RunContext
from framework.run.runner import (
    FreshnessError,
    FreshnessRequirement,
    LoadedPipeline,
    PipelineRunner,
    Requirement,
    UnknownPipelineError,
    dry_run_pipeline,
    load_pipeline,
    run_pipeline,
)
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry

__all__ = [
    "Pipeline",
    "RunAddress",
    "RunAddressError",
    "PipelineRunner",
    "run_pipeline",
    "load_pipeline",
    "LoadedPipeline",
    "dry_run_pipeline",
    "DryRunReport",
    "RunContext",
    "RunLog",
    "RunRegistry",
    "Requirement",
    "FreshnessRequirement",
    "FreshnessError",
    "UnknownPipelineError",
]
