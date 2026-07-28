"""``plan_database``/``apply_database``: idempotency, checksum drift, rollback."""

from __future__ import annotations

import sqlite3

import pytest

from tools.migrations.discovery import Migration
from tools.migrations.ledger import LEDGER_TABLE
from tools.migrations.runner import (
    ChecksumMismatchError,
    MigrationApplyError,
    apply_database,
    plan_database,
    split_sql_statements,
)
from tools.migrations.scope import shared_scope
from tools.migrations.topology import Database


def _write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    import hashlib

    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    version, slug = name.split("_", 1)
    return Migration(
        version=version,
        slug=slug.removesuffix(".sql"),
        scope=shared_scope(),
        path=path,
        checksum=checksum,
    )


def test_split_sql_statements_keeps_leading_comments_with_their_statement():
    text = "-- a comment\n-- more\nCREATE TABLE t (a TEXT);\n"
    statements = split_sql_statements(text)
    assert len(statements) == 1
    assert "CREATE TABLE t" in statements[0]


def test_split_sql_statements_splits_multiple():
    text = "CREATE TABLE t (a TEXT);\nINSERT INTO t VALUES ('x');\n"
    assert len(split_sql_statements(text)) == 2


def test_split_sql_statements_raises_on_incomplete_trailing_statement():
    with pytest.raises(ValueError, match="incomplete"):
        split_sql_statements("CREATE TABLE t (a TEXT)")  # no trailing ';'


@pytest.mark.parametrize("keyword", ["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT s"])
def test_split_refuses_a_file_that_owns_its_own_transaction(keyword):
    # The runner owns the transaction boundary. SQLite's published 12-step
    # rebuild recipe is written with an explicit COMMIT, so this is a mistake a
    # careful author following the docs would make -- and it would let a later
    # failure leave the file half-applied and unrecorded.
    with pytest.raises(ValueError, match="own"):
        split_sql_statements(f"CREATE TABLE t (a TEXT);\n{keyword};\n")


def test_a_commit_inside_a_file_cannot_break_the_rollback_guarantee(tmp_path):
    migration = _write(
        tmp_path,
        "0001_sneaky.sql",
        "CREATE TABLE t (a TEXT);\nCOMMIT;\nNOT VALID SQL;\n",
    )
    database = Database(relative_path=tmp_path / "db.sqlite", migrations=(migration,))

    with pytest.raises(MigrationApplyError, match="0001_sneaky.sql"):
        apply_database(database, database.relative_path)

    con = sqlite3.connect(database.relative_path)
    tables = con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    con.close()
    assert ("t",) not in tables  # the early COMMIT did not let `t` survive


def test_apply_creates_and_records_ledger(tmp_path):
    migration = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")
    database = Database(relative_path=tmp_path / "db.sqlite", migrations=(migration,))

    result = apply_database(database, database.relative_path)

    assert [m.version for m in result.applied] == ["0001"]
    con = sqlite3.connect(database.relative_path)
    assert con.execute("SELECT a FROM t").fetchall() == []
    ledger_rows = con.execute(f"SELECT version FROM {LEDGER_TABLE}").fetchall()
    assert ledger_rows == [("0001",)]
    con.close()


def test_apply_is_idempotent(tmp_path):
    migration = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")
    database = Database(relative_path=tmp_path / "db.sqlite", migrations=(migration,))

    apply_database(database, database.relative_path)
    second = apply_database(database, database.relative_path)

    assert second.applied == ()
    assert [m.version for m in second.already_applied] == ["0001"]


def test_apply_two_files_in_order(tmp_path):
    first = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")
    second = _write(tmp_path, "0002_add.sql", "ALTER TABLE t ADD COLUMN b TEXT;\n")
    database = Database(
        relative_path=tmp_path / "db.sqlite", migrations=(first, second)
    )

    apply_database(database, database.relative_path)

    con = sqlite3.connect(database.relative_path)
    cols = [row[1] for row in con.execute("PRAGMA table_info(t)")]
    assert cols == ["a", "b"]
    con.close()


def test_a_failing_statement_rolls_back_the_whole_file(tmp_path):
    migration = _write(
        tmp_path,
        "0001_bad.sql",
        "CREATE TABLE t (a TEXT);\nINSERT INTO t VALUES ('x');\nNOT VALID SQL;\n",
    )
    database = Database(relative_path=tmp_path / "db.sqlite", migrations=(migration,))

    with pytest.raises(MigrationApplyError) as raised:
        apply_database(database, database.relative_path)

    # The error names the file, the database and the offending statement --
    # never a bare sqlite3 message with no context.
    message = str(raised.value)
    assert "0001_bad.sql" in message
    assert str(database.relative_path) in message
    assert "NOT VALID SQL" in message

    con = sqlite3.connect(database.relative_path)
    tables = con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    con.close()
    assert tables == []  # neither the table, its row, nor the ledger row survived


def test_a_colliding_create_rolls_back_but_leaves_the_earlier_file_applied(tmp_path):
    # Two files that both create the same table: the second fails and rolls
    # back whole, but the first file's own transaction already committed.
    first = _write(tmp_path, "0001_first.sql", "CREATE TABLE t (a TEXT);\n")
    second = _write(tmp_path, "0002_second.sql", "CREATE TABLE t (b TEXT);\n")
    database = Database(
        relative_path=tmp_path / "db.sqlite", migrations=(first, second)
    )

    with pytest.raises(MigrationApplyError) as raised:
        apply_database(database, database.relative_path)

    message = str(raised.value)
    assert "0002_second.sql" in message
    assert "already exists" in message
    # ...and the first file stayed applied: each file is its own transaction.
    con = sqlite3.connect(database.relative_path)
    assert con.execute(f"SELECT version FROM {LEDGER_TABLE}").fetchall() == [("0001",)]
    con.close()


def test_plan_never_writes_to_the_database(tmp_path):
    # `--plan`/`--status` promise to touch nothing, and creating a ledger table
    # in someone's production database is touching something.
    db_path = tmp_path / "db.sqlite"
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE pre_existing (a TEXT)")
    con.commit()
    con.close()
    migration = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")

    plan = plan_database(
        Database(relative_path=db_path, migrations=(migration,)), db_path
    )

    assert [line.applied for line in plan.lines] == [False]
    con = sqlite3.connect(db_path)
    tables = [
        row[0]
        for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
    ]
    con.close()
    assert tables == ["pre_existing"]  # no schema_migrations created by planning


def test_applied_migration_whose_file_changed_is_a_hard_error(tmp_path):
    migration = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")
    database = Database(relative_path=tmp_path / "db.sqlite", migrations=(migration,))
    apply_database(database, database.relative_path)

    edited = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT, b TEXT);\n")
    edited_database = Database(
        relative_path=database.relative_path, migrations=(edited,)
    )

    with pytest.raises(ChecksumMismatchError, match="0001_create.sql"):
        plan_database(edited_database, database.relative_path)
    with pytest.raises(ChecksumMismatchError):
        apply_database(edited_database, database.relative_path)


def test_to_truncates_which_migrations_apply(tmp_path):
    first = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")
    second = _write(tmp_path, "0002_add.sql", "ALTER TABLE t ADD COLUMN b TEXT;\n")
    database = Database(
        relative_path=tmp_path / "db.sqlite", migrations=(first, second)
    )

    result = apply_database(database, database.relative_path, to="0001")

    assert [m.version for m in result.applied] == ["0001"]
    con = sqlite3.connect(database.relative_path)
    cols = [row[1] for row in con.execute("PRAGMA table_info(t)")]
    con.close()
    assert cols == ["a"]


def test_plan_reports_out_of_order_pending(tmp_path):
    first = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")
    second = _write(tmp_path, "0002_add.sql", "ALTER TABLE t ADD COLUMN b TEXT;\n")
    database = Database(relative_path=tmp_path / "db.sqlite", migrations=(first,))
    apply_database(database, database.relative_path)

    both_database = Database(
        relative_path=database.relative_path, migrations=(second, first)
    )
    plan = plan_database(both_database, database.relative_path)

    lines_by_version = {line.migration.version: line for line in plan.lines}
    assert lines_by_version["0001"].applied
    assert not lines_by_version["0002"].applied
    assert not lines_by_version["0002"].out_of_order  # 0002 > max applied (0001)


def test_plan_flags_a_lower_version_pending_after_a_higher_one_applied(tmp_path):
    # Apply 0002 first (out-of-band), then plan against both -- 0001 pending
    # after a higher version is already applied is the "out of order" case.
    first = _write(tmp_path, "0001_create.sql", "CREATE TABLE t (a TEXT);\n")
    second = _write(tmp_path, "0002_other.sql", "CREATE TABLE u (a TEXT);\n")
    only_second = Database(relative_path=tmp_path / "db.sqlite", migrations=(second,))
    apply_database(only_second, only_second.relative_path)

    both = Database(relative_path=only_second.relative_path, migrations=(first, second))
    plan = plan_database(both, both.relative_path)

    lines_by_version = {line.migration.version: line for line in plan.lines}
    assert lines_by_version["0001"].out_of_order
    assert lines_by_version["0002"].applied
