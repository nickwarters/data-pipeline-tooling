"""``read_live_table``: reading a live table's shape via ``PRAGMA``."""

from __future__ import annotations

import sqlite3

from tools.schema.declaration import Column
from tools.schema.live import LiveTable, read_live_table
from tools.store import DirectoryStoreBackend


def _make_db(base_dir, namespace, table, ddl):
    path = DirectoryStoreBackend().db_file(base_dir, namespace)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute(f"CREATE TABLE {table} ({ddl})")
    con.commit()
    con.close()


def test_read_live_table_returns_none_when_the_database_file_is_absent(tmp_path):
    assert read_live_table(tmp_path, "feed/raw", "widgets") is None


def test_read_live_table_returns_none_when_the_table_is_absent(tmp_path):
    _make_db(tmp_path, "feed/raw", "other", "id TEXT")

    assert read_live_table(tmp_path, "feed/raw", "widgets") is None


def test_read_live_table_reads_columns_and_nullability(tmp_path):
    _make_db(
        tmp_path,
        "feed/silver",
        "widgets",
        "record_id TEXT NOT NULL, amount INTEGER, opened TIMESTAMP",
    )

    live = read_live_table(tmp_path, "feed/silver", "widgets")

    assert live == LiveTable(
        namespace="feed/silver",
        name="widgets",
        columns=(
            Column("record_id", "TEXT", nullable=False),
            Column("amount", "INTEGER", nullable=True),
            Column("opened", "TIMESTAMP", nullable=True),
        ),
    )


def test_read_live_table_defaults_a_typeless_column_to_text(tmp_path):
    # SQLite tolerates a column declared with no type at all.
    _make_db(tmp_path, "feed/raw", "widgets", "anything")

    live = read_live_table(tmp_path, "feed/raw", "widgets")

    assert live is not None
    assert live.columns == (Column("anything", "TEXT", nullable=True),)
