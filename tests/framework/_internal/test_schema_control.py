"""The one definition of "this database declares its own shape"."""

import sqlite3

from framework._internal.schema_control import LEDGER_TABLE, under_migration_control


def _connect(tmp_path, *statements):
    con = sqlite3.connect(tmp_path / "subject.db")
    for statement in statements:
        con.execute(statement)
    con.commit()
    return con


def test_a_database_carrying_the_ledger_is_under_migration_control(tmp_path):
    con = _connect(tmp_path, f"CREATE TABLE {LEDGER_TABLE} (name TEXT PRIMARY KEY)")
    try:
        assert under_migration_control(con)
    finally:
        con.close()


def test_a_database_without_the_ledger_is_not(tmp_path):
    # Including one with tables in it: what matters is the ledger, not whether
    # anything has been written.
    con = _connect(tmp_path, "CREATE TABLE cases (case_id TEXT)")
    try:
        assert not under_migration_control(con)
    finally:
        con.close()


def test_an_empty_database_is_not(tmp_path):
    con = _connect(tmp_path)
    try:
        assert not under_migration_control(con)
    finally:
        con.close()


def test_the_probe_writes_nothing(tmp_path):
    # A Writer asks this before every load, and an operator command asks it of a
    # live share: asking must not take a write lock or change what is there.
    con = _connect(tmp_path, "CREATE TABLE cases (case_id TEXT)")
    try:
        under_migration_control(con)
        assert not con.in_transaction
        assert [row[0] for row in con.execute("SELECT name FROM sqlite_master")] == [
            "cases"
        ]
    finally:
        con.close()


def test_the_ledger_name_is_the_one_the_runner_writes(tmp_path):
    # The whole reason this lives below both sides: tools.migrations creates the
    # table this constant names, and the Writers look for it. One definition.
    from tools.migrations import LEDGER_TABLE as runner_ledger

    assert runner_ledger is LEDGER_TABLE
