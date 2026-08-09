"""Resolve a pipeline run's medallion ``base_dir`` from a named environment.

``base_dir`` is the single root every run hangs its artifacts off: the medallion
stores (``<subject>/{raw,silver,gold}.db``), the ``_runs/`` JSONL logs, and the
``_registry/runs.db`` query store. *Which* physical root that is depends on
where a run executes -- production lands on a shared Windows drive, development
on a local working copy. The framework treats ``base_dir`` as an opaque root, so
this ``env -> base_dir`` mapping is an operational concern and lives here in
``tools/`` (a sibling utility, not a framework facade), wired into the operator
CLI and the pipeline ``main()`` entry points.

Each environment has a committed default root in ``shared.constants``. An OS
variable, when set, supplies a machine-specific absolute path -- a UNC share on
Windows, a local directory on macOS -- without changing source. Relative
defaults are resolved from the current working directory.

The production default is intentionally visible: when ``prod`` uses its
committed fallback, a one-line warning is written to stderr so an operator can
distinguish it from an explicitly configured production root.

To add an environment, add a row to :data:`_ENVIRONMENTS` (and document it).
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from shared.constants import DEV_ROOT, PROD_ROOT

#: OS variable naming the active environment when none is passed explicitly.
ENV_VAR = "PIPELINE_ENV"
#: The environment assumed when neither an argument nor ``PIPELINE_ENV`` is set.
DEFAULT_ENV = "dev"


@dataclass(frozen=True)
class _Environment:
    """How one named environment resolves its ``base_dir``."""

    #: OS variable that, when set, supplies this environment's root verbatim.
    path_var: str
    #: Committed root used when ``path_var`` is unset.
    fallback: Path


_ENVIRONMENTS: dict[str, _Environment] = {
    "dev": _Environment(
        path_var="PIPELINE_DATA_DIR_DEV",
        fallback=DEV_ROOT,
    ),
    "prod": _Environment(
        path_var="PIPELINE_DATA_DIR_PROD",
        fallback=PROD_ROOT,
    ),
}


def known_environments() -> tuple[str, ...]:
    """The environment names :func:`resolve_base_dir` accepts."""
    return tuple(_ENVIRONMENTS)


def resolve_base_dir(env: str | None = None) -> Path:
    """Return the medallion ``base_dir`` for ``env``.

    ``env`` defaults to the ``PIPELINE_ENV`` OS variable, then to
    :data:`DEFAULT_ENV`. The chosen environment's root is taken from its
    ``path_var`` OS variable when set, otherwise its committed default. A
    relative default is resolved from the current working directory. An
    unknown name raises :class:`ValueError` with an actionable message.
    """
    name = (env or os.environ.get(ENV_VAR) or DEFAULT_ENV).strip().lower()
    spec = _ENVIRONMENTS.get(name)
    if spec is None:
        known = ", ".join(sorted(_ENVIRONMENTS))
        raise ValueError(f"unknown environment {name!r}; known environments: {known}")
    configured = os.environ.get(spec.path_var)
    if configured:
        return Path(configured).expanduser()
    fallback = (
        spec.fallback if spec.fallback.is_absolute() else Path.cwd() / spec.fallback
    )
    if name == "prod":
        print(
            f"warning: {spec.path_var} is unset; using committed production root "
            f"{fallback}; set {spec.path_var} to override it",
            file=sys.stderr,
        )
    return fallback
