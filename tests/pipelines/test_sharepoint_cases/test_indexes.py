"""Every append-only table the feed writes has an index behind its key.

``SqliteAppendOnlyWriter`` matches each staged row to the target with a
correlated ``EXISTS (SELECT 1 FROM target WHERE <key match>)``. Without an
index on the key that is a full scan of the target per staged row, so a poll
costs (rows in the batch) x (rows ever landed) and slows every day.

Nothing here restates which tables are append-only or what their keys are: one
real poll is driven over databases built from the migrations, and the Writers
the pipeline *actually constructs* -- table, database, key -- are recorded as
they are built. A Detail Table added to the pipeline without an index therefore
fails here without anyone remembering to list it.
"""

from __future__ import annotations

import sqlite3

import pytest

import framework.io.writers as writers
from framework.run import RunContext
from pipelines.sharepoint_cases.pipeline import (
    FEED_NAME,
    PERSON_TABLE,
    LocalJsonListClient,
)
from tests._sharepoint_cases_fixtures import run


class _Spy:
    """What one poll's append-only Writers were built with, and the SQL they ran."""

    def __init__(self) -> None:
        # (database file, table, key columns), one per Writer constructed.
        self.writers: list[tuple[str, str, tuple[str, ...]]] = []
        # database file -> every statement run on a connection to it.
        self.statements: dict[str, list[str]] = {}


@pytest.fixture
def spy(base_dir, monkeypatch):
    spy = _Spy()

    original_init = writers.SqliteAppendOnlyWriter.__init__

    def recording_init(self, db_path, table, key_columns, *args, **kwargs):
        spy.writers.append((str(db_path), table, tuple(key_columns)))
        original_init(self, db_path, table, key_columns, *args, **kwargs)

    original_connect = writers.connect

    def tracing_connect(db_path, *args, **kwargs):
        con = original_connect(db_path, *args, **kwargs)
        con.set_trace_callback(spy.statements.setdefault(str(db_path), []).append)
        return con

    monkeypatch.setattr(writers.SqliteAppendOnlyWriter, "__init__", recording_init)
    monkeypatch.setattr(writers, "connect", tracing_connect)

    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=LocalJsonListClient(),
    )
    return spy


def _index_columns(db_file: str, table: str) -> dict[str, list[str]]:
    """Each index on ``table``, by name, with its columns in index order."""
    con = sqlite3.connect(db_file)
    try:
        names = [row[1] for row in con.execute(f'PRAGMA index_list("{table}")')]
        return {
            name: [row[2] for row in con.execute(f'PRAGMA index_info("{name}")')]
            for name in names
        }
    finally:
        con.close()


def test_the_poll_builds_an_append_only_writer_for_every_table_it_appends(spy):
    # Guards the guard: if the spy saw nothing, every assertion below would
    # pass over an empty list.
    tables = {table for _, table, _ in spy.writers}
    assert {"case_observation", "case_version"} <= tables
    assert len(tables) >= 9, tables
    # `person` is upserted on its account, a different strategy.
    assert PERSON_TABLE not in tables


def test_every_append_only_key_has_an_index_led_by_its_declared_columns(spy):
    unindexed = []
    for db_file, table, key in spy.writers:
        indexes = _index_columns(db_file, table).values()
        if not any(columns[: len(key)] == list(key) for columns in indexes):
            unindexed.append((table, key))
    assert not unindexed, f"append-only keys with no index behind them: {unindexed}"


def test_the_writers_own_match_statements_search_the_index_rather_than_scan(spy):
    checked = set()
    for db_file, table, _key in spy.writers:
        staging = f"{writers._STAGING_PREFIX}{table}"
        # The two statements that match staged rows to the target: the
        # changed-row check and the insert of the unseen keys.
        matches = [
            sql
            for sql in spy.statements[db_file]
            if "EXISTS (SELECT 1 FROM" in sql and f'"{staging}"' in sql
        ]
        assert matches, f"no match statement captured for {table}"

        con = sqlite3.connect(db_file)
        try:
            # The Writer drops its staging table after the commit; an empty
            # copy of the target's shape is enough for the planner.
            con.execute(f'CREATE TABLE "{staging}" AS SELECT * FROM "{table}" WHERE 0')
            for sql in matches:
                plan = [row[3] for row in con.execute(f"EXPLAIN QUERY PLAN {sql}")]
                assert any(
                    detail.startswith(f"SEARCH {table} USING") and "INDEX ix_" in detail
                    for detail in plan
                ), (table, plan)
                assert not any(detail.startswith(f"SCAN {table}") for detail in plan), (
                    table,
                    plan,
                )
        finally:
            con.close()
        checked.add(table)
    assert len(checked) >= 9, checked
