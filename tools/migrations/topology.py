"""Resolve a base directory's medallion databases from the migrations tree.

Given the migrations discovered once repo-wide
(:func:`tools.migrations.discovery.discover_migrations`), this module decides
*which physical database files exist* under a base directory, and *which
scopes, interleaved by version, compose each one*: one database per
``(subject, layer)`` actually present in the tree (``<subject>/<layer>.db``),
plus the fixed ``platform/registry`` scope's own database at
``_registry/runs.db`` -- the path ``tools.observability.run_store.RunStore``
already owns, independent of the medallion. Where medallion *data* lands is
this module's concern; where run *metadata* lands is a separate, fixed
concern (see the run_store module docstring), so this module never moves it.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from tools.migrations.discovery import Migration

__all__ = [
    "PLATFORM_REGISTRY_RELATIVE_PATH",
    "Database",
    "resolve_databases",
    "compose_for_subject_layer",
]

# Where the run registry's own database sits -- fixed by
# ``tools.observability.run_store.RunStore``, which this step must not modify.
PLATFORM_REGISTRY_RELATIVE_PATH = Path("_registry") / "runs.db"


@dataclass(frozen=True)
class Database:
    """One physical database file the medallion resolves, and its migrations."""

    relative_path: Path
    migrations: tuple[Migration, ...]


def _ordered(migrations: Iterable[Migration]) -> tuple[Migration, ...]:
    return tuple(sorted(migrations, key=lambda m: int(m.version)))


def _shared(migrations: Iterable[Migration]) -> list[Migration]:
    return [m for m in migrations if m.scope.kind == "shared"]


def _layer(migrations: Iterable[Migration], layer: str) -> list[Migration]:
    return [m for m in migrations if m.scope.kind == "layer" and m.scope.layer == layer]


def _subject_layer(
    migrations: Iterable[Migration], subject: str, layer: str
) -> list[Migration]:
    return [
        m
        for m in migrations
        if m.scope.kind == "subject_layer"
        and m.scope.subject == subject
        and m.scope.layer == layer
    ]


def _platform(migrations: Iterable[Migration], name: str) -> list[Migration]:
    return [
        m for m in migrations if m.scope.kind == "platform" and m.scope.name == name
    ]


def _registry_database(migrations: Iterable[Migration]) -> Database:
    return Database(
        relative_path=PLATFORM_REGISTRY_RELATIVE_PATH,
        migrations=_ordered(
            list(_shared(migrations)) + _platform(migrations, "registry")
        ),
    )


def compose_for_subject_layer(
    migrations: Iterable[Migration], subject: str, layer: str
) -> tuple[Migration, ...]:
    """Every migration that reaches one subject's one layer, in version order.

    The medallion's composition rule, named once so the two callers that need
    it agree: this module (building ``<subject>/<layer>.db``) and
    ``tools.schema.emit``, which replays exactly this set to work out what
    shape the tree has already committed to for a table in that scope. A
    ``_shared``/``layer`` migration that creates a table is part of that
    shape, so authoring must see it too.
    """
    migrations = tuple(migrations)
    composed = (
        list(_shared(migrations))
        + _layer(migrations, layer)
        + _subject_layer(migrations, subject, layer)
    )
    return _ordered(composed)


def resolve_databases(migrations: tuple[Migration, ...]) -> tuple[Database, ...]:
    """The physical medallion databases, and each one's composed migrations.

    One database per ``(subject, layer)`` actually present in ``migrations``
    (``<subject>/<layer>.db``), plus the fixed ``platform/registry`` database.
    """
    subjects_layers = sorted(
        {
            (m.scope.subject, m.scope.layer)
            for m in migrations
            if m.scope.kind == "subject_layer"
        }
    )
    databases = [
        Database(
            Path(subject) / f"{layer}.db",
            compose_for_subject_layer(migrations, subject, layer),
        )
        for subject, layer in subjects_layers
    ]
    databases.append(_registry_database(migrations))
    return tuple(databases)
