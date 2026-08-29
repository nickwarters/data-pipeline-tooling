"""Public facade: composing, executing, and observing a pipeline.

The stable import surface for putting the pieces together and running them: the
**eager steps** (``read`` / ``transform`` / ``validate`` / ``write`` and
friends), the deferred :class:`Pipeline` builder, stable ``RunAddress``
dependency labels, the thin domain ``PipelineRunner`` with its ``RunContext`` /
freshness guard, and the ``RunLog`` / ``RunRegistry`` observability types.

**Start with the eager steps.** They execute where they are written, so a
pipeline is an ordinary Python function a debugger steps through line by line,
and they emit the identical run-log records the deferred builder does.
The ``Pipeline`` builder remains for graphs that genuinely fan in.

Import from here rather than the underlying modules::

    from framework.run import read, transform, validate, write, RunContext
    from framework.run import Pipeline, RunAddress          # the deferred builder

The modules behind this facade (``framework.run.builder``,
``framework.run.address``,
``framework.run.execution``, ``framework.run.runner``,
``framework.run.run_context``, ``framework.run.trace``,
``framework.run.dry_run``) are internal layout: re-exports here are the
public contract, the submodule paths are not. The ``RunLog`` / ``RunRegistry``
types re-exported here live in the sibling ``tools.observability`` package.
See ``docs/public-api.md``.
"""

from framework.run.address import RunAddress, RunAddressError
from framework.run.builder import Pipeline, PipelineGraphError
from framework.run.dry_run import DryRunReport
from framework.run.run_context import RunContext, active_context
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
from framework.run.steps import (
    StepError,
    coerce,
    enforce,
    explain,
    quarantine,
    read,
    step,
    transform,
    validate,
    write,
    write_trace,
)
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry

__all__ = [
    "read",
    "transform",
    "validate",
    "write",
    "coerce",
    "enforce",
    "quarantine",
    "step",
    "explain",
    "write_trace",
    "StepError",
    "Pipeline",
    "PipelineGraphError",
    "RunAddress",
    "RunAddressError",
    "PipelineRunner",
    "run_pipeline",
    "load_pipeline",
    "LoadedPipeline",
    "dry_run_pipeline",
    "DryRunReport",
    "RunContext",
    "active_context",
    "RunLog",
    "RunRegistry",
    "Requirement",
    "FreshnessRequirement",
    "FreshnessError",
    "UnknownPipelineError",
]
