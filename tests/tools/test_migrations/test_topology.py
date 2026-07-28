"""Each topology profile's database/scope composition, against a synthetic set."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools.migrations.discovery import Migration
from tools.migrations.scope import (
    layer_scope,
    phase_scope,
    platform_scope,
    shared_scope,
    subject_layer_scope,
)
from tools.migrations.topology import known_profiles, resolve_databases


def _m(version, scope, path="x.sql"):
    return Migration(
        version=version, slug="s", scope=scope, path=Path(path), checksum=version
    )


def _sample_migrations():
    return (
        _m("0001", shared_scope()),
        _m("0002", layer_scope("raw")),
        _m("0003", layer_scope("silver")),
        _m("0004", phase_scope("ingest")),
        _m("0005", platform_scope("registry")),
        _m("0006", subject_layer_scope("a", "raw")),
        _m("0007", subject_layer_scope("a", "silver")),
        _m("0008", subject_layer_scope("b", "raw")),
    )


def test_known_profiles():
    assert set(known_profiles()) == {"medallion", "single", "by_layer", "by_phase"}


def test_unknown_profile_raises():
    with pytest.raises(ValueError, match="unknown topology profile"):
        resolve_databases("nonexistent", ())


def test_medallion_groups_by_subject_and_layer_and_composes_scopes():
    migrations = _sample_migrations()
    databases = resolve_databases("medallion", migrations)
    by_path = {str(d.relative_path): d for d in databases}

    assert set(by_path) == {
        "a/raw.db",
        "a/silver.db",
        "b/raw.db",
        "_registry/runs.db",
    }
    # a/raw.db: _shared + layer/raw + phase/ingest (raw's phase) + subject/a/raw
    versions = [m.version for m in by_path["a/raw.db"].migrations]
    assert versions == ["0001", "0002", "0004", "0006"]
    # a/silver.db has no phase scope in the sample (nothing maps silver's
    # phase here since it's still "ingest" -- verify silver gets it too)
    versions_silver = [m.version for m in by_path["a/silver.db"].migrations]
    assert versions_silver == ["0001", "0003", "0004", "0007"]
    # subject b has no silver migration, so no b/silver.db exists at all.
    assert "b/silver.db" not in by_path


def test_registry_database_is_the_same_fixed_path_in_every_profile():
    migrations = _sample_migrations()
    for profile in known_profiles():
        databases = resolve_databases(profile, migrations)
        registry = [d for d in databases if str(d.relative_path) == "_registry/runs.db"]
        assert len(registry) == 1
        registry_migrations = [m.version for m in registry[0].migrations]
        assert "0001" in registry_migrations  # _shared
        assert "0005" in registry_migrations  # platform/registry
        assert "0002" not in registry_migrations  # never a layer scope


def test_single_profile_composes_one_warehouse_with_everything_but_platform():
    migrations = _sample_migrations()
    databases = resolve_databases("single", migrations)
    warehouse = next(d for d in databases if str(d.relative_path) == "warehouse.db")
    versions = [m.version for m in warehouse.migrations]
    assert versions == ["0001", "0002", "0003", "0004", "0006", "0007", "0008"]
    assert "0005" not in versions  # platform scope goes to the registry db only


def test_by_layer_profile_spans_every_subject_of_that_layer():
    migrations = _sample_migrations()
    databases = resolve_databases("by_layer", migrations)
    by_path = {str(d.relative_path): d for d in databases}
    assert set(by_path) == {"raw.db", "silver.db", "gold.db", "_registry/runs.db"}
    raw_versions = [m.version for m in by_path["raw.db"].migrations]
    # _shared + layer/raw + subject/a/raw + subject/b/raw
    assert raw_versions == ["0001", "0002", "0006", "0008"]
    gold_versions = [m.version for m in by_path["gold.db"].migrations]
    assert gold_versions == ["0001"]  # only _shared -- no gold migrations in the sample


def test_by_phase_profile_spans_every_layer_mapped_to_that_phase():
    migrations = _sample_migrations()
    databases = resolve_databases("by_phase", migrations)
    by_path = {str(d.relative_path): d for d in databases}
    assert set(by_path) == {
        "ingest.db",
        "selection.db",
        "sync.db",
        "reporting.db",
        "_registry/runs.db",
    }
    # ingest = raw + silver layers: _shared + phase/ingest + layer/raw +
    # layer/silver + every subject_layer at raw/silver.
    ingest_versions = {m.version for m in by_path["ingest.db"].migrations}
    assert ingest_versions == {"0001", "0002", "0003", "0004", "0006", "0007", "0008"}
    # sync/reporting map to no layer in PHASE_BY_LAYER, so only _shared + their
    # own (empty here) phase scope.
    sync_versions = [m.version for m in by_path["sync.db"].migrations]
    assert sync_versions == ["0001"]


def test_all_databases_have_version_ordered_migrations():
    migrations = _sample_migrations()
    for profile in known_profiles():
        for database in resolve_databases(profile, migrations):
            versions = [int(m.version) for m in database.migrations]
            assert versions == sorted(versions)
