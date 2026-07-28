"""Topology profiles: base dir -> databases -> composed scopes.

Shaped like ``tools.environments._ENVIRONMENTS``: a small named registry an
environment points at (see ``tools/environments.py``), not a class hierarchy.
Given the migrations discovered once repo-wide
(:func:`tools.migrations.discovery.discover_migrations`), a profile decides
two things: *which physical database files exist*, and
*which scopes, interleaved by version, compose each one*.

Four profiles ship, all derived from the same migration tree -- changing
``--profile``/an environment's topology never requires a different set of
``.sql`` files, only a different way of bundling them into files:

- **medallion** (today's layout) -- one database per ``(subject, layer)``
  actually present in the tree: ``<subject>/<layer>.db``.
- **single** -- one ``warehouse.db`` composing every non-platform scope.
- **by_layer** -- one database per generic layer, spanning every subject:
  ``raw.db`` / ``silver.db`` / ``gold.db``.
- **by_phase** -- one database per phase of the Ingest/Selection/Sync/Reporting
  loop: ``ingest.db`` / ``selection.db`` / ``sync.db`` / ``reporting.db``.

Every profile additionally resolves the fixed ``platform/registry`` scope to
the *same* physical path in every topology -- ``_registry/runs.db``, the path
``tools.observability.run_store.RunStore`` already owns independent of the
medallion. Topology governs where medallion *data* lands; where run *metadata*
lands is a separate, fixed concern (see the run_store module docstring), so no
profile below ever moves it.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from tools.migrations.discovery import Migration
from tools.migrations.scope import VALID_LAYERS, VALID_PHASES

__all__ = [
    "PHASE_BY_LAYER",
    "PLATFORM_REGISTRY_RELATIVE_PATH",
    "Database",
    "known_profiles",
    "resolve_databases",
    "compose_for_subject_layer",
]

# The convention this repo's demo pipelines follow for where a generic
# medallion layer sits in the four-phase Ingest/Selection/Sync/Reporting loop
# (see CONTEXT.md): Ingest brings Feeds in and refines them through raw/silver
# into the CasePool; Selection narrows the CasePool into gold (the
# SelectionPool). No layer maps to Sync or Reporting here because both are
# platform-wide and, in this repo's bundled feeds, own no per-subject medallion
# layer of their own -- a real deployment with a Sync/Reporting medallion would
# extend this mapping, not change the shape of it.
PHASE_BY_LAYER: dict[str, str] = {
    "raw": "ingest",
    "silver": "ingest",
    "gold": "selection",
}

# Where the run registry's own database sits, in every topology -- fixed by
# ``tools.observability.run_store.RunStore``, which this step must not modify.
PLATFORM_REGISTRY_RELATIVE_PATH = Path("_registry") / "runs.db"


@dataclass(frozen=True)
class Database:
    """One physical database file a topology profile resolves, and its migrations."""

    relative_path: Path
    migrations: tuple[Migration, ...]


def _ordered(migrations: Iterable[Migration]) -> tuple[Migration, ...]:
    return tuple(sorted(migrations, key=lambda m: int(m.version)))


def _shared(migrations: Iterable[Migration]) -> list[Migration]:
    return [m for m in migrations if m.scope.kind == "shared"]


def _layer(migrations: Iterable[Migration], layer: str) -> list[Migration]:
    return [m for m in migrations if m.scope.kind == "layer" and m.scope.layer == layer]


def _phase(migrations: Iterable[Migration], phase: str) -> list[Migration]:
    return [m for m in migrations if m.scope.kind == "phase" and m.scope.phase == phase]


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


def _every_subject_layer(
    migrations: Iterable[Migration], layer: str
) -> list[Migration]:
    return [
        m
        for m in migrations
        if m.scope.kind == "subject_layer" and m.scope.layer == layer
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

    The medallion profile's composition rule, named once so the two callers
    that need it agree: this module (building ``<subject>/<layer>.db``) and
    ``tools.schema.emit``, which replays exactly this set to work out what
    shape the tree has already committed to for a table in that scope. A
    ``_shared``/``layer``/``phase`` migration that creates a table is part of
    that shape, so authoring must see it too.
    """
    migrations = tuple(migrations)
    phase = PHASE_BY_LAYER.get(layer)
    composed = (
        list(_shared(migrations))
        + _layer(migrations, layer)
        + (_phase(migrations, phase) if phase else [])
        + _subject_layer(migrations, subject, layer)
    )
    return _ordered(composed)


def _medallion_databases(migrations: tuple[Migration, ...]) -> tuple[Database, ...]:
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


def _single_database(migrations: tuple[Migration, ...]) -> tuple[Database, ...]:
    non_platform = [m for m in migrations if m.scope.kind != "platform"]
    return (
        Database(Path("warehouse.db"), _ordered(non_platform)),
        _registry_database(migrations),
    )


def _by_layer_databases(migrations: tuple[Migration, ...]) -> tuple[Database, ...]:
    databases = [
        Database(
            Path(f"{layer}.db"),
            _ordered(
                list(_shared(migrations))
                + _layer(migrations, layer)
                + _every_subject_layer(migrations, layer)
            ),
        )
        for layer in VALID_LAYERS
    ]
    databases.append(_registry_database(migrations))
    return tuple(databases)


def _by_phase_databases(migrations: tuple[Migration, ...]) -> tuple[Database, ...]:
    databases = []
    for phase in VALID_PHASES:
        layers = [layer for layer, p in PHASE_BY_LAYER.items() if p == phase]
        composed = list(_shared(migrations)) + _phase(migrations, phase)
        for layer in layers:
            composed += _layer(migrations, layer) + _every_subject_layer(
                migrations, layer
            )
        databases.append(Database(Path(f"{phase}.db"), _ordered(composed)))
    databases.append(_registry_database(migrations))
    return tuple(databases)


_PROFILES: dict[str, Callable[[tuple[Migration, ...]], tuple[Database, ...]]] = {
    "medallion": _medallion_databases,
    "single": _single_database,
    "by_layer": _by_layer_databases,
    "by_phase": _by_phase_databases,
}


def known_profiles() -> tuple[str, ...]:
    """The topology profile names :func:`resolve_databases` accepts."""
    return tuple(_PROFILES)


def resolve_databases(
    profile: str, migrations: tuple[Migration, ...]
) -> tuple[Database, ...]:
    """The physical databases, and each one's composed migrations, for ``profile``."""
    try:
        build = _PROFILES[profile]
    except KeyError:
        known = ", ".join(known_profiles())
        raise ValueError(
            f"unknown topology profile {profile!r}; known profiles: {known}"
        ) from None
    return build(migrations)
