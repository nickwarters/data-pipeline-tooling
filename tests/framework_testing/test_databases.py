"""The database helper: a base directory built from declared migrations.

These drive the helper against a throwaway migrations tree rather than the
configured default, so they say what the helper does regardless of which subjects
have baselines yet. That the helper reads the *real* tree by default
is itself asserted, because a test-only DDL path would defeat the point.
"""

import re
import sqlite3

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io import MissingTableError, Refresh
from tests.framework_testing import build_databases, database_registry
from tools.migrations import MIGRATIONS_ROOT, is_under_migration_control

CASES = (
    "CREATE TABLE cases (case_id TEXT, status TEXT);\n"
    "CREATE INDEX ix ON cases (status);\n"
)


def _tree(tmp_path, subject, **databases):
    """A throwaway migrations tree: ``{database: sql}`` for one subject."""
    root = tmp_path / "migrations"
    for database, sql in databases.items():
        directory = root / subject / database
        directory.mkdir(parents=True)
        (directory / "0001_create_initial_tables.sql").write_text(sql, encoding="utf-8")
    return root


def _dataset():
    return Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"], "status": ["open"]}))


def test_naming_a_subject_builds_every_database_it_declares(tmp_path):
    root = _tree(tmp_path, "cases", raw=CASES, silver=CASES, gold=CASES)
    base_dir = tmp_path / "data"

    build_databases(base_dir, "cases", migrations_root=root)

    for database in ("raw", "silver", "gold"):
        assert is_under_migration_control(base_dir / "cases" / f"{database}.db")


def test_naming_one_database_builds_only_that_one(tmp_path):
    # A test that writes silver should not pay for raw and gold. The whole
    # subject is the convenient default, not the only one available.
    root = _tree(tmp_path, "cases", raw=CASES, silver=CASES, gold=CASES)
    base_dir = tmp_path / "data"

    build_databases(base_dir, "cases/silver", migrations_root=root)

    assert is_under_migration_control(base_dir / "cases" / "silver.db")
    assert not (base_dir / "cases" / "raw.db").exists()
    assert not (base_dir / "cases" / "gold.db").exists()


def test_the_databases_are_whatever_the_tree_names_them(tmp_path):
    # Nothing here knows about raw/silver/gold: that is one application's profile
    # over the store, and a subject whose databases are named something else
    # builds exactly the same way.
    root = _tree(tmp_path, "ledger", current=CASES, archive=CASES)

    base_dir = build_databases(tmp_path / "data", "ledger", migrations_root=root)

    assert is_under_migration_control(base_dir / "ledger" / "current.db")
    assert is_under_migration_control(base_dir / "ledger" / "archive.db")


def test_a_built_database_takes_the_migrated_write_path(tmp_path):
    # The point of the helper: the subject's tests exercise the branch production
    # takes, so the declared index survives a Refresh...
    root = _tree(tmp_path, "cases", silver=CASES)
    registry = database_registry(
        tmp_path / "data", "cases/silver", migrations_root=root
    )

    registry.store("cases/silver").writer("cases", Refresh()).write(_dataset())

    con = sqlite3.connect(tmp_path / "data" / "cases" / "silver.db")
    indexes = {
        row[0]
        for row in con.execute("SELECT name FROM sqlite_master WHERE type='index'")
    }
    con.close()
    assert "ix" in indexes


def test_a_table_no_migration_declares_fails_the_test_as_it_fails_a_run(tmp_path):
    # ...and a table the baseline forgot fails here rather than being conjured,
    # which is the coverage converting a subject's tests actually buys.
    root = _tree(tmp_path, "cases", silver=CASES)
    store = database_registry(
        tmp_path / "data", "cases/silver", migrations_root=root
    ).store("cases/silver")

    with pytest.raises(MissingTableError, match="case_detail"):
        store.writer("case_detail", Refresh()).write(_dataset())


def test_specs_of_both_kinds_mix_in_one_call(tmp_path):
    # A pipeline commonly reads one subject and writes another; both ends have to
    # exist before it runs, and each end names only what it needs.
    root = _tree(tmp_path, "cases", raw=CASES, silver=CASES)
    for database in ("silver", "gold"):
        directory = root / "activity" / database
        directory.mkdir(parents=True)
        (directory / "0001_create_initial_tables.sql").write_text(CASES, "utf-8")

    base_dir = build_databases(
        tmp_path / "data", "cases/silver", "activity", migrations_root=root
    )

    assert is_under_migration_control(base_dir / "cases" / "silver.db")
    assert is_under_migration_control(base_dir / "activity" / "gold.db")
    assert not (base_dir / "cases" / "raw.db").exists()


def test_something_the_tree_does_not_declare_is_an_error_naming_it(tmp_path):
    # Silently returning an unbuilt base directory would let the first write
    # create tables implicitly, so the migration contract would go untested.
    root = _tree(tmp_path, "cases", silver=CASES)

    with pytest.raises(LookupError, match="nothing to build for 'absent'"):
        build_databases(tmp_path / "data", "absent", migrations_root=root)

    # A real subject, a database it does not have — the typo that a
    # subject-only helper could not have caught at all.
    with pytest.raises(LookupError, match=re.escape("['cases/silver']")):
        build_databases(tmp_path / "data", "cases/slver", migrations_root=root)


def test_the_helper_reads_the_real_migrations_tree_by_default(tmp_path):
    # A test-only DDL path would defeat the point: what is worth testing is that
    # the stored SQL and the code agree. Asked for a subject with no baselines
    # and given no tree, the helper identifies the default tree it searched.
    with pytest.raises(LookupError, match=re.escape(str(MIGRATIONS_ROOT))):
        build_databases(tmp_path / "data", "definitely_not_a_subject")


def test_the_fixture_form_builds_into_pytests_tmp_path(
    databases, tmp_path, monkeypatch
):
    # The fixture is the common case: the test names what it writes, pytest owns
    # the directory.
    root = _tree(tmp_path, "cases", silver=CASES)
    monkeypatch.setattr(
        "tests.framework_testing.databases.MIGRATIONS_ROOT", root, raising=False
    )

    base_dir = databases("cases/silver")

    assert base_dir == tmp_path
    assert is_under_migration_control(tmp_path / "cases" / "silver.db")
