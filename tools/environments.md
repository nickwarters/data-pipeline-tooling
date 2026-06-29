```python
"""Resolve a pipeline run's medallion ``base_dir`` from a named environment.

``base_dir`` is the single root every run hangs its artifacts off: the medallion
stores (``<subject>/{raw,silver,gold}.db``), the ``_runs/`` JSONL logs, and the
``_registry/runs.db`` query store. *Which* physical root that is depends on
where a run executes -- production lands on a shared Windows drive, development
on a local working copy. The framework treats ``base_dir`` as an opaque root, so
this ``env -> base_dir`` mapping is an operational concern and lives here in
``tools/`` (a sibling utility, not a framework facade), wired into the operator
CLI and the pipeline ``main()`` entry points.

Each environment's root is read from an OS environment variable so a
machine-specific absolute path -- a UNC share on Windows, a local directory on
macOS -- never has to be committed to source. ``dev`` falls back to ``./data``
(the historical default) so a fresh clone runs out of the box; ``prod`` has no
fallback and raises a clear, actionable error until its variable is set.

To add an environment, add a row to :data:`_ENVIRONMENTS` (and document it).
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

#: OS variable naming the active environment when none is passed explicitly.
ENV_VAR = "PIPELINE_ENV"
#: The environment assumed when neither an argument nor ``PIPELINE_ENV`` is set.
DEFAULT_ENV = "dev"


@dataclass(frozen=True)
class _Environment:
    """How one named environment resolves its ``base_dir``."""

    #: OS variable that, when set, supplies this environment's root verbatim.
    path_var: str
    #: Fallback root when ``path_var`` is unset; ``None`` makes the variable
    #: required (resolving without it raises rather than guessing a location).
    fallback: Callable[[], Path] | None = None


_ENVIRONMENTS: dict[str, _Environment] = {
    "dev": _Environment(
        path_var="PIPELINE_DATA_DIR_DEV",
        fallback=lambda: Path.cwd() / "data",
    ),
    "prod": _Environment(path_var="PIPELINE_DATA_DIR_PROD"),
}


def known_environments() -> tuple[str, ...]:
    """The environment names :func:`resolve_base_dir` accepts."""
    return tuple(_ENVIRONMENTS)


def resolve_base_dir(env: str | None = None) -> Path:
    """Return the medallion ``base_dir`` for ``env``.

    ``env`` defaults to the ``PIPELINE_ENV`` OS variable, then to
    :data:`DEFAULT_ENV`. The chosen environment's root is taken from its
    ``path_var`` OS variable when set, otherwise its declared fallback. An
    unknown name -- or a known one with neither a set variable nor a fallback --
    raises :class:`ValueError` with an actionable message.
    """
    name = (env or os.environ.get(ENV_VAR) or DEFAULT_ENV).strip().lower()
    spec = _ENVIRONMENTS.get(name)
    if spec is None:
        known = ", ".join(sorted(_ENVIRONMENTS))
        raise ValueError(f"unknown environment {name!r}; known environments: {known}")
    configured = os.environ.get(spec.path_var)
    if configured:
        return Path(configured)
    if spec.fallback is not None:
        return spec.fallback()
    raise ValueError(
        f"environment {name!r} has no base_dir configured; "
        f"set the {spec.path_var} environment variable to its medallion root"
    )

```
