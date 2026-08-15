"""Writers against a database that declares its own shape.

A database carrying a ``schema_migrations`` ledger is under migration control:
its tables are declared by SQL and a Writer must neither create a missing one
nor drop one it was handed. A database without the ledger behaves exactly as it
always has — which is what makes the change additive, and why every test here
has an unmigrated twin.

The ledger is created with plain SQL rather than through ``tools.migrations``.
The rule the Writers implement is "this database carries the ledger table", and
stating it that way keeps this test on the framework's own side of the line. The
loop back to the runner that really writes that ledger is closed in
``tests/integration/test_migrated_writes.py``.
"""

import sqlite3

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io import writers as writers_module
from framework.io.writers import (
    AccumulateByRunWriter,
    MissingTableError,
    QuarantineWriter,
    SqliteAppendOnlyWriter,
    SqliteInsertIfAbsentWriter,
    SqliteInsertOrIgnoreWriter,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
)

CREATE_CASES = """
    CREATE TABLE cases (
        case_id TEXT PRIMARY KEY,
        status  TEXT NOT NULL
    )
"""
INDEX_CASES = "CREATE INDEX idx_cases_status ON cases (status)"


def _dataset(**columns):
    return Dataset.from_pandas(pd.DataFrame(columns))


def _cases(status="open"):
    return _dataset(case_id=["c1", "c2"], status=[status, status])


def _migrate(db_path, *statements):
    """Put ``db_path`` under migration control, applying ``statements`` as DDL.

    The ledger's *presence* is the whole opt-in, so a bare ledger plus whatever
    tables the test declares is a faithful stand-in for a migrated database.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    try:
        con.execute(
            "CREATE TABLE schema_migrations ("
            "name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        for statement in statements:
            con.execute(statement)
        con.commit()
    finally:
        con.close()


def _schema_of(db_path, table):
    con = sqlite3.connect(db_path)
    try:
        return {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE tbl_name = ?", (table,)
            )
        }
    finally:
        con.close()


def _rows(db_path, table):
    con = sqlite3.connect(db_path)
    try:
        return con.execute(f"SELECT * FROM {table}").fetchall()
    finally:
        con.close()


# --- Refresh: replace becomes delete-then-append -----------------------------


def test_refresh_keeps_the_declared_ddl_it_was_handed(tmp_path):
    # The collision this whole change exists for: if_exists="replace" drops the
    # table, so the primary key and index a migration created would be gone
    # after the next nightly run — silently, with the rows still landing.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES, INDEX_CASES)

    SqliteTruncateReloadWriter(db, "cases").write(_cases())

    assert "idx_cases_status" in _schema_of(db, "cases")


def test_refresh_still_replaces_the_rows_rather_than_accumulating(tmp_path):
    # Delete-then-append has to mean the same thing to a reader as the drop did:
    # a second run leaves the second run's rows, not both runs'.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES)
    writer = SqliteTruncateReloadWriter(db, "cases")

    writer.write(_cases("open"))
    writer.write(_cases("closed"))

    assert _rows(db, "cases") == [("c1", "closed"), ("c2", "closed")]


def test_refresh_still_drops_and_recreates_an_unmigrated_table(tmp_path):
    # The other side of the branch. Nothing declares this database's shape, so
    # replace stays replace — including the reshaping that depends on it: a
    # second write with different columns rebuilds the table around them.
    db = tmp_path / "silver.db"
    writer = SqliteTruncateReloadWriter(db, "cases")

    writer.write(_dataset(case_id=["c1"], status=["open"]))
    writer.write(_dataset(case_id=["c1"], outcome=["upheld"]))

    con = sqlite3.connect(db)
    columns = {row[1] for row in con.execute("PRAGMA table_info(cases)")}
    con.close()
    assert columns == {"case_id", "outcome"}


def test_refresh_refuses_a_table_no_migration_declares(tmp_path):
    db = tmp_path / "silver.db"
    _migrate(db)

    with pytest.raises(MissingTableError, match="'cases'"):
        SqliteTruncateReloadWriter(db, "cases").write(_cases())


# --- no implicit creation, per Writer ----------------------------------------


def _write_upsert(db):
    SqliteUpsertWriter(db, "cases", ("case_id",)).write(_cases())


def _write_insert_or_ignore(db):
    SqliteInsertOrIgnoreWriter(db, "cases").write(_cases())


def _write_append_only(db):
    SqliteAppendOnlyWriter(db, "cases", ("case_id",)).write(_cases())


def _write_insert_if_absent(db):
    SqliteInsertIfAbsentWriter(db, "cases", ("case_id",)).write(_cases())


def _write_accumulate(db):
    AccumulateByRunWriter(db, "cases", "r1", "2026-08-15").write(_cases())


def _write_quarantine(db):
    QuarantineWriter(db, "cases").write(_cases())


WRITE_PATHS = {
    "upsert": _write_upsert,
    "insert_or_ignore": _write_insert_or_ignore,
    "append_only": _write_append_only,
    "insert_if_absent": _write_insert_if_absent,
    "accumulate_by_run": _write_accumulate,
    "quarantine": _write_quarantine,
    "refresh": lambda db: SqliteTruncateReloadWriter(db, "cases").write(_cases()),
}


@pytest.mark.parametrize("name", sorted(WRITE_PATHS))
def test_no_writer_conjures_a_table_in_a_migrated_database(tmp_path, name):
    # Every table-backed Writer, one rule: a table a migration forgot fails
    # loudly instead of reappearing with drifted types and no keys. The message
    # names the table and the command that would declare it.
    db = tmp_path / "silver.db"
    _migrate(db)

    with pytest.raises(MissingTableError) as raised:
        WRITE_PATHS[name](db)

    assert "cases" in str(raised.value)
    assert "python -m cli migrate" in str(raised.value)


@pytest.mark.parametrize("name", sorted(WRITE_PATHS))
def test_every_writer_still_creates_its_table_in_an_unmigrated_database(tmp_path, name):
    # The additive half: no ledger, no change. Each Writer creates its target on
    # first write exactly as it always has.
    db = tmp_path / "silver.db"

    WRITE_PATHS[name](db)

    assert len(_rows(db, "cases")) == 2


@pytest.mark.parametrize("name", ["upsert", "insert_or_ignore", "append_only"])
def test_the_merge_writers_land_rows_into_a_declared_table(tmp_path, name):
    # Refusing to create is not refusing to write: given the table its migration
    # declares, each merge Writer merges into it and leaves the DDL alone.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES, INDEX_CASES)

    WRITE_PATHS[name](db)

    assert len(_rows(db, "cases")) == 2
    assert "idx_cases_status" in _schema_of(db, "cases")


def test_a_declared_table_must_carry_every_column_its_writer_writes(tmp_path):
    # The regime in one test. InsertIfAbsent mints a surrogate beside the row,
    # so its migration has to declare that column: SQL owning the shape means
    # SQL owning all of it, and a column the migration missed surfaces as
    # SQLite's own error rather than as a silent widening. That message reads
    # poorly next to MissingTableError, which is the trade decision 4 of #685
    # accepted rather than paying for a pre-write column check on every run.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES)

    with pytest.raises(pd.errors.DatabaseError) as raised:
        _write_insert_if_absent(db)
    assert "no column named id" in str(raised.value.__cause__)

    declared = tmp_path / "declared.db"
    _migrate(
        declared,
        "CREATE TABLE cases (id INTEGER PRIMARY KEY, case_id TEXT, status TEXT)",
    )
    _write_insert_if_absent(declared)
    assert len(_rows(declared, "cases")) == 2


def test_a_streamed_load_is_refused_when_the_session_opens(tmp_path):
    # Not on the first chunk: a stream that has already read half a source
    # before learning its target does not exist has spent that work for nothing.
    db = tmp_path / "gold.db"
    _migrate(db)
    writer = AccumulateByRunWriter(db, "cases", "r1", "2026-08-15")

    with pytest.raises(MissingTableError, match="'cases'"):
        with writer.writing_chunks():
            raise AssertionError("the session should not have opened")


def test_a_streamed_load_into_a_declared_table_keeps_its_ddl(tmp_path):
    db = tmp_path / "gold.db"
    _migrate(
        db,
        "CREATE TABLE cases (case_id TEXT, status TEXT, "
        "logical_run_id TEXT, load_date TEXT)",
        "CREATE INDEX idx_cases_run ON cases (logical_run_id)",
    )
    writer = AccumulateByRunWriter(db, "cases", "r1", "2026-08-15")

    with writer.writing_chunks() as session:
        session.write(_cases())
        session.write(_cases())

    assert len(_rows(db, "cases")) == 4
    assert "idx_cases_run" in _schema_of(db, "cases")


def test_the_quarantine_table_is_declared_like_any_other(tmp_path):
    # Named because it is the easy one to forget: a quarantine reject table is a
    # table in a database like any other, so a migrated quarantine database
    # needs its rejects declared before a run can quarantine anything.
    db = tmp_path / "quarantine.db"
    _migrate(db, "CREATE TABLE rejects (case_id TEXT, failed_rule TEXT)")

    QuarantineWriter(db, "rejects").write(
        _dataset(case_id=["c1"], failed_rule=["status"])
    )

    assert len(_rows(db, "rejects")) == 1
    with pytest.raises(MissingTableError):
        QuarantineWriter(db, "other_rejects").write(
            _dataset(case_id=["c1"], failed_rule=["status"])
        )


def test_the_ledger_check_is_made_once_per_writer(tmp_path, monkeypatch):
    # The check is a sqlite_master lookup, and a streamed load would otherwise
    # repeat it per chunk. Resolved once per Writer instance and cached, so
    # three writes ask once.
    db = tmp_path / "gold.db"
    _migrate(
        db,
        "CREATE TABLE cases (case_id TEXT, status TEXT, "
        "logical_run_id TEXT, load_date TEXT)",
    )
    lookups = 0
    real_probe = writers_module.under_migration_control

    def counting_probe(con):
        nonlocal lookups
        lookups += 1
        return real_probe(con)

    monkeypatch.setattr(writers_module, "under_migration_control", counting_probe)
    writer = AccumulateByRunWriter(db, "cases", "r1", "2026-08-15")

    writer.write(_cases())
    with writer.writing_chunks() as session:
        session.write(_cases())
        session.write(_cases())

    assert lookups == 1
