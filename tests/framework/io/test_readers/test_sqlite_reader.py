import sqlite3
from pathlib import Path

import pytest

from framework.io.readers import SqliteKeyedReader, SqliteReader


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
    # Omitting columns reads every column.
    dataset = SqliteReader(fixture_db, "advisers").read()

    assert dataset.columns == ["adviser_id", "name"]


def test_sqlite_reader_reports_the_table_it_read(fixture_db):
    reader = SqliteReader(fixture_db, "advisers")
    reader.read()

    assert reader.data_locations == [
        {"namespace": f"sqlite:{fixture_db.as_posix()}", "name": "advisers"}
    ]


# --- SqliteKeyedReader --------------------------------------------------------


@pytest.fixture
def history_db(tmp_path) -> Path:
    # An append-only history: several rows per key, inserted so that table order
    # and key order disagree.
    db = tmp_path / "history.db"
    con = sqlite3.connect(db)
    try:
        con.execute(
            'CREATE TABLE "obs table" (obs_id TEXT, "my col" INTEGER, n INTEGER)'
        )
        con.executemany(
            'INSERT INTO "obs table" VALUES (?, ?, ?)',
            [("c", 3, 0), ("a", 1, 1), ("b", 2, 2), ("a", 1, 3), ("d", 4, 4)],
        )
        con.commit()
    finally:
        con.close()
    return db


def test_keyed_reader_reads_only_the_rows_whose_column_is_in_the_keys(history_db):
    dataset = SqliteKeyedReader(history_db, "obs table", "obs_id", ["a", "c"]).read()

    assert dataset.columns == ["obs_id", "my col", "n"]
    assert list(dataset.to_pandas()["n"]) == [0, 1, 3]


@pytest.mark.parametrize("indexed", [False, True])
def test_keyed_reader_returns_rows_in_table_order_not_key_order(history_db, indexed):
    # What a whole-table read would give, whichever index the lookup used and
    # however the keys were listed: swapping readers must not reorder a write.
    if indexed:
        with sqlite3.connect(history_db) as con:
            con.execute('CREATE INDEX ix ON "obs table" (obs_id)')
    keys = ["d", "a", "c"]

    got = SqliteKeyedReader(history_db, "obs table", "obs_id", keys).read()

    whole = SqliteReader(history_db, "obs table").read().to_pandas()
    expected = whole[whole["obs_id"].isin(keys)]
    assert list(got.to_pandas()["n"]) == list(expected["n"])


def test_keyed_reader_with_no_keys_reads_no_rows_but_keeps_the_columns(history_db):
    dataset = SqliteKeyedReader(history_db, "obs table", "obs_id", []).read()

    assert dataset.columns == ["obs_id", "my col", "n"]
    assert len(dataset) == 0


def test_keyed_reader_ignores_a_key_the_table_does_not_hold(history_db):
    dataset = SqliteKeyedReader(history_db, "obs table", "obs_id", ["a", "zzz"]).read()

    assert list(dataset.to_pandas()["n"]) == [1, 3]


def test_keyed_reader_matches_a_numeric_column_and_quotes_its_name(history_db):
    dataset = SqliteKeyedReader(history_db, "obs table", "my col", [2, 4]).read()

    assert list(dataset.to_pandas()["obs_id"]) == ["b", "d"]


def test_keyed_reader_treats_keys_as_data_not_sql(history_db):
    keys = ["a') OR 1=1 --"]

    dataset = SqliteKeyedReader(history_db, "obs table", "obs_id", keys).read()

    assert len(dataset) == 0


def test_keyed_reader_has_no_ceiling_on_how_many_keys(tmp_path):
    # A `col IN (?, ?, ...)` list would hit SQLite's bound-variable limit
    # (32,766 by default since 3.32); the keys travel as one JSON parameter.
    db = tmp_path / "big.db"
    wanted = [f"k{i}" for i in range(0, 100_000, 2)]
    with sqlite3.connect(db) as con:
        con.execute("CREATE TABLE t (k TEXT)")
        con.executemany(
            "INSERT INTO t VALUES (?)", [(f"k{i}",) for i in range(100_000)]
        )

    dataset = SqliteKeyedReader(db, "t", "k", wanted).read()

    assert len(dataset) == len(wanted)


def test_keyed_reader_reports_the_table_it_read(history_db):
    reader = SqliteKeyedReader(history_db, "obs table", "obs_id", ["a"])
    reader.read()

    assert reader.data_locations == [
        {"namespace": f"sqlite:{history_db.as_posix()}", "name": "obs table"}
    ]


def test_keyed_reader_describes_its_key_count_not_its_keys(history_db):
    reader = SqliteKeyedReader(history_db, "obs table", "obs_id", ["a", "b"])

    summary = reader.describe()

    assert summary.startswith("SqliteKeyedReader(")
    assert "table='obs table'" in summary
    assert "column='obs_id'" in summary
    assert "2 keys" in summary
    assert "'a'" not in summary


def _query_plan(db: Path, reader: SqliteKeyedReader) -> str:
    # The reader's own statement, asked how SQLite will execute it.
    con = sqlite3.connect(db)
    try:
        rows = con.execute(
            f"EXPLAIN QUERY PLAN {reader._statement()}", ("[]",)
        ).fetchall()
    finally:
        con.close()
    return " | ".join(row[3] for row in rows)


def test_keyed_reader_searches_an_index_on_the_column_when_there_is_one(history_db):
    with sqlite3.connect(history_db) as con:
        con.execute('CREATE INDEX ix_obs ON "obs table" (obs_id)')
    reader = SqliteKeyedReader(history_db, "obs table", "obs_id", [])

    plan = _query_plan(history_db, reader)

    assert "SEARCH" in plan
    assert "USING INDEX ix_obs" in plan


def test_keyed_reader_scans_when_the_column_has_no_index(history_db):
    reader = SqliteKeyedReader(history_db, "obs table", "obs_id", [])

    assert "USING INDEX" not in _query_plan(history_db, reader)
