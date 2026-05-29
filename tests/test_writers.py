from pathlib import Path

from framework.readers import CsvReader
from framework.store import Store, connect
from framework.writers import AccumulateByRunWriter, SqliteTruncateReloadWriter

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


def test_truncate_reload_writer_round_trips_a_handle(tmp_path):
    # The Writer owns its target location (a layer db file + table); writing a
    # handle and reading it back returns the same shape.
    handle = CsvReader(FIXTURE).read()
    writer = SqliteTruncateReloadWriter(tmp_path / "raw.db", "cases")

    writer.write(handle)

    landed = Store(tmp_path).read("raw", "cases")
    assert landed.columns == handle.columns
    assert len(landed) == len(handle)


def test_truncate_reload_writer_replaces_rather_than_accumulates(tmp_path):
    # A current-state snapshot is full-refreshed each run (ADR-0006): a second
    # write replaces the first rather than appending.
    handle = CsvReader(FIXTURE).read()
    writer = SqliteTruncateReloadWriter(tmp_path / "raw.db", "cases")

    writer.write(handle)
    writer.write(handle)

    landed = Store(tmp_path).read("raw", "cases")
    assert len(landed) == len(handle)


def test_connection_factory_sets_busy_timeout(tmp_path):
    # The single connection factory (ADR-0001) sets a busy_timeout so read-only
    # clients ride out the writer's in-place commits instead of erroring. Both
    # Store and Writers open connections through here.
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

    landed = Store(tmp_path).read("gold", "selection_pool")
    assert len(landed) == 2 * len(handle)
    assert "run_id" in landed.columns
    assert "load_date" in landed.columns


def test_accumulate_by_run_writer_is_idempotent_per_run(tmp_path):
    # Re-driving the same run replaces only that run's rows (delete-by-run then
    # insert — ADR-0006), so a re-run does not duplicate.
    handle = CsvReader(FIXTURE).read()
    writer = AccumulateByRunWriter(
        tmp_path / "gold.db", "selection_pool", "r1", "2026-05-29"
    )

    writer.write(handle)
    writer.write(handle)

    landed = Store(tmp_path).read("gold", "selection_pool")
    assert len(landed) == len(handle)
