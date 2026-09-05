```python
"""The two halves of migration control, joined: the runner writes, Writers read.

``tools.migrations`` creates the ``schema_migrations`` ledger; ``framework.io``'s
Writers look for it to decide whether they may create a missing table. They sit
on opposite sides of the framework/tools line and each has its own unit tests
against its own idea of that ledger. This is where the two meet: a database
migrated by the real runner, written to by a real Store-minted Writer, so the
two ideas cannot drift apart unnoticed.
"""

import sqlite3

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io import MissingTableError, Refresh, UpsertStrategy
from tools.medallion import medallion
from tools.migrations import MigrationRunner, is_under_migration_control
from tools.store import StoreRegistry

BASELINE = """
    CREATE TABLE cases (
        case_id TEXT PRIMARY KEY,
        status  TEXT NOT NULL
    );
    CREATE INDEX idx_cases_status ON cases (status);
"""


def _apply(base_dir, migrations, subject, database, sql):
    """Apply one baseline migration to ``<base_dir>/<subject>/<database>.db``."""
    directory = migrations / subject / database
    directory.mkdir(parents=True)
    (directory / "0001_create_initial_tables.sql").write_text(sql, encoding="utf-8")
    db_path = StoreRegistry(base_dir).db_file(f"{subject}/{database}")
    MigrationRunner(db_path, directory).apply()
    return db_path


def _cases(status):
    return Dataset.from_pandas(
        pd.DataFrame({"case_id": ["c1", "c2"], "status": [status, status]})
    )


def _index_names(db_path):
    con = sqlite3.connect(db_path)
    try:
        return {
            row[0]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='index'")
        }
    finally:
        con.close()


def test_a_migrated_layer_keeps_its_declared_shape_across_refreshes(tmp_path):
    # Refresh through the application Store must preserve migration-owned indexes.
    base_dir = tmp_path / "data"
    db_path = _apply(base_dir, tmp_path / "migrations", "cases", "silver", BASELINE)
    assert is_under_migration_control(db_path)

    silver = medallion(StoreRegistry(base_dir), "cases").silver
    silver.writer("cases", Refresh()).write(_cases("open"))
    silver.writer("cases", Refresh()).write(_cases("closed"))

    assert "idx_cases_status" in _index_names(db_path)
    landed = silver.reader("cases").read().to_pandas()
    assert list(landed["status"]) == ["closed", "closed"]


def test_a_migrated_layer_refuses_a_table_no_migration_declares(tmp_path):
    # The migration declared `cases` and nothing else, so a feed writing
    # `case_detail` into the same database is told which command would fix it.
    base_dir = tmp_path / "data"
    _apply(base_dir, tmp_path / "migrations", "cases", "silver", BASELINE)
    silver = medallion(StoreRegistry(base_dir), "cases").silver

    with pytest.raises(MissingTableError) as raised:
        silver.writer("case_detail", UpsertStrategy(("case_id",))).write(_cases("open"))

    assert "case_detail" in str(raised.value)
    assert "python -m cli migrate" in str(raised.value)


def test_a_subject_with_no_migrations_is_untouched_by_any_of_this(tmp_path):
    # The additive property, at the level an application sees it: one subject
    # migrated, its neighbour not. The neighbour still creates its tables on
    # first write, so converting a subject is a decision about that subject.
    base_dir = tmp_path / "data"
    _apply(base_dir, tmp_path / "migrations", "cases", "silver", BASELINE)

    other = medallion(StoreRegistry(base_dir), "reviewer_activity").silver
    other.writer("activity", Refresh()).write(_cases("open"))

    landed = other.reader("activity").read().to_pandas()
    assert len(landed) == 2
    assert not is_under_migration_control(
        StoreRegistry(base_dir).db_file("reviewer_activity/silver")
    )

```
