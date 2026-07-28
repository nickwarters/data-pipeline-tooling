"""End-to-end: the medallion migrates the real, repo-wide ``migrations/`` tree.

Exercised against the *real* migrations tree -- the one generated from every
bundled feed's declared ``TABLES`` (see ``tools/schema/emit.py`` and
``cli/migrate.py``'s ``migrations make``) -- so it proves the actual
production tree lands every actual declared table in its actual per-subject
file, and that the platform registry database lands alongside it.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from tools.migrations.discovery import discover_migrations
from tools.migrations.runner import apply_database
from tools.migrations.topology import resolve_databases
from tools.observability.record_schema import (
    RUN_RECORD_COLUMNS,
    RUN_RECORD_PRIMARY_KEY,
    create_table_sql,
)
from tools.observability.run_registry import RunRegistry
from tools.schema import collect_declared_tables
from tools.schema.declaration import resolved_namespace

MIGRATIONS_ROOT = Path(__file__).resolve().parents[2] / "migrations"


def _declared_subject_layer_tables():
    """Every declared ``Table`` under the medallion, as ``(subject, layer, name)``."""
    out = []
    for feed, tables in collect_declared_tables().items():
        for table in tables:
            namespace = resolved_namespace(table, feed)
            subject, layer = namespace.split("/", 1)
            out.append((subject, layer, table.name))
    return out


def _migrate_all(base_dir: Path) -> None:
    migrations = discover_migrations(MIGRATIONS_ROOT)
    for database in resolve_databases(migrations):
        apply_database(database, base_dir / database.relative_path)


def _table_shape(con: sqlite3.Connection, table: str) -> list[tuple]:
    """``(name, type, notnull, pk)`` per column -- shape, ignoring formatting."""
    return [
        (row[1], row[2], row[3], row[5])
        for row in con.execute(f'PRAGMA table_info("{table}")')
    ]


def _table_exists(db_path: Path, table: str) -> bool:
    if not db_path.exists():
        return False
    con = sqlite3.connect(db_path)
    try:
        return bool(con.execute(f'PRAGMA table_info("{table}")').fetchall())
    finally:
        con.close()


def test_medallion_lands_every_real_declared_table_in_its_subject_layer_file(
    tmp_path,
):
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir)

    for subject, layer, table in _declared_subject_layer_tables():
        db_path = base_dir / subject / f"{layer}.db"
        assert _table_exists(db_path, table), f"{subject}/{layer}.db missing {table}"


def test_medallion_also_lands_the_platform_registry_database(tmp_path):
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir)

    assert _table_exists(base_dir / "_registry" / "runs.db", "run_records")


def test_re_migrating_medallion_is_a_no_op(tmp_path):
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir)
    _migrate_all(base_dir)  # idempotent -- must not raise


def test_the_registry_migration_creates_the_run_records_shape_run_record_fields_declare(
    tmp_path,
):
    # platform/registry's DDL must stay derived from RUN_RECORD_FIELDS (the one
    # ordered declaration) rather than becoming a second hand-kept copy, and it
    # must agree with the shape RunRegistry's own surviving self-heal creates.
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir)

    migrated = sqlite3.connect(base_dir / "_registry" / "runs.db")
    declared = sqlite3.connect(":memory:")
    declared.execute(
        create_table_sql("run_records", RUN_RECORD_COLUMNS, RUN_RECORD_PRIMARY_KEY)
    )
    try:
        assert _table_shape(migrated, "run_records") == _table_shape(
            declared, "run_records"
        )
    finally:
        migrated.close()
        declared.close()


def test_a_registry_database_ends_up_the_same_shape_in_either_order(tmp_path):
    # migrate-then-run and run-then-migrate must converge: `migrate` creates the
    # table for a fresh database, RunRegistry._migrate() heals one that
    # `migrate` never touched. Neither may fight the other.
    migrate_first = tmp_path / "a" / "_registry" / "runs.db"
    _migrate_all(tmp_path / "a")
    con = RunRegistry(migrate_first)._connect()
    try:
        migrated_then_run = _table_shape(con, "run_records")
    finally:
        con.close()

    run_first = tmp_path / "b" / "_registry" / "runs.db"
    con = RunRegistry(run_first)._connect()
    con.close()
    _migrate_all(tmp_path / "b")
    con = sqlite3.connect(run_first)
    try:
        run_then_migrated = _table_shape(con, "run_records")
    finally:
        con.close()

    assert migrated_then_run == run_then_migrated
