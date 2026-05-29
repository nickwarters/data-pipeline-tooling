from pathlib import Path

from framework.readers import CsvReader
from framework.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


def test_write_then_read_round_trips_a_handle_through_the_raw_layer(tmp_path):
    handle = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.write("raw", "cases", handle)
    result = store.read("raw", "cases")

    assert result.columns == handle.columns
    assert len(result) == len(handle)


def test_raw_write_is_truncate_and_reload_not_accumulate(tmp_path):
    handle = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.write("raw", "cases", handle)
    store.write("raw", "cases", handle)

    # Raw is full-refreshed from the source snapshot each run (ADR-0006);
    # a second load replaces the first rather than accumulating.
    result = store.read("raw", "cases")
    assert len(result) == len(handle)


def test_connection_factory_sets_busy_timeout(tmp_path):
    # Readers ride out the single writer's in-place commits via busy_timeout
    # rather than erroring (ADR-0001). The factory configures it on every
    # connection, so we assert the invariant on a factory-made connection.
    store = Store(tmp_path, busy_timeout_ms=7000)

    con = store._connect("raw")
    try:
        (value,) = con.execute("PRAGMA busy_timeout").fetchone()
    finally:
        con.close()

    assert value == 7000
