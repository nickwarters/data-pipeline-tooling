"""``tools.schema.emit``: replaying tracked shape, and generating migration SQL."""

from __future__ import annotations

import hashlib

import pytest

from tools.migrations.discovery import Migration
from tools.migrations.scope import subject_layer_scope
from tools.schema.declaration import Column, Table
from tools.schema.emit import (
    MigrationReplayError,
    generate_migration_sql,
    replay_tracked_shapes,
    slug_for,
    tracked_columns_for,
)
from tools.schema.live import LiveTable, diff_tables


@pytest.fixture
def committed(tmp_path):
    """Write a migration file into a scratch tree and hand back its Migration."""
    counter = [0]

    def write(sql: str) -> Migration:
        counter[0] += 1
        version = f"{counter[0]:04d}"
        path = tmp_path / f"{version}_step.sql"
        path.write_text(sql, encoding="utf-8")
        return Migration(
            version=version,
            slug="step",
            scope=subject_layer_scope("widgets_feed", "silver"),
            path=path,
            checksum=hashlib.sha256(path.read_bytes()).hexdigest(),
        )

    return write


def test_tracked_columns_for_is_none_before_any_create():
    assert tracked_columns_for("widgets", []) is None


def test_tracked_columns_for_replays_a_create_table(committed):
    create = committed(
        "CREATE TABLE widgets (\n    id TEXT,\n    amount INTEGER NOT NULL\n);\n"
    )
    assert tracked_columns_for("widgets", [create]) == (
        Column("id", "TEXT", nullable=True),
        Column("amount", "INTEGER", nullable=False),
    )


def test_tracked_columns_for_replays_add_column_after_create(committed):
    create = committed("CREATE TABLE widgets (\n    id TEXT\n);\n")
    add = committed("ALTER TABLE widgets ADD COLUMN amount INTEGER;\n")
    columns = tracked_columns_for("widgets", [create, add])
    assert [c.name for c in columns] == ["id", "amount"]


def test_tracked_columns_for_ignores_a_different_table(committed):
    other = committed("CREATE TABLE other (\n    id TEXT\n);\n")
    assert tracked_columns_for("widgets", [other]) is None


def test_a_hand_added_backfill_changes_no_shape(committed):
    # The documented authoring flow: generation writes the DDL, a human adds
    # the DML before committing. Replaying it must be harmless.
    both = committed(
        "CREATE TABLE widgets (\n    id TEXT\n);\n\n"
        "UPDATE widgets SET id = 'x' WHERE id IS NULL;\n"
    )
    assert [c.name for c in tracked_columns_for("widgets", [both])] == ["id"]


def test_a_hand_written_12_step_rebuild_is_reflected_exactly(committed):
    # migrations/README.md tells authors to hand-write this for a retype. A
    # replay that only understood generated statements would report the
    # pre-rebuild shape and then emit a duplicate ADD COLUMN for `status`.
    create = committed("CREATE TABLE widgets (id TEXT, amount TEXT);\n")
    rebuild = committed(
        "CREATE TABLE widgets_new (id TEXT, amount REAL, status TEXT);\n"
        "INSERT INTO widgets_new (id, amount) SELECT id, amount FROM widgets;\n"
        "DROP TABLE widgets;\n"
        "ALTER TABLE widgets_new RENAME TO widgets;\n"
    )
    columns = tracked_columns_for("widgets", [create, rebuild])
    assert [(c.name, c.sql_type) for c in columns] == [
        ("id", "TEXT"),
        ("amount", "REAL"),
        ("status", "TEXT"),
    ]


def test_a_hand_written_drop_column_is_reflected(committed):
    create = committed("CREATE TABLE widgets (id TEXT, amount TEXT);\n")
    drop = committed("ALTER TABLE widgets DROP COLUMN amount;\n")
    assert [c.name for c in tracked_columns_for("widgets", [create, drop])] == ["id"]


def test_a_hand_written_rename_column_is_reflected(committed):
    create = committed("CREATE TABLE widgets (id TEXT, amount TEXT);\n")
    rename = committed("ALTER TABLE widgets RENAME COLUMN amount TO gross_amount;\n")
    columns = tracked_columns_for("widgets", [create, rename])
    assert [c.name for c in columns] == ["id", "gross_amount"]


def test_sql_sqlite_refuses_is_a_hard_error_naming_the_file(committed):
    broken = committed("ALTER TABLE never_created ADD COLUMN x TEXT;\n")

    with pytest.raises(MigrationReplayError, match=r"0001_step\.sql"):
        replay_tracked_shapes([broken])


def test_a_file_with_its_own_commit_is_refused_at_replay_too(committed):
    # The runner refuses it at apply time; authoring must not silently accept a
    # file that could never be applied.
    bad = committed("CREATE TABLE widgets (id TEXT);\nCOMMIT;\n")

    with pytest.raises(MigrationReplayError, match="COMMIT"):
        replay_tracked_shapes([bad])


def test_replay_reports_every_table_the_scope_builds(committed):
    first = committed("CREATE TABLE widgets (id TEXT);\n")
    second = committed("CREATE TABLE gadgets (id TEXT);\n")

    assert set(replay_tracked_shapes([first, second])) == {"widgets", "gadgets"}


def test_generate_migration_sql_for_a_never_created_table():
    table = Table(
        "raw",
        "widgets",
        columns=(Column("id", "TEXT"), Column("amount", "INTEGER", nullable=False)),
    )
    diff = diff_tables(table, None)

    sql = generate_migration_sql(
        table, "widgets_feed", diff, version="0001", namespace="raw"
    )

    assert 'CREATE TABLE "widgets"' in sql  # identifiers are always quoted (#324)
    assert '"id" TEXT' in sql
    assert '"amount" INTEGER NOT NULL' in sql
    assert "generated from pipelines/widgets_feed's declared TABLES" in sql
    assert "declaration rev 0001" in sql


def test_generated_ddl_for_non_identifier_column_names_is_valid_sql():
    # Not cosmetic: a raw Table seeded from a real feed file's header carries
    # the source's own column names (spaces, punctuation, reserved words), and
    # `scaffold --from-feed-file` now routinely generates migrations for
    # exactly that. Unquoted, this DDL is a syntax error -- so the test runs it
    # rather than pattern-matching the text.
    import sqlite3

    table = Table(
        "raw",
        "order lines",
        columns=(
            Column("Case Number", "TEXT"),
            Column("select", "TEXT"),  # a SQL keyword
            Column('odd"name', "TEXT"),  # an embedded quote
        ),
    )
    sql = generate_migration_sql(
        table, "orders", diff_tables(table, None), version="0001", namespace="raw"
    )

    con = sqlite3.connect(":memory:")
    try:
        con.executescript(sql)
        landed = con.execute('PRAGMA table_info("order lines")').fetchall()
    finally:
        con.close()

    assert [row[1] for row in landed] == ["Case Number", "select", 'odd"name']


def test_generate_migration_sql_for_a_missing_column():
    table = Table(
        "silver", "widgets", columns=(Column("id", "TEXT"), Column("amount", "INTEGER"))
    )
    live = LiveTable("silver", "widgets", columns=(Column("id", "TEXT"),))
    diff = diff_tables(table, live)

    sql = generate_migration_sql(
        table, "widgets_feed", diff, version="0002", namespace="silver"
    )

    assert 'ALTER TABLE "widgets" ADD COLUMN "amount" INTEGER' in sql


def test_generate_migration_sql_adds_a_default_for_a_not_null_column():
    table = Table(
        "silver",
        "widgets",
        columns=(Column("id", "TEXT"), Column("amount", "INTEGER", nullable=False)),
    )
    live = LiveTable("silver", "widgets", columns=(Column("id", "TEXT"),))
    diff = diff_tables(table, live)

    sql = generate_migration_sql(
        table, "widgets_feed", diff, version="0002", namespace="silver"
    )

    assert "NOT NULL DEFAULT 0" in sql


def test_a_generated_file_applies_cleanly_on_top_of_its_own_baseline(committed):
    # The generator's whole contract: what it emits must apply to the shape it
    # diffed against. Replay the baseline, generate, then replay both.
    create = committed("CREATE TABLE widgets (id TEXT);\n")
    table = Table(
        "silver", "widgets", columns=(Column("id", "TEXT"), Column("amount", "INTEGER"))
    )
    tracked = tracked_columns_for("widgets", [create])
    diff = diff_tables(table, LiveTable("silver", "widgets", tracked))

    generated = committed(
        generate_migration_sql(
            table, "widgets_feed", diff, version="0002", namespace="silver"
        )
    )

    columns = tracked_columns_for("widgets", [create, generated])
    assert [c.name for c in columns] == ["id", "amount"]


def test_generate_migration_sql_is_none_for_a_pure_type_change():
    table = Table("silver", "widgets", columns=(Column("amount", "TEXT"),))
    live = LiveTable("silver", "widgets", columns=(Column("amount", "REAL"),))
    diff = diff_tables(table, live)

    assert generate_migration_sql(table, "widgets_feed", diff, version="0003") is None


def test_generate_migration_sql_is_none_when_clean():
    table = Table("silver", "widgets", columns=(Column("amount", "TEXT"),))
    live = LiveTable("silver", "widgets", columns=(Column("amount", "TEXT"),))
    diff = diff_tables(table, live)

    assert generate_migration_sql(table, "widgets_feed", diff, version="0004") is None


def test_generate_migration_sql_flags_raw_type_drift():
    table = Table("raw", "widgets", columns=(Column("amount", "INTEGER"),))
    diff = diff_tables(table, None)

    sql = generate_migration_sql(
        table, "widgets_feed", diff, version="0005", namespace="raw"
    )

    assert "raw is meant to be TEXT throughout" in sql
    assert "a *new* forward migration" in sql


def test_generate_migration_sql_flags_undeclared_primary_key_and_indexes():
    table = Table(
        "silver", "widgets", columns=(Column("id", "TEXT"),), primary_key=("id",)
    )
    diff = diff_tables(table, None)

    sql = generate_migration_sql(
        table, "widgets_feed", diff, version="0006", namespace="silver"
    )

    assert "primary_key=" in sql
    assert "does not emit" in sql


def test_slug_for_create_vs_add():
    table = Table(
        "silver", "widgets", columns=(Column("id", "TEXT"), Column("amount", "TEXT"))
    )
    pending = diff_tables(table, None)
    assert slug_for(table, pending) == "create_widgets"

    live = LiveTable("silver", "widgets", columns=(Column("id", "TEXT"),))
    drifted = diff_tables(table, live)
    assert slug_for(table, drifted) == "add_amount"
