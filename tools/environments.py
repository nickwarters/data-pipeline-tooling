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

An environment also carries *policy*, not only a path: since #324 each one
declares whether a Writer in it may create a table no migration has declared
(``require_declared_tables``). :func:`base_dir_for` is therefore the call every
entry point makes -- it settles the root *and* activates the policy, including
when an explicit ``--base-dir`` supplies the root itself, because a path says
where a run lands and never how strictly it behaves.

To add an environment, add a row to :data:`_ENVIRONMENTS` (and document it).
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from framework.io.writers import set_require_declared_tables

#: OS variable naming the active environment when none is passed explicitly.
ENV_VAR = "PIPELINE_ENV"
#: The environment assumed when neither an argument nor ``PIPELINE_ENV`` is set.
DEFAULT_ENV = "dev"


@dataclass(frozen=True)
class _Environment:
    """How one named environment resolves its ``base_dir``, and its guard state."""

    #: OS variable that, when set, supplies this environment's root verbatim.
    path_var: str
    #: Fallback root when ``path_var`` is unset; ``None`` makes the variable
    #: required (resolving without it raises rather than guessing a location).
    fallback: Callable[[], Path] | None = None
    #: Whether a Writer in this environment must refuse a table nothing has
    #: migrated yet (``MissingTableError``), rather than creating it implicitly.
    #: See ``framework.io.writers``' require-declared-tables guard. Rolled out
    #: environment by environment (#324): ``dev`` first, ``prod`` only after an
    #: operator has run ``schema diff --env prod`` and confirmed nothing prod
    #: already relies on being auto-created is left undeclared.
    require_declared_tables: bool = False


_ENVIRONMENTS: dict[str, _Environment] = {
    "dev": _Environment(
        path_var="PIPELINE_DATA_DIR_DEV",
        fallback=lambda: Path.cwd() / "data",
        require_declared_tables=True,
    ),
    "prod": _Environment(path_var="PIPELINE_DATA_DIR_PROD"),
}


def known_environments() -> tuple[str, ...]:
    """The environment names :func:`resolve_base_dir` accepts."""
    return tuple(_ENVIRONMENTS)


def require_declared_tables(env: str | None = None) -> bool:
    """Whether ``env`` (named the same way :func:`base_dir_for` names it) is
    configured to run with the require-declared-tables guard on.

    A pure query, unlike :func:`base_dir_for` / :func:`activate_environment`:
    it never touches the process-wide guard in ``framework.io.writers``, so a
    caller reporting on several environments -- or a test asserting on an
    environment's own configuration -- can read the flag without activating
    it.
    """
    return _environment(env)[1].require_declared_tables


def _environment(env: str | None) -> tuple[str, _Environment]:
    name = (env or os.environ.get(ENV_VAR) or DEFAULT_ENV).strip().lower()
    spec = _ENVIRONMENTS.get(name)
    if spec is None:
        known = ", ".join(sorted(_ENVIRONMENTS))
        raise ValueError(f"unknown environment {name!r}; known environments: {known}")
    return name, spec


def base_dir_for(
    env: str | None = None,
    *,
    override: str | os.PathLike[str] | None = None,
) -> Path:
    """Activate ``env`` and return its ``base_dir``, or ``override`` if given.

    The one call every entry point makes: an operator's ``--base-dir`` (or a
    pipeline ``main()``'s) wins over the environment's own root, but it does
    **not** opt that run out of the environment's *policy*. Activation happens
    either way, so ``--base-dir /tmp/demo --env dev`` runs under dev's
    require-declared-tables guard exactly as ``--env dev`` alone does; a path
    says *where* a run lands, never *how strictly* it may create what it finds
    missing. Resolving the root is skipped entirely when ``override`` is given,
    so ``--base-dir`` still works in an environment whose own ``path_var`` is
    unset.

    ``env`` defaults to the ``PIPELINE_ENV`` OS variable, then to
    :data:`DEFAULT_ENV`; an unknown name raises :class:`ValueError` with an
    actionable message, ``override`` or not.
    """
    name, spec = _environment(env)
    set_require_declared_tables(spec.require_declared_tables)
    if override:
        return Path(override)
    return _root_of(name, spec)


def activate_environment(env: str | None = None) -> None:
    """Apply ``env``'s policy to this process, resolving no path.

    Today that is one switch: ``framework.io.writers``' process-wide
    require-declared-tables guard is flipped to match ``env``'s own
    ``require_declared_tables`` -- see that module's guard section (and
    ``docs/adr/0016-migrations-own-table-structure.md``) for why the flag
    cannot be threaded through ``Store``/``strategy.writer_for`` instead, and
    must therefore be activated once per process by whoever knows which
    environment is running.

    Separate from :func:`base_dir_for` only so the split is visible: *where* a
    run lands and *how* it behaves are two decisions an environment makes, and
    a caller supplying its own path still needs the second. A caller that
    wants to *read* an environment's flag without activating it uses the pure
    :func:`require_declared_tables` query instead.
    """
    _, spec = _environment(env)
    set_require_declared_tables(spec.require_declared_tables)


def resolve_base_dir(env: str | None = None) -> Path:
    """Return the medallion ``base_dir`` for ``env``, and activate it.

    The no-override form of :func:`base_dir_for`: the chosen environment's
    root is taken from its ``path_var`` OS variable when set, otherwise its
    declared fallback. An unknown name -- or a known one with neither a set
    variable nor a fallback -- raises :class:`ValueError` with an actionable
    message.
    """
    return base_dir_for(env)


def _root_of(name: str, spec: _Environment) -> Path:
    configured = os.environ.get(spec.path_var)
    if configured:
        return Path(configured)
    if spec.fallback is not None:
        return spec.fallback()
    raise ValueError(
        f"environment {name!r} has no base_dir configured; "
        f"set the {spec.path_var} environment variable to its medallion root"
    )
