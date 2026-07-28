"""The require-declared-tables guard, and the explicit INSERT path behind it.

Two things are under test here, and the second only exists because of the first.

**The guard** (#324, [ADR 0016]) is a process-wide switch that decides whether
the append-style Writers -- ``AccumulateByRunWriter``, ``QuarantineWriter``,
``SqliteInsertIfAbsentWriter``, and the streaming ``_AppendingChunkWriter`` --
refuse a target no migration has created, or fall back to the
``to_sql(if_exists="append")`` that creates it. **Both** states are exercised
for every one of those sites: guard *off* is what every environment except
``dev`` runs today, and the rest of the suite never sees it, because
``conftest.py``'s autouse fixture runs everything with the guard on. Left
untested, the branch production actually takes would be the one branch nothing
covers -- so this module turns the guard off explicitly, in the one place
that is the point rather than an accident.

**The insert** the guard-on branch uses is hand-rolled (``_insert_rows``)
rather than ``to_sql``, precisely so it cannot create a table. That makes it
this repo's own code, and it has to reproduce what pandas was doing for us:
NULLs for NaN/NaT, values ``sqlite3`` will not bind natively (a
``numpy.int64``, a ``bool``, a ``Timestamp``) rendered the way ``to_sql``
rendered them, in the declared column order, whatever the identifiers are
called. Those are asserted against ``to_sql``'s own output on the same frame,
so "the same as before" is checked rather than asserted from memory.
"""

from __future__ import annotations

import datetime
import sqlite3

import numpy as np
import pandas as pd
import pytest

from framework._internal.connection import connect
from framework.core.dataset import Dataset
from framework.io import writers as writers_module
from framework.io.readers import DatasetReader, SqliteReader
from framework.io.writers import (
    AccumulateByRunWriter,
    MissingTableError,
    QuarantineWriter,
    SqliteInsertIfAbsentWriter,
    require_declared_tables_enabled,
    set_require_declared_tables,
    writing_chunks,
)
from tests.framework_testing import create_table


@pytest.fixture
def guard_off():
    """Run one test with the guard off, whatever ``conftest.py`` set.

    The suite-wide autouse fixture turns the guard *on* for every test; this
    overrides it for the handful that are about the fallback, and restores the
    suite's own state afterwards so ordering cannot matter.
    """
    previous = require_declared_tables_enabled()
    set_require_declared_tables(False)
    yield
    set_require_declared_tables(previous)


def _stamped(frame: pd.DataFrame) -> Dataset:
    """``frame`` plus the run-identity columns an accumulating write adds."""
    return Dataset.from_pandas(
        frame.assign(logical_run_id="", load_date="", pipeline_run_id="")
    )


def _tables(db_path) -> set[str]:
    con = connect(db_path, busy_timeout_ms=5000)
    try:
        return {
            row[0]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        con.close()


# --- the guard is on: every append site refuses an undeclared table ---------


def test_accumulate_by_run_writer_refuses_a_table_no_migration_created(tmp_path):
    db = tmp_path / "gold.db"

    with pytest.raises(MissingTableError) as caught:
        AccumulateByRunWriter(db, "pool", "r1", "2026-05-29").write(
            Dataset.from_pandas(pd.DataFrame({"id": [1]}))
        )

    # The message is the operator's whole fix, so it names the table, the file
    # and the command -- not merely that something was missing.
    assert "pool" in str(caught.value)
    assert str(db) in str(caught.value)
    assert "python -m cli migrate" in str(caught.value)
    assert not db.exists() or "pool" not in _tables(db)


def test_quarantine_writer_refuses_a_table_no_migration_created(tmp_path):
    db = tmp_path / "quarantine.db"

    with pytest.raises(MissingTableError):
        QuarantineWriter(db, "rejects").write(
            Dataset.from_pandas(
                pd.DataFrame({"id": [1], "failed_rule": ["amount out of range"]})
            )
        )


def test_quarantine_writer_refuses_before_deleting_a_prior_logical_run(tmp_path):
    # The run-keyed form takes the _replace_logical_run path (delete, then
    # append) rather than the bare append -- a separate branch, so a separate
    # case.
    db = tmp_path / "quarantine.db"

    with pytest.raises(MissingTableError):
        QuarantineWriter(db, "rejects").write(
            Dataset.from_pandas(pd.DataFrame({"id": [1], "logical_run_id": ["r1"]}))
        )


def test_insert_if_absent_writer_refuses_a_table_no_migration_created(tmp_path):
    db = tmp_path / "ref.db"

    with pytest.raises(MissingTableError):
        SqliteInsertIfAbsentWriter(db, "ref", ("value",)).write(
            Dataset.from_pandas(pd.DataFrame({"value": ["A"]}))
        )


def test_a_streamed_accumulate_refuses_before_a_single_chunk_is_read(tmp_path):
    # The session-open check must fire before the reader is touched: a stream
    # that turns out to yield nothing would otherwise never reach
    # _AppendingChunkWriter, and a missing table would pass silently.
    db = tmp_path / "raw.db"
    writer = AccumulateByRunWriter(db, "feed", "r1", "2026-05-29")

    with pytest.raises(MissingTableError):
        with writing_chunks(writer):
            raise AssertionError("the session must refuse before its body runs")


def test_a_streamed_accumulate_that_writes_no_chunks_still_refuses(tmp_path):
    # The same guarantee stated as behaviour rather than as ordering: a
    # zero-chunk session over a missing table fails loudly rather than
    # succeeding at writing nothing.
    db = tmp_path / "raw.db"
    writer = AccumulateByRunWriter(db, "feed", "r1", "2026-05-29")

    with pytest.raises(MissingTableError):
        with writing_chunks(writer):
            pass


# --- the guard is off: the rollout fallback still creates the table ---------


def test_accumulate_by_run_writer_creates_its_table_with_the_guard_off(
    tmp_path, guard_off
):
    db = tmp_path / "gold.db"

    AccumulateByRunWriter(db, "pool", "r1", "2026-05-29").write(
        Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    )

    assert "pool" in _tables(db)
    assert list(SqliteReader(db, "pool").read().to_pandas()["id"]) == [1, 2]


def test_quarantine_writer_creates_its_table_with_the_guard_off(tmp_path, guard_off):
    db = tmp_path / "quarantine.db"

    QuarantineWriter(db, "rejects").write(
        Dataset.from_pandas(pd.DataFrame({"id": [1], "failed_rule": ["bad"]}))
    )

    assert "rejects" in _tables(db)


def test_insert_if_absent_writer_creates_its_table_with_the_guard_off(
    tmp_path, guard_off
):
    db = tmp_path / "ref.db"

    SqliteInsertIfAbsentWriter(db, "ref", ("value",)).write(
        Dataset.from_pandas(pd.DataFrame({"value": ["A", "B"]}))
    )

    landed = SqliteReader(db, "ref").read().to_pandas()
    assert list(landed["value"]) == ["A", "B"]
    assert list(landed["id"]) == [1, 2]


def test_a_streamed_accumulate_creates_its_table_with_the_guard_off(
    tmp_path, guard_off
):
    db = tmp_path / "raw.db"
    writer = AccumulateByRunWriter(db, "feed", "r1", "2026-05-29")

    with writing_chunks(writer) as chunk_writer:
        chunk_writer.write(Dataset.from_pandas(pd.DataFrame({"id": [1, 2]})))
        chunk_writer.write(Dataset.from_pandas(pd.DataFrame({"id": [3]})))

    assert list(SqliteReader(db, "feed").read().to_pandas()["id"]) == [1, 2, 3]


def test_the_guard_defaults_off_in_a_fresh_process(tmp_path):
    # Asserted through a subprocess rather than by reading the module global,
    # because the default that matters is the one a script or library caller
    # that never activates an environment actually gets -- conftest.py's
    # autouse fixture has already overridden the in-process value.
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[4]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from framework.io.writers import require_declared_tables_enabled;"
            "print(require_declared_tables_enabled())",
        ],
        capture_output=True,
        text=True,
        cwd=root,
    )

    assert result.stdout.strip() == "False", result.stderr


# --- the explicit insert reproduces what to_sql was doing -------------------


def _to_sql_baseline(tmp_path, ddl: str, frame: pd.DataFrame) -> list[tuple]:
    """What ``to_sql`` lands for ``frame``, as the comparison baseline."""
    con = sqlite3.connect(tmp_path / "baseline.db")
    try:
        con.execute(ddl)
        frame.to_sql("t", con, if_exists="append", index=False)
        return con.execute("SELECT * FROM t").fetchall()
    finally:
        con.close()


def test_the_explicit_insert_lands_exactly_what_to_sql_landed(tmp_path):
    # Every value kind pandas hands over that sqlite3 will not bind as-is: a
    # NaN, a NaT, a nullable-integer NA, a numpy int64, a bool, a Timestamp.
    ddl = "CREATE TABLE t (n INTEGER, f REAL, ts TEXT, s TEXT, b INTEGER)"
    frame = pd.DataFrame(
        {
            "n": pd.array([np.int64(7), None], dtype="Int64"),
            "f": [1.5, np.nan],
            "ts": pd.to_datetime(["2026-01-01 03:04:05", None]),
            "s": ["x", None],
            "b": [True, False],
        }
    )

    con = sqlite3.connect(tmp_path / "explicit.db")
    try:
        con.execute(ddl)
        writers_module._insert_rows(con, "t", frame)
        landed = con.execute("SELECT * FROM t").fetchall()
    finally:
        con.close()

    assert landed == _to_sql_baseline(tmp_path, ddl, frame)
    assert landed == [(7, 1.5, "2026-01-01 03:04:05", "x", 1), (None,) * 4 + (0,)]


def test_the_explicit_insert_renders_a_bare_date_the_way_to_sql_did(tmp_path):
    ddl = "CREATE TABLE t (d TEXT)"
    frame = pd.DataFrame({"d": [datetime.date(2026, 2, 3), None]})

    con = sqlite3.connect(tmp_path / "explicit.db")
    try:
        con.execute(ddl)
        writers_module._insert_rows(con, "t", frame)
        landed = con.execute("SELECT * FROM t").fetchall()
    finally:
        con.close()

    assert (
        landed == _to_sql_baseline(tmp_path, ddl, frame) == [("2026-02-03",), (None,)]
    )


def test_the_explicit_insert_names_its_columns_so_frame_order_cannot_matter(tmp_path):
    # The frame arrives in a different order from the table's own; naming the
    # columns in the INSERT is what keeps the values in the right ones.
    con = sqlite3.connect(tmp_path / "t.db")
    try:
        con.execute('CREATE TABLE t ("case ref" TEXT, amount INTEGER)')
        writers_module._insert_rows(
            con, "t", pd.DataFrame({"amount": [42], "case ref": ["c1"]})
        )
        assert con.execute("SELECT * FROM t").fetchall() == [("c1", 42)]
    finally:
        con.close()


def test_the_explicit_insert_does_nothing_for_an_empty_frame(tmp_path):
    con = sqlite3.connect(tmp_path / "t.db")
    try:
        con.execute("CREATE TABLE t (id INTEGER)")
        writers_module._insert_rows(con, "t", pd.DataFrame({"id": []}))
        assert con.execute("SELECT count(*) FROM t").fetchone() == (0,)
    finally:
        con.close()


# --- batching is sized off this SQLite build, never hardcoded ---------------


def test_rows_per_statement_divides_this_build_s_own_variable_limit():
    con = sqlite3.connect(":memory:")
    try:
        limit = con.getlimit(writers_module._SQLITE_LIMIT_VARIABLE_NUMBER)
        # Whatever the build's limit is (250,000 on 3.45, 32,766 older, 999
        # pre-3.32), the batch is derived from it rather than from a constant.
        assert writers_module._rows_per_statement(con, 10) == limit // 10
    finally:
        con.close()


def test_rows_per_statement_batches_a_table_exactly_as_wide_as_the_limit():
    con = sqlite3.connect(":memory:")
    try:
        limit = con.getlimit(writers_module._SQLITE_LIMIT_VARIABLE_NUMBER)
        # The widest table that can still be inserted at all: one row per
        # statement, which is what the max(1, ...) floor is for.
        assert writers_module._rows_per_statement(con, limit) == 1
    finally:
        con.close()


def test_rows_per_statement_refuses_a_table_wider_than_the_limit_by_name():
    # No parameterised INSERT can carry such a row -- not even one row at a
    # time -- so the refusal names the build's limit and the column count
    # rather than letting SQLite's context-free "too many SQL variables"
    # surface from inside the batching loop.
    con = sqlite3.connect(":memory:")
    try:
        con.setlimit(writers_module._SQLITE_LIMIT_VARIABLE_NUMBER, 4)
        with pytest.raises(ValueError) as caught:
            writers_module._rows_per_statement(con, 5)
    finally:
        con.close()

    assert "5 columns" in str(caught.value)
    assert "at most 4" in str(caught.value)


def test_a_wide_frame_lands_whole_across_several_batched_statements(tmp_path):
    # A deliberately tiny variable limit forces the batching to actually
    # split: 4 columns against a limit of 9 is 2 rows per statement, so 5 rows
    # take three statements. All 5 must land, in order, exactly once.
    columns = [f"c{i}" for i in range(4)]
    frame = pd.DataFrame({c: [f"{c}-{r}" for r in range(5)] for c in columns})
    con = sqlite3.connect(tmp_path / "t.db")
    try:
        con.setlimit(writers_module._SQLITE_LIMIT_VARIABLE_NUMBER, 9)
        assert writers_module._rows_per_statement(con, len(columns)) == 2
        con.execute("CREATE TABLE t (" + ", ".join(f"{c} TEXT" for c in columns) + ")")
        writers_module._insert_rows(con, "t", frame)
        landed = con.execute("SELECT * FROM t").fetchall()
    finally:
        con.close()

    assert landed == list(frame.itertuples(index=False, name=None))


def test_a_table_exactly_as_wide_as_the_limit_lands_a_row_per_statement(tmp_path):
    # The max(1, ...) floor is not theoretical: with a limit of 5 and 5
    # columns, batching two rows into one statement would exceed what SQLite
    # allows, so each row must go on its own.
    columns = [f"c{i}" for i in range(5)]
    frame = pd.DataFrame({c: [1, 2] for c in columns})
    con = sqlite3.connect(tmp_path / "t.db")
    try:
        con.setlimit(writers_module._SQLITE_LIMIT_VARIABLE_NUMBER, 5)
        con.execute(
            "CREATE TABLE t (" + ", ".join(f"{c} INTEGER" for c in columns) + ")"
        )
        writers_module._insert_rows(con, "t", frame)
        assert con.execute("SELECT count(*) FROM t").fetchone() == (2,)
    finally:
        con.close()


# --- the guard changes what a Writer refuses, never when it commits ---------


def test_the_streamed_session_still_clears_the_run_once_then_appends(tmp_path):
    # The session-open presence check sits alongside the idempotency DELETE
    # that was already there. The shape it guards must be unchanged: clear this
    # logical run's prior rows once, then append each chunk.
    db = tmp_path / "raw.db"
    create_table(db, "feed", _stamped(pd.DataFrame({"id": []})))
    AccumulateByRunWriter(db, "feed", "r1", "2026-05-29").write(
        Dataset.from_pandas(pd.DataFrame({"id": [99]}))
    )

    writer = AccumulateByRunWriter(db, "feed", "r1", "2026-05-29")
    with writing_chunks(writer) as chunk_writer:
        for chunk in ([1, 2], [3]):
            chunk_writer.write(Dataset.from_pandas(pd.DataFrame({"id": chunk})))

    landed = SqliteReader(db, "feed").read().to_pandas()
    assert list(landed["id"]) == [1, 2, 3]  # 99 cleared once, not re-cleared


def test_a_pipeline_write_through_a_migrated_table_lands_real_rows(tmp_path):
    # End to end through the public wiring rather than the Writer alone: the
    # guard is on, the table came from create_table (a migration's stand-in),
    # and the rows arrive.
    from framework.run.builder import Pipeline
    from tests.framework_testing import RecordingRunLog

    db = tmp_path / "gold.db"
    source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))
    create_table(db, "pool", _stamped(source.to_pandas()))

    p = Pipeline("selection", run_log=RecordingRunLog())
    read = p.read(DatasetReader(source), name="read")
    p.write(
        AccumulateByRunWriter(db, "pool", "r1", "2026-05-29", pipeline_run_id="p1"),
        read,
        name="write",
    )
    p.run()

    landed = SqliteReader(db, "pool").read().to_pandas()
    assert list(landed["case_ref"]) == ["c1", "c2"]
    assert set(landed["logical_run_id"]) == {"r1"}
