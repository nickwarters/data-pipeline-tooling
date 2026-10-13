```python
"""Writers preserve declared DDL and reject missing tables in migrated databases.

Without a migration ledger, Writers retain their table-creation behaviour. A
column the target lacks is the one level down: it cannot be refused before the
write (no Writer reads the column set on the happy path), so it is SQLite's own
complaint, translated on the way out into the expected-failure family.
"""

import sqlite3

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.writers import (
    AccumulateByRunWriter,
    MissingColumnError,
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


def test_refresh_keeps_the_declared_ddl_it_was_handed(tmp_path):
    # Replace drops the migrated table, keys, and indexes; refresh retains its
    # DDL while replacing the rows.
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


def _write_upsert(db, dataset):
    SqliteUpsertWriter(db, "cases", ("case_id",)).write(dataset)


def _write_insert_or_ignore(db, dataset):
    SqliteInsertOrIgnoreWriter(db, "cases").write(dataset)


def _write_append_only(db, dataset):
    SqliteAppendOnlyWriter(db, "cases", ("case_id",)).write(dataset)


def _write_insert_if_absent(db, dataset):
    SqliteInsertIfAbsentWriter(db, "cases", ("case_id",)).write(dataset)


def _write_accumulate(db, dataset):
    AccumulateByRunWriter(db, "cases", "r1", "2026-08-15").write(dataset)


def _write_quarantine(db, dataset):
    QuarantineWriter(db, "cases").write(dataset)


WRITE_PATHS = {
    "upsert": _write_upsert,
    "insert_or_ignore": _write_insert_or_ignore,
    "append_only": _write_append_only,
    "insert_if_absent": _write_insert_if_absent,
    "accumulate_by_run": _write_accumulate,
    "quarantine": _write_quarantine,
    "refresh": lambda db, dataset: SqliteTruncateReloadWriter(db, "cases").write(
        dataset
    ),
}


@pytest.mark.parametrize("name", sorted(WRITE_PATHS))
def test_no_writer_conjures_a_table_in_a_migrated_database(tmp_path, name):
    # Every table-backed Writer, one rule: a table a migration forgot fails
    # loudly instead of reappearing with drifted types and no keys. The message
    # names the table and the command that would declare it.
    db = tmp_path / "silver.db"
    _migrate(db)

    with pytest.raises(MissingTableError) as raised:
        WRITE_PATHS[name](db, _cases())

    assert "cases" in str(raised.value)
    assert "python -m cli migrate" in str(raised.value)


@pytest.mark.parametrize("name", sorted(WRITE_PATHS))
def test_every_writer_still_creates_its_table_in_an_unmigrated_database(tmp_path, name):
    # The additive half: no ledger, no change. Each Writer creates its target on
    # first write exactly as it always has.
    db = tmp_path / "silver.db"

    WRITE_PATHS[name](db, _cases())

    assert len(_rows(db, "cases")) == 2


@pytest.mark.parametrize("name", ["upsert", "insert_or_ignore", "append_only"])
def test_the_merge_writers_land_rows_into_a_declared_table(tmp_path, name):
    # Refusing to create is not refusing to write: given the table its migration
    # declares, each merge Writer merges into it and leaves the DDL alone.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES, INDEX_CASES)

    WRITE_PATHS[name](db, _cases())

    assert len(_rows(db, "cases")) == 2
    assert "idx_cases_status" in _schema_of(db, "cases")


def test_a_declared_table_must_carry_every_column_its_writer_writes(tmp_path):
    # InsertIfAbsent adds an ``id`` column, so migrated DDL must declare it. A
    # missing column fails the write, not a silent schema widening.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES)

    with pytest.raises(MissingColumnError) as raised:
        _write_insert_if_absent(db, _cases())
    assert "no column named id" in str(raised.value)

    declared = tmp_path / "declared.db"
    _migrate(
        declared,
        "CREATE TABLE cases (id INTEGER PRIMARY KEY, case_id TEXT, status TEXT)",
    )
    _write_insert_if_absent(declared, _cases())
    assert len(_rows(declared, "cases")) == 2


def _wide_cases():
    """The same rows, carrying a column no migration ever declared."""
    return _dataset(
        case_id=["c1", "c2"],
        status=["open", "open"],
        outcome=["upheld", "upheld"],
    )


@pytest.mark.parametrize("name", sorted(WRITE_PATHS))
def test_no_writer_reports_a_missing_column_as_a_bare_sqlite_error(tmp_path, name):
    # The column-level counterpart of the missing-table rule, across every
    # table-backed Writer: the failure an operator reads names the table, the
    # database, the columns the table does hold, and the command that would
    # declare the one it does not — never a bare OperationalError, and never
    # pandas' "Execution failed" with the reason buried in __cause__.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES)

    with pytest.raises(MissingColumnError) as raised:
        WRITE_PATHS[name](db, _wide_cases())

    message = str(raised.value)
    assert "cases" in message
    assert str(db) in message
    assert "It holds (case_id, status)" in message
    assert "python -m cli migrate" in message


def test_a_missing_column_keeps_sqlite_s_own_words_and_the_raw_failure(tmp_path):
    # Translating the failure must not lose it: the message quotes SQLite
    # verbatim (so existing text stays greppable) and the original exception is
    # still reachable for anyone reading a traceback deliberately.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES)

    with pytest.raises(MissingColumnError) as raised:
        SqliteTruncateReloadWriter(db, "cases").write(_wide_cases())

    assert "no column named outcome" in str(raised.value)
    assert isinstance(raised.value.__cause__, (sqlite3.Error, pd.errors.DatabaseError))


def test_a_missing_column_is_reported_without_a_migration_it_does_not_have(tmp_path):
    # A database that declares no migrations gets the same translated failure —
    # the write still fails on a column its table lacks — but not advice to add
    # a migration to a tree it has no directory in.
    db = tmp_path / "silver.db"
    _write_upsert(db, _cases())

    with pytest.raises(MissingColumnError) as raised:
        _write_upsert(db, _wide_cases())

    message = str(raised.value)
    assert "declares no migrations" in message
    assert "python -m cli migrate" not in message


def test_a_failed_write_leaves_the_target_as_it_found_it(tmp_path):
    # Translating the failure happens on the way out of the connection block, so
    # the transaction is still discarded unread: the refresh that could not land
    # its wider frame has not emptied the table either.
    db = tmp_path / "silver.db"
    _migrate(db, CREATE_CASES)
    SqliteTruncateReloadWriter(db, "cases").write(_cases())

    with pytest.raises(MissingColumnError):
        SqliteTruncateReloadWriter(db, "cases").write(_wide_cases())

    assert _rows(db, "cases") == [("c1", "open"), ("c2", "open")]


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


def test_a_writer_asks_the_ledger_afresh_rather_than_remembering_an_old_answer(
    tmp_path,
):
    # Check the ledger on every write so changed migration state is observed.
    db = tmp_path / "gold.db"
    writer = SqliteTruncateReloadWriter(db, "cases")
    writer.write(_cases())
    assert len(_rows(db, "cases")) == 2

    con = sqlite3.connect(db)
    try:
        con.execute("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)")
        con.execute("DROP TABLE cases")
        con.commit()
    finally:
        con.close()

    with pytest.raises(MissingTableError, match="'cases'"):
        writer.write(_cases())

```
