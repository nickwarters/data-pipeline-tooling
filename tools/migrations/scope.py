"""The scope-from-path vocabulary: what a ``migrations/`` directory *means*.

A migration's directory path is its **scope** — there is no manifest naming
which scope a file belongs to, because the path already says it:

- ``_shared/`` — every database in every topology composes this scope.
- ``layer/<raw|silver|gold>/`` — every database of that generic medallion layer.
- ``phase/<ingest|selection|sync|reporting>/`` — every database of that phase
  of the Ingest/Selection/Sync/Reporting loop (``CONTEXT.md``).
- ``subject/<subject>/<raw|silver|gold>/`` — one subject's one layer — the
  finest-grained scope, and the one a real feed's declared ``Table`` resolves
  to (``subject`` here is the *namespace* subject `tools.schema.resolved_namespace`
  computes, not necessarily a ``pipelines/`` directory name).
- ``platform/<name>/`` — a fixed platform database outside the medallion, e.g.
  ``platform/registry`` for the run registry's own file.

:func:`parse_scope_dir` is the one place a directory is classified (or
rejected); :mod:`tools.migrations.discovery` calls it once per migration file
so a stray or misspelled directory fails loudly rather than being silently
skipped or silently composed into the wrong database.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath

__all__ = [
    "SHARED_DIR",
    "VALID_LAYERS",
    "VALID_PHASES",
    "Scope",
    "MigrationTreeError",
    "shared_scope",
    "layer_scope",
    "phase_scope",
    "subject_layer_scope",
    "platform_scope",
    "parse_scope_dir",
    "scope_from_label",
]

SHARED_DIR = "_shared"
VALID_LAYERS: tuple[str, ...] = ("raw", "silver", "gold")
VALID_PHASES: tuple[str, ...] = ("ingest", "selection", "sync", "reporting")


class MigrationTreeError(Exception):
    """The ``migrations/`` tree violates its scope-from-path convention."""


@dataclass(frozen=True)
class Scope:
    """One classified migration scope. Construct via the module functions below."""

    kind: str  # "shared" | "layer" | "phase" | "subject_layer" | "platform"
    layer: str | None = None
    phase: str | None = None
    subject: str | None = None
    name: str | None = None  # the platform database's name, e.g. "registry"

    @property
    def path(self) -> PurePosixPath:
        """This scope's directory path under ``migrations/``, POSIX-separated.

        Always forward-slash: this is a *label*, not a filesystem path, and
        Windows accepts ``/`` in a path string too — the on-disk lookup goes
        through ``pathlib`` elsewhere.
        """
        if self.kind == "shared":
            return PurePosixPath(SHARED_DIR)
        if self.kind == "layer":
            return PurePosixPath("layer") / self.layer
        if self.kind == "phase":
            return PurePosixPath("phase") / self.phase
        if self.kind == "subject_layer":
            return PurePosixPath("subject") / self.subject / self.layer
        if self.kind == "platform":
            return PurePosixPath("platform") / self.name
        raise AssertionError(
            f"unreachable scope kind {self.kind!r}"
        )  # pragma: no cover

    @property
    def label(self) -> str:
        """The scope's ``--scope`` / ledger-facing string form."""
        return str(self.path)


def shared_scope() -> Scope:
    return Scope(kind="shared")


def layer_scope(layer: str) -> Scope:
    if layer not in VALID_LAYERS:
        raise MigrationTreeError(
            f"{layer!r} is not a recognised layer; "
            f"known layers: {', '.join(VALID_LAYERS)}"
        )
    return Scope(kind="layer", layer=layer)


def phase_scope(phase: str) -> Scope:
    if phase not in VALID_PHASES:
        raise MigrationTreeError(
            f"{phase!r} is not a recognised phase; "
            f"known phases: {', '.join(VALID_PHASES)}"
        )
    return Scope(kind="phase", phase=phase)


def subject_layer_scope(subject: str, layer: str) -> Scope:
    if layer not in VALID_LAYERS:
        raise MigrationTreeError(
            f"{layer!r} is not a recognised layer under subject {subject!r}; "
            f"known layers: {', '.join(VALID_LAYERS)}"
        )
    return Scope(kind="subject_layer", subject=subject, layer=layer)


def platform_scope(name: str) -> Scope:
    return Scope(kind="platform", name=name)


def parse_scope_dir(relative_dir: PurePosixPath) -> Scope:
    """Classify a directory path (relative to ``migrations/``) into its Scope.

    Raises :class:`MigrationTreeError` naming the offending path for anything
    that isn't one of the five recognised shapes -- a typo'd layer/phase name,
    an extra path segment, or a directory with no home in the convention at
    all. There is deliberately no fallback "uncategorised" scope: a migration
    file with no clear scope must not be silently composed into every database
    (as ``_shared`` would be) or into none.
    """
    parts = relative_dir.parts
    if parts == (SHARED_DIR,):
        return shared_scope()
    if len(parts) == 2 and parts[0] == "layer":
        return layer_scope(parts[1])
    if len(parts) == 2 and parts[0] == "phase":
        return phase_scope(parts[1])
    if len(parts) == 3 and parts[0] == "subject":
        return subject_layer_scope(parts[1], parts[2])
    if len(parts) == 2 and parts[0] == "platform":
        return platform_scope(parts[1])
    raise MigrationTreeError(
        f"{relative_dir} is not a recognised migration scope directory -- expected "
        "_shared/, layer/<raw|silver|gold>/, phase/<ingest|selection|sync|reporting>/, "
        "subject/<subject>/<raw|silver|gold>/, or platform/<name>/"
    )


def scope_from_label(label: str) -> Scope:
    """Parse a ``--scope`` command-line value (e.g. ``"layer/silver"``) back to a Scope.

    The inverse of :attr:`Scope.label`, for ``migrate --database ... --scope ...``'s
    ad hoc override mode, where a caller names scopes directly rather than
    through a topology profile.
    """
    return parse_scope_dir(PurePosixPath(label))
