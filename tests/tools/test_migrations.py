import sqlite3

import pytest

from tools.migrations import (
    LEDGER_TABLE,
    MIGRATIONS_ROOT,
    MigrationError,
    MigrationRunner,
    discover_targets,
    is_under_migration_control,
    migrations_directory,
)

CREATE_CASES = """
    CREATE TABLE cases (
        case_id TEXT PRIMARY KEY,
        opened  TEXT NOT NULL
    );
"""

ADD_INDEX = """
    CREATE INDEX idx_cases_opened ON cases (opened);
"""


def _write(directory, name, sql):
    """Drop one migration file into ``directory``, creating it if needed."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(sql, encoding="utf-8")
    return path


def _runner(tmp_path, **kwargs):
    """A runner over ``<tmp>/silver.db`` and ``<tmp>/migrations``."""
    return MigrationRunner(tmp_path / "silver.db", tmp_path / "migrations", **kwargs)


def _tables(db_path):
    con = sqlite3.connect(db_path)
    try:
        return {
            row[0]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        con.close()


def _ledger(db_path):
    con = sqlite3.connect(db_path)
    try:
        return con.execute(
            f"SELECT name, checksum, applied_at FROM {LEDGER_TABLE} ORDER BY name"
        ).fetchall()
    finally:
        con.close()


def test_fresh_database_gets_every_migration_and_a_ledger_row_each(tmp_path):
    # The baseline case: nothing applied, so every file runs in version order
    # and the database ends up carrying the ledger that marks it as migrated.
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _write(migrations, "0002_index_opened.sql", ADD_INDEX)

    applied = _runner(tmp_path).apply()

    assert [m.name for m in applied] == [
        "0001_create_cases.sql",
        "0002_index_opened.sql",
    ]
    assert "cases" in _tables(tmp_path / "silver.db")
    assert [row[0] for row in _ledger(tmp_path / "silver.db")] == [
        "0001_create_cases.sql",
        "0002_index_opened.sql",
    ]


def test_apply_creates_the_database_and_its_parent_directory(tmp_path):
    # The subject's directory need not exist yet — the first migration of a new
    # database is what brings the file into being.
    db_path = tmp_path / "cases" / "silver.db"
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)

    MigrationRunner(db_path, migrations).apply()

    assert db_path.exists()
    assert is_under_migration_control(db_path)


def test_partially_applied_database_runs_only_what_is_outstanding(tmp_path):
    # The second run must not re-run 0001 (it would fail on the existing table);
    # it applies exactly the file that appeared since.
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _runner(tmp_path).apply()

    _write(migrations, "0002_index_opened.sql", ADD_INDEX)
    applied = _runner(tmp_path).apply()

    assert [m.name for m in applied] == ["0002_index_opened.sql"]
    assert len(_ledger(tmp_path / "silver.db")) == 2


def test_applying_a_current_database_is_a_no_op(tmp_path):
    # Nothing pending means nothing applied and nothing written — the common
    # path must not take the exclusive write lock a share makes expensive.
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    runner = _runner(tmp_path)
    runner.apply()
    before = _ledger(tmp_path / "silver.db")

    assert runner.apply() == []
    assert runner.pending() == []
    assert _ledger(tmp_path / "silver.db") == before


def test_pending_lists_what_apply_would_do_without_writing(tmp_path):
    # The CLI reports from this, so asking must not create the database file.
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _write(migrations, "0002_index_opened.sql", ADD_INDEX)
    runner = _runner(tmp_path)

    pending = runner.pending()

    assert [m.name for m in pending] == [
        "0001_create_cases.sql",
        "0002_index_opened.sql",
    ]
    assert not (tmp_path / "silver.db").exists()


def test_pending_reports_only_the_outstanding_tail(tmp_path):
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _runner(tmp_path).apply()
    _write(migrations, "0002_index_opened.sql", ADD_INDEX)

    assert [m.name for m in _runner(tmp_path).pending()] == ["0002_index_opened.sql"]


def test_editing_an_applied_migration_is_an_error_naming_the_file(tmp_path):
    # The checksum's whole job: the database and the file claiming to describe
    # it have diverged, and silently skipping the file would hide that forever.
    migrations = tmp_path / "migrations"
    path = _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _runner(tmp_path).apply()

    path.write_text(CREATE_CASES + "\nCREATE TABLE extra (x INTEGER);\n", "utf-8")

    with pytest.raises(MigrationError, match="edited after it was applied"):
        _runner(tmp_path).pending()
    with pytest.raises(MigrationError, match=r"0001_create_cases\.sql"):
        _runner(tmp_path).apply()


def test_an_edited_migration_is_caught_even_with_newer_work_behind_it(tmp_path):
    # Reporting "0002 is pending" and applying it would build on a database
    # whose earlier shape is no longer what 0001 says it is.
    migrations = tmp_path / "migrations"
    path = _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _runner(tmp_path).apply()
    path.write_text(CREATE_CASES + "\nCREATE TABLE extra (x INTEGER);\n", "utf-8")
    _write(migrations, "0002_index_opened.sql", ADD_INDEX)

    with pytest.raises(MigrationError, match="edited after it was applied"):
        _runner(tmp_path).apply()

    assert "extra" not in _tables(tmp_path / "silver.db")
    assert len(_ledger(tmp_path / "silver.db")) == 1


def test_line_ending_differences_alone_do_not_read_as_an_edit(tmp_path):
    # Windows is the deployment target and macOS is the development box: the
    # same file checked out with CRLF must not look like a rewritten migration.
    migrations = tmp_path / "migrations"
    path = _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _runner(tmp_path).apply()

    path.write_bytes(CREATE_CASES.replace("\n", "\r\n").encode("utf-8"))

    assert _runner(tmp_path).pending() == []


@pytest.mark.parametrize(
    "name",
    ["create_cases.sql", "1_create_cases.sql", "0001-create-cases.sql", "0001_.sql"],
)
def test_a_filename_that_does_not_parse_is_an_error_naming_the_file(tmp_path, name):
    # Ordering is the contract; a file with no unambiguous place in it must
    # stop the whole set rather than be applied at a guessed position.
    _write(tmp_path / "migrations", name, CREATE_CASES)

    with pytest.raises(MigrationError, match=name.replace(".", r"\.")):
        _runner(tmp_path).pending()


def test_two_files_claiming_one_version_is_an_error_naming_both(tmp_path):
    # The classic merge accident: two branches each added an 0002.
    migrations = tmp_path / "migrations"
    _write(migrations, "0002_index_opened.sql", ADD_INDEX)
    _write(migrations, "0002_other_change.sql", "CREATE TABLE other (x INTEGER);")

    with pytest.raises(MigrationError, match="Duplicate migration version 0002"):
        _runner(tmp_path).pending()


def test_non_sql_entries_are_ignored_rather_than_rejected(tmp_path):
    # A macOS checkout grows a .DS_Store unasked; a README beside the DDL is
    # legitimate. Neither is a migration, so neither is an error.
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    (migrations / ".DS_Store").write_bytes(b"\x00")
    (migrations / "README.md").write_text("Notes on this database.\n", encoding="utf-8")
    (migrations / "scratch").mkdir()

    assert [m.name for m in _runner(tmp_path).discover()] == ["0001_create_cases.sql"]


def test_discover_orders_by_version_not_by_description(tmp_path):
    migrations = tmp_path / "migrations"
    _write(migrations, "0010_add_column.sql", "ALTER TABLE cases ADD COLUMN a TEXT;")
    _write(migrations, "0002_index_opened.sql", ADD_INDEX)
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)

    assert [m.version for m in _runner(tmp_path).discover()] == [1, 2, 10]


def test_a_missing_migrations_directory_is_an_error(tmp_path):
    # A typo'd path must not read as "this subject has no migrations".
    with pytest.raises(MigrationError, match="No migrations directory"):
        _runner(tmp_path).pending()


def test_a_failing_migration_leaves_no_ledger_row_and_no_partial_ddl(tmp_path):
    # The transaction boundary, tested: the second statement of 0002 is bad, so
    # neither its first statement nor its ledger row survives, and 0001 stays.
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _write(
        migrations,
        "0002_broken.sql",
        "CREATE TABLE half_done (x INTEGER);\nCRATE TABLE oops (y INTEGER);\n",
    )

    with pytest.raises(MigrationError, match=r"0002_broken\.sql"):
        _runner(tmp_path).apply()

    tables = _tables(tmp_path / "silver.db")
    assert "cases" in tables
    assert "half_done" not in tables
    assert [row[0] for row in _ledger(tmp_path / "silver.db")] == [
        "0001_create_cases.sql"
    ]


def test_a_failed_migration_is_simply_retried_once_it_is_fixed(tmp_path):
    # The point of leaving no row: fixing the file and re-running is the whole
    # recovery procedure — no manual ledger surgery.
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    _write(migrations, "0002_broken.sql", "CRATE TABLE oops (y INTEGER);\n")
    with pytest.raises(MigrationError):
        _runner(tmp_path).apply()

    _write(migrations, "0002_broken.sql", "CREATE TABLE fixed (y INTEGER);\n")
    applied = _runner(tmp_path).apply()

    assert [m.name for m in applied] == ["0002_broken.sql"]
    assert "fixed" in _tables(tmp_path / "silver.db")


def test_the_very_first_migration_failing_leaves_the_database_unmigrated(tmp_path):
    # A bare ledger created ahead of the first migration would flip the database
    # into strict mode with no tables in it — so it is created inside the same
    # transaction as the migration that earns it.
    _write(tmp_path / "migrations", "0001_broken.sql", "CRATE TABLE oops (y INT);\n")

    with pytest.raises(MigrationError):
        _runner(tmp_path).apply()

    assert not is_under_migration_control(tmp_path / "silver.db")


def test_applied_reports_the_ledger_contents(tmp_path):
    migrations = tmp_path / "migrations"
    _write(migrations, "0001_create_cases.sql", CREATE_CASES)
    runner = _runner(tmp_path)
    runner.apply()

    rows = runner.applied()

    assert [row.name for row in rows] == ["0001_create_cases.sql"]
    assert rows[0].checksum == runner.discover()[0].checksum
    assert rows[0].applied_at.endswith("+00:00")


def test_a_database_with_no_ledger_has_applied_nothing(tmp_path):
    # The additive-conversion property: an untouched database is not an error
    # and is not under migration control.
    db_path = tmp_path / "silver.db"
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE cases (case_id TEXT)")
    con.commit()
    con.close()
    _write(tmp_path / "migrations", "0001_create_cases.sql", CREATE_CASES)

    assert _runner(tmp_path).applied() == []
    assert not is_under_migration_control(db_path)


def test_is_under_migration_control_does_not_create_the_database(tmp_path):
    # Asking a question about a database must not bring one into existence —
    # the writers ask this on every run.
    db_path = tmp_path / "absent.db"

    assert not is_under_migration_control(db_path)
    assert not db_path.exists()


def test_migrations_directory_mirrors_the_on_disk_database_layout(tmp_path):
    assert migrations_directory("cases", "silver", root=tmp_path) == (
        tmp_path / "cases" / "silver"
    )
    assert migrations_directory("cases", "silver").is_relative_to(MIGRATIONS_ROOT)
    assert MIGRATIONS_ROOT.name == "migrations"


def test_discover_targets_walks_the_tree_in_subject_then_database_order(tmp_path):
    # The tree is the registry of which databases are under migration control.
    for subject, database in [
        ("cases", "gold"),
        ("cases", "raw"),
        ("cases", "silver"),
        ("activity", "gold"),
    ]:
        (tmp_path / subject / database).mkdir(parents=True)

    targets = discover_targets(tmp_path)

    assert [(t.subject, t.database) for t in targets] == [
        ("activity", "gold"),
        ("cases", "gold"),
        ("cases", "raw"),
        ("cases", "silver"),
    ]
    assert targets[2].namespace == "cases/raw"
    assert targets[2].directory == tmp_path / "cases" / "raw"


def test_discover_targets_does_not_judge_what_a_database_is_called(tmp_path):
    # A subject's databases are just names here. raw/silver/gold is the
    # tools.medallion profile's reading of them, not this module's.
    (tmp_path / "reference" / "lookups").mkdir(parents=True)

    assert [t.namespace for t in discover_targets(tmp_path)] == ["reference/lookups"]


def test_discover_targets_on_a_tree_that_does_not_exist_yet_is_empty(tmp_path):
    # Today's state: nothing has opted in. Not an error.
    assert discover_targets(tmp_path / "absent") == []


def test_discover_targets_ignores_files_beside_the_subjects(tmp_path):
    (tmp_path / "cases" / "raw").mkdir(parents=True)
    (tmp_path / "README.md").write_text("How to add a migration.\n", encoding="utf-8")
    (tmp_path / "cases" / "notes.txt").write_text("scratch\n", encoding="utf-8")

    assert [t.namespace for t in discover_targets(tmp_path)] == ["cases/raw"]
