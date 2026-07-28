"""End-to-end: each of the four topology profiles migrates a real base directory.

**Medallion** (today's layout) is exercised against the *real*, repo-wide
``migrations/`` tree -- the one generated from every bundled feed's declared
``TABLES`` (see ``tools/schema/emit.py`` and ``cli/migrate.py``'s ``migrations
make``) -- so it proves the actual production tree lands every actual
declared table in its actual per-subject file.

**single / by_layer / by_phase** are exercised against a small synthetic
migration tree instead, built with the same real primitives
(``discover_migrations`` reading real ``.sql`` files on disk,
``resolve_databases``, ``apply_database`` against real SQLite files). This is a
deliberate, documented choice, because **only `medallion` can migrate this
repo's own declarations** -- a coarser profile collapses several databases into
one physical file, and a file holds one table per name. Two collisions, only
one of them a fixture problem:

- different **subjects** reuse a name (``cases`` in ``cases`` /
  ``complex_cases`` / ``ref_lookup``; ``selection_pool`` and
  ``selection_trace`` in ``cases`` / ``case_selection``) -- arguably a naming
  accident in the bundled demo feeds;
- a silver table is named after the **raw** table it refines
  (``complaints_a`` raw -> ``complaints_a`` silver) -- this repo's universal
  convention, so ``single`` and ``by_phase``, which put raw and silver in one
  file, collide for *every* feed.

The second is a real open design question for those two profiles (a naming rule
or a table rename -- a change to existing pipelines, out of scope for this
additive step), not something a fixture can paper over. So the topology
*mechanism* is proven against a synthetic collision-free tree, and
``test_single_profile_against_the_real_tree_fails_loudly_and_explains_why``
pins the behaviour that actually matters for the real tree: a clear, complete
refusal rather than a raw SQLite error.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tools.migrations.discovery import discover_migrations
from tools.migrations.runner import MigrationApplyError, apply_database
from tools.migrations.topology import PHASE_BY_LAYER, resolve_databases
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


def _migrate_all(base_dir: Path, profile: str, root: Path = MIGRATIONS_ROOT) -> None:
    migrations = discover_migrations(root)
    for database in resolve_databases(profile, migrations):
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


def test_medallion_profile_lands_every_real_declared_table_in_its_subject_layer_file(
    tmp_path,
):
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir, "medallion")

    for subject, layer, table in _declared_subject_layer_tables():
        db_path = base_dir / subject / f"{layer}.db"
        assert _table_exists(db_path, table), f"{subject}/{layer}.db missing {table}"


def test_medallion_profile_also_lands_the_platform_registry_database(tmp_path):
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir, "medallion")

    assert _table_exists(base_dir / "_registry" / "runs.db", "run_records")


def test_re_migrating_medallion_is_a_no_op(tmp_path):
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir, "medallion")
    _migrate_all(base_dir, "medallion")  # idempotent -- must not raise


def test_the_registry_migration_creates_the_run_records_shape_run_record_fields_declare(
    tmp_path,
):
    # platform/registry's DDL must stay derived from RUN_RECORD_FIELDS (the one
    # ordered declaration) rather than becoming a second hand-kept copy, and it
    # must agree with the shape RunRegistry's own surviving self-heal creates.
    base_dir = tmp_path / "medallion"
    _migrate_all(base_dir, "medallion")

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
    _migrate_all(tmp_path / "a", "medallion")
    con = RunRegistry(migrate_first)._connect()
    try:
        migrated_then_run = _table_shape(con, "run_records")
    finally:
        con.close()

    run_first = tmp_path / "b" / "_registry" / "runs.db"
    con = RunRegistry(run_first)._connect()
    con.close()
    _migrate_all(tmp_path / "b", "medallion")
    con = sqlite3.connect(run_first)
    try:
        run_then_migrated = _table_shape(con, "run_records")
    finally:
        con.close()

    assert migrated_then_run == run_then_migrated


def test_single_profile_against_the_real_tree_fails_loudly_and_explains_why(tmp_path):
    # See the module docstring: the real declarations collide under `single`.
    # The guarantee is that they collide *understandably* -- naming the file and
    # the profile-level cause -- and that the failing file leaves nothing behind.
    base_dir = tmp_path / "single"

    with pytest.raises(MigrationApplyError) as raised:
        _migrate_all(base_dir, "single")

    message = str(raised.value)
    assert "already exists" in message
    assert "two scopes composing into the same physical database" in message
    assert "docs/migrations.md" in message


# --- single / by_layer / by_phase: a synthetic, collision-free tree -------


def _write(root, relative_path, text):
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _build_synthetic_tree(root: Path) -> None:
    """A small tree shaped like the real one, but with globally-unique table names.

    Two subjects (``widgets``, ``gizmos``), each raw+silver+gold, plus a
    ``_shared``/``layer``/``phase``/``platform`` scope file each -- exactly the
    five scope kinds the real tree has, just with names that never collide
    once a coarser profile collapses subjects together.
    """
    _write(
        root, "_shared/0001_create_shared.sql", "CREATE TABLE shared_note (a TEXT);\n"
    )
    _write(
        root,
        "layer/raw/0002_create_layer_raw.sql",
        "CREATE TABLE layer_raw_note (a TEXT);\n",
    )
    _write(
        root,
        "layer/silver/0003_create_layer_silver.sql",
        "CREATE TABLE layer_silver_note (a TEXT);\n",
    )
    _write(
        root,
        "phase/ingest/0004_create_phase.sql",
        "CREATE TABLE phase_note (a TEXT);\n",
    )
    _write(
        root,
        "platform/registry/0005_create_registry.sql",
        "CREATE TABLE run_records (a TEXT);\n",
    )
    _write(
        root,
        "subject/widgets/raw/0006_create_widgets_raw.sql",
        "CREATE TABLE widgets_raw (id TEXT);\n",
    )
    _write(
        root,
        "subject/widgets/silver/0007_create_widgets_silver.sql",
        "CREATE TABLE widgets_silver (id TEXT);\n",
    )
    _write(
        root,
        "subject/widgets/gold/0008_create_widgets_gold.sql",
        "CREATE TABLE widgets_gold (id TEXT);\n",
    )
    _write(
        root,
        "subject/gizmos/raw/0009_create_gizmos_raw.sql",
        "CREATE TABLE gizmos_raw (id TEXT);\n",
    )
    _write(
        root,
        "subject/gizmos/silver/0010_create_gizmos_silver.sql",
        "CREATE TABLE gizmos_silver (id TEXT);\n",
    )
    _write(
        root,
        "subject/gizmos/gold/0011_create_gizmos_gold.sql",
        "CREATE TABLE gizmos_gold (id TEXT);\n",
    )


_SYNTHETIC_TABLES = (
    ("widgets", "raw", "widgets_raw"),
    ("widgets", "silver", "widgets_silver"),
    ("widgets", "gold", "widgets_gold"),
    ("gizmos", "raw", "gizmos_raw"),
    ("gizmos", "silver", "gizmos_silver"),
    ("gizmos", "gold", "gizmos_gold"),
)


def test_single_profile_lands_every_synthetic_table_in_one_warehouse(tmp_path):
    root = tmp_path / "tree"
    _build_synthetic_tree(root)
    base_dir = tmp_path / "base"
    _migrate_all(base_dir, "single", root=root)

    db_path = base_dir / "warehouse.db"
    for _, _, table in _SYNTHETIC_TABLES:
        assert _table_exists(db_path, table), f"warehouse.db missing {table}"
    assert _table_exists(base_dir / "_registry" / "runs.db", "run_records")


def test_by_layer_profile_lands_every_synthetic_table_in_its_layer_file(tmp_path):
    root = tmp_path / "tree"
    _build_synthetic_tree(root)
    base_dir = tmp_path / "base"
    _migrate_all(base_dir, "by_layer", root=root)

    for _, layer, table in _SYNTHETIC_TABLES:
        db_path = base_dir / f"{layer}.db"
        assert _table_exists(db_path, table), f"{layer}.db missing {table}"
    assert _table_exists(base_dir / "_registry" / "runs.db", "run_records")


def test_by_phase_profile_lands_every_synthetic_table_in_its_phase_file(tmp_path):
    root = tmp_path / "tree"
    _build_synthetic_tree(root)
    base_dir = tmp_path / "base"
    _migrate_all(base_dir, "by_phase", root=root)

    for _, layer, table in _SYNTHETIC_TABLES:
        phase = PHASE_BY_LAYER[layer]
        db_path = base_dir / f"{phase}.db"
        assert _table_exists(db_path, table), f"{phase}.db missing {table}"
    assert _table_exists(base_dir / "_registry" / "runs.db", "run_records")


def test_re_migrating_every_synthetic_profile_is_a_no_op(tmp_path):
    root = tmp_path / "tree"
    _build_synthetic_tree(root)
    for profile in ("single", "by_layer", "by_phase"):
        base_dir = tmp_path / profile
        _migrate_all(base_dir, profile, root=root)
        _migrate_all(base_dir, profile, root=root)  # idempotent -- must not raise
