"""The migrated-store helper: a base directory under migration control.

These drive the helper against a throwaway migrations tree rather than the
repository's own, so they say what the helper does regardless of which subjects
have baselines checked in yet. That the helper reads the *real* tree by default
is itself asserted, because a test-only DDL path would defeat the point.
"""

import re
import sqlite3

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io import MissingTableError, Refresh
from tests.framework_testing import (
    migrate_subject,
    migrated_base_dir,
    migrated_medallion,
    migrated_registry,
)
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


def test_every_database_the_subject_declares_is_migrated(tmp_path):
    # Not just silver: a test that migrated some of a subject's databases would
    # fail at the first write into one it missed.
    root = _tree(tmp_path, "cases", raw=CASES, silver=CASES, gold=CASES)
    base_dir = tmp_path / "data"

    migrate_subject(base_dir, "cases", migrations_root=root)

    for database in ("raw", "silver", "gold"):
        assert is_under_migration_control(base_dir / "cases" / f"{database}.db")


def test_a_migrated_base_dir_takes_the_migrated_write_path(tmp_path):
    # The point of the fixture: the subject's tests exercise the branch
    # production takes, so the declared index survives a Refresh...
    root = _tree(tmp_path, "cases", silver=CASES)
    base_dir = migrated_base_dir(tmp_path / "data", "cases", migrations_root=root)
    store = migrated_registry(tmp_path / "data", "cases", migrations_root=root).store(
        "cases/silver"
    )

    store.writer("cases", Refresh()).write(_dataset())

    con = sqlite3.connect(base_dir / "cases" / "silver.db")
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
    store = migrated_registry(tmp_path / "data", "cases", migrations_root=root).store(
        "cases/silver"
    )

    with pytest.raises(MissingTableError, match="case_detail"):
        store.writer("case_detail", Refresh()).write(_dataset())


def test_several_subjects_can_be_migrated_into_one_base_dir(tmp_path):
    # A pipeline commonly reads one subject and writes another; both ends have
    # to exist before it runs.
    root = _tree(tmp_path, "cases", silver=CASES)
    for database in ("silver", "gold"):
        directory = root / "activity" / database
        directory.mkdir(parents=True)
        (directory / "0001_create_initial_tables.sql").write_text(CASES, "utf-8")

    base_dir = migrated_base_dir(
        tmp_path / "data", "cases", "activity", migrations_root=root
    )

    assert is_under_migration_control(base_dir / "cases" / "silver.db")
    assert is_under_migration_control(base_dir / "activity" / "gold.db")


def test_a_medallion_over_a_migrated_base_dir(tmp_path):
    root = _tree(tmp_path, "cases", raw=CASES, silver=CASES, gold=CASES)

    med = migrated_medallion(tmp_path / "data", "cases", migrations_root=root)
    med.gold.writer("cases", Refresh()).write(_dataset())

    assert len(med.gold.reader("cases").read()) == 1


def test_a_subject_with_no_baselines_is_an_error_naming_it(tmp_path):
    # Silently returning an unmigrated base directory would leave the test
    # passing against the old implicit-creation branch and proving nothing.
    with pytest.raises(LookupError, match="no migrations for subject 'absent'"):
        migrate_subject(tmp_path / "data", "absent", migrations_root=tmp_path / "m")


def test_the_helper_reads_the_real_migrations_tree_by_default(tmp_path):
    # A test-only DDL path would defeat the point: what is worth testing is that
    # the checked-in SQL and the code agree. Asked for a subject with no
    # baselines and given no tree, the helper says which tree it looked in — the
    # repository's own.
    with pytest.raises(LookupError, match=re.escape(str(MIGRATIONS_ROOT))):
        migrate_subject(tmp_path / "data", "definitely_not_a_subject")


def test_the_fixture_form_migrates_into_pytests_tmp_path(
    migrated, tmp_path, monkeypatch
):
    # The fixture is the common case: the test names its subject, pytest owns
    # the directory.
    root = _tree(tmp_path, "cases", silver=CASES)
    monkeypatch.setattr(
        "tests.framework_testing.migrated.MIGRATIONS_ROOT", root, raising=False
    )

    base_dir = migrated("cases")

    assert base_dir == tmp_path
    assert is_under_migration_control(tmp_path / "cases" / "silver.db")
