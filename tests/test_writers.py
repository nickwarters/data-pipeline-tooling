from pathlib import Path

import pandas as pd
import pytest

from framework.connection import connect
from framework.data_handle import DataHandle
from framework.readers import CsvReader, SqliteReader
from framework.writers import AccumulateByRunWriter, SqliteTruncateReloadWriter

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


def test_truncate_reload_writer_round_trips_a_handle(tmp_path):
    # The Writer owns its target location (a layer db file + table); writing a
    # handle and reading it back through the read-side dual returns the same
    # shape.
    handle = CsvReader(FIXTURE).read()
    db = tmp_path / "raw.db"
    SqliteTruncateReloadWriter(db, "cases").write(handle)

    landed = SqliteReader(db, "cases").read()
    assert landed.columns == handle.columns
    assert len(landed) == len(handle)


def test_truncate_reload_writer_replaces_rather_than_accumulates(tmp_path):
    # A current-state snapshot is full-refreshed each run (ADR-0006): a second
    # write replaces the first rather than appending.
    handle = CsvReader(FIXTURE).read()
    db = tmp_path / "raw.db"
    writer = SqliteTruncateReloadWriter(db, "cases")

    writer.write(handle)
    writer.write(handle)

    assert len(SqliteReader(db, "cases").read()) == len(handle)


def test_connection_factory_sets_busy_timeout(tmp_path):
    # The single connection factory (ADR-0001) sets a busy_timeout so read-only
    # clients ride out the writer's in-place commits instead of erroring. Both
    # the Store and Writers open connections through here.
    con = connect(tmp_path / "raw.db", busy_timeout_ms=7000)
    try:
        (value,) = con.execute("PRAGMA busy_timeout").fetchone()
    finally:
        con.close()

    assert value == 7000


def test_accumulate_by_run_writer_keeps_each_run(tmp_path):
    # Gold accumulates: each run's rows are retained and stamped run_id /
    # load_date (ADR-0006). Two distinct runs land both sets.
    handle = CsvReader(FIXTURE).read()
    db = tmp_path / "gold.db"

    AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29").write(handle)
    AccumulateByRunWriter(db, "selection_pool", "r2", "2026-05-30").write(handle)

    landed = SqliteReader(db, "selection_pool").read()
    assert len(landed) == 2 * len(handle)
    assert "run_id" in landed.columns
    assert "load_date" in landed.columns


def test_accumulate_by_run_writer_is_idempotent_per_run(tmp_path):
    # Re-driving the same run replaces only that run's rows (delete-by-run then
    # insert — ADR-0006), so a re-run does not duplicate.
    handle = CsvReader(FIXTURE).read()
    db = tmp_path / "gold.db"
    writer = AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29")

    writer.write(handle)
    writer.write(handle)

    assert len(SqliteReader(db, "selection_pool").read()) == len(handle)


def test_accumulate_by_run_writer_is_atomic_when_the_write_fails(tmp_path):
    # The layer write is a single SQLite transaction (ADR-0007): gold's
    # delete-by-run then insert is all-or-nothing. If the insert fails, the
    # delete must roll back so a re-driven run never half-wipes prior rows.
    db = tmp_path / "gold.db"
    good = DataHandle.from_pandas(pd.DataFrame({"id": [1, 2]}))
    AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29").write(good)

    # A frame with a surprise column the table lacks fails on append, after the
    # delete-by-run has already run within the same transaction.
    broken = DataHandle.from_pandas(pd.DataFrame({"id": [1], "surprise": [9]}))
    with pytest.raises(Exception):
        AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29").write(broken)

    survivors = SqliteReader(db, "selection_pool").read()
    assert len(survivors) == 2
    assert "surprise" not in survivors.columns
