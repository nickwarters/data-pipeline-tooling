import sqlite3
from pathlib import Path

import pytest

from framework.readers import SqliteReader


@pytest.fixture
def fixture_db(tmp_path) -> Path:
    # Build a local fixture database with stdlib sqlite3 — independent of the
    # framework's Writers, so the reader is exercised against an arbitrary db,
    # not just its own round-trip. Two tables prove table selection.
    db = tmp_path / "reference.db"
    con = sqlite3.connect(db)
    try:
        con.execute("CREATE TABLE advisers (adviser_id INTEGER, name TEXT)")
        con.executemany(
            "INSERT INTO advisers VALUES (?, ?)",
            [(1, "Ada"), (2, "Linus"), (3, "Grace")],
        )
        con.execute("CREATE TABLE products (code TEXT)")
        con.execute("INSERT INTO products VALUES ('ISA')")
        con.commit()
    finally:
        con.close()
    return db


def test_reads_the_named_table_into_a_dataset(fixture_db):
    dataset = SqliteReader(fixture_db, "advisers").read()

    assert dataset.columns == ["adviser_id", "name"]
    assert len(dataset) == 3


def test_reads_a_different_table_from_the_same_db(fixture_db):
    # The source location is (db file + table): pointing at another table reads
    # that one, no other config change.
    dataset = SqliteReader(fixture_db, "products").read()

    assert dataset.columns == ["code"]
    assert len(dataset) == 1


def test_sqlite_reader_projects_only_requested_columns(fixture_db):
    # When columns=[...] is supplied only those columns should appear in the
    # returned Dataset; row count is unchanged.
    dataset = SqliteReader(fixture_db, "advisers", columns=["name"]).read()

    assert dataset.columns == ["name"]
    assert len(dataset) == 3


def test_sqlite_reader_without_columns_reads_all_columns(fixture_db):
    # Omitting columns preserves read-everything behaviour (regression guard).
    dataset = SqliteReader(fixture_db, "advisers").read()

    assert dataset.columns == ["adviser_id", "name"]
