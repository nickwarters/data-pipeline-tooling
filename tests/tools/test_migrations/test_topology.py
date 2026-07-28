"""The medallion's database/scope composition, against a synthetic set."""

from __future__ import annotations

from pathlib import Path

from tools.migrations.discovery import Migration
from tools.migrations.scope import (
    layer_scope,
    platform_scope,
    shared_scope,
    subject_layer_scope,
)
from tools.migrations.topology import resolve_databases


def _m(version, scope, path="x.sql"):
    return Migration(
        version=version, slug="s", scope=scope, path=Path(path), checksum=version
    )


def _sample_migrations():
    return (
        _m("0001", shared_scope()),
        _m("0002", layer_scope("raw")),
        _m("0003", layer_scope("silver")),
        _m("0005", platform_scope("registry")),
        _m("0006", subject_layer_scope("a", "raw")),
        _m("0007", subject_layer_scope("a", "silver")),
        _m("0008", subject_layer_scope("b", "raw")),
    )


def test_medallion_groups_by_subject_and_layer_and_composes_scopes():
    migrations = _sample_migrations()
    databases = resolve_databases(migrations)
    by_path = {str(d.relative_path): d for d in databases}

    assert set(by_path) == {
        "a/raw.db",
        "a/silver.db",
        "b/raw.db",
        "_registry/runs.db",
    }
    # a/raw.db: _shared + layer/raw + subject/a/raw
    versions = [m.version for m in by_path["a/raw.db"].migrations]
    assert versions == ["0001", "0002", "0006"]
    versions_silver = [m.version for m in by_path["a/silver.db"].migrations]
    assert versions_silver == ["0001", "0003", "0007"]
    # subject b has no silver migration, so no b/silver.db exists at all.
    assert "b/silver.db" not in by_path


def test_registry_database_is_the_same_fixed_path():
    migrations = _sample_migrations()
    databases = resolve_databases(migrations)
    registry = [d for d in databases if str(d.relative_path) == "_registry/runs.db"]
    assert len(registry) == 1
    registry_migrations = [m.version for m in registry[0].migrations]
    assert "0001" in registry_migrations  # _shared
    assert "0005" in registry_migrations  # platform/registry
    assert "0002" not in registry_migrations  # never a layer scope


def test_all_databases_have_version_ordered_migrations():
    migrations = _sample_migrations()
    for database in resolve_databases(migrations):
        versions = [int(m.version) for m in database.migrations]
        assert versions == sorted(versions)
