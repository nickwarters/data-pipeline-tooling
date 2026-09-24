"""Test the source checkpoint: the store, and the window rule over its watermark."""

import datetime as dt
import sqlite3
import time

import pytest

from tools.source_checkpoint import InstantWindow, SourceCheckpointStore, instant_window

UTC = dt.timezone.utc
SOURCE_NOW = dt.datetime(2026, 8, 5, 9, 0, tzinfo=UTC)
OVERLAP = dt.timedelta(minutes=5)
SAFETY_LAG = dt.timedelta(minutes=2)
NAIVE = dt.datetime(2026, 8, 5, 9, 0)


def window(
    committed=None, *, source_now=SOURCE_NOW, overlap=OVERLAP, safety_lag=SAFETY_LAG
):
    return instant_window(
        committed, source_now=source_now, overlap=overlap, safety_lag=safety_lag
    )


# --- the window rule ----------------------------------------------------------


def test_the_first_window_has_no_lower_bound():
    # Nothing has been committed, so there is no floor to resume from: the first
    # run fetches everything the source holds, up to the safe upper boundary.
    first = window(None)

    assert first == InstantWindow(start=None, end=SOURCE_NOW - SAFETY_LAG)


def test_a_committed_watermark_resumes_one_overlap_early():
    # The overlap is deliberate re-reading: a row stamped either side of the
    # last boundary is re-observed rather than missed.
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=UTC)

    assert window(committed) == InstantWindow(
        start=committed - OVERLAP, end=SOURCE_NOW - SAFETY_LAG
    )


def test_a_window_that_has_not_advanced_yet_is_none_rather_than_an_error():
    # Running again before the safe upper bound has moved past the committed
    # watermark is ordinary operation, not a failure: there is nothing left to
    # poll yet, so None comes back rather than a window of covered ground.
    committed = SOURCE_NOW - SAFETY_LAG

    assert window(committed) is None
    later = SOURCE_NOW + dt.timedelta(seconds=1)
    assert window(committed, source_now=later) is not None


def test_the_rule_reads_the_source_clock_in_utc():
    # The bounds are a predicate the source evaluates, so an offset-aware clock
    # reading is one instant however it was spelled.
    local = dt.timezone(dt.timedelta(hours=1))

    assert window(None, source_now=dt.datetime(2026, 8, 5, 10, 0, tzinfo=local)) == (
        InstantWindow(start=None, end=SOURCE_NOW - SAFETY_LAG)
    )


@pytest.mark.parametrize(
    "kwargs",
    [{"source_now": NAIVE}, {"committed": NAIVE}],
    ids=["source_now", "committed"],
)
def test_a_naive_instant_is_refused(kwargs):
    # A naive datetime has no single UTC meaning; reading it as the local zone
    # would shift the window by whatever offset the running box is in.
    with pytest.raises(ValueError, match="timezone-aware"):
        window(**kwargs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"overlap": dt.timedelta(minutes=-1)},
        {"safety_lag": dt.timedelta(minutes=-1)},
    ],
    ids=["overlap", "safety_lag"],
)
def test_a_negative_overlap_or_safety_lag_is_refused(kwargs):
    # A negative safety lag reads into the future; a negative overlap opens a
    # permanent gap between consecutive windows.
    with pytest.raises(ValueError, match="must not be negative"):
        window(**kwargs)


def test_a_window_refuses_a_naive_bound_or_an_inverted_span():
    with pytest.raises(ValueError, match="timezone-aware"):
        InstantWindow(None, NAIVE)
    with pytest.raises(ValueError, match="must be before"):
        InstantWindow(SOURCE_NOW, SOURCE_NOW)


# --- the store ----------------------------------------------------------------

SOURCE = "claims.dbo.Complaint"
OTHER = "claims.dbo.Adviser"
COMMITTED = dt.datetime(2026, 8, 5, 8, 30, tzinfo=UTC)


def commit(store, source=SOURCE, *, at=COMMITTED, batch="batch-1", run="run-1"):
    store.commit(source, at, batch_id=batch, pipeline_run_id=run)


def stored_rows(store):
    """Every persisted checkpoint row, read back outside the store."""
    con = sqlite3.connect(store.path)
    try:
        cur = con.execute("SELECT * FROM source_checkpoints ORDER BY source_key")
        columns = [d[0] for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]
    finally:
        con.close()


def test_an_unseen_source_has_no_watermark_and_creates_no_file(tmp_path):
    # Reading is a read: a source nobody has committed for must not bring the
    # control-state file (or its DDL) into existence as a side effect.
    store = SourceCheckpointStore(tmp_path)

    assert store.watermark(SOURCE) is None
    assert not store.path.exists()


def test_a_commit_is_read_back_and_survives_reopening_the_store(tmp_path):
    # Durability is the whole point: the next run is a new process.
    commit(SourceCheckpointStore(tmp_path))

    assert SourceCheckpointStore(tmp_path).watermark(SOURCE) == COMMITTED


def test_a_commit_is_stored_as_one_utc_instant_however_it_was_spelled(tmp_path):
    store = SourceCheckpointStore(tmp_path)
    local = dt.timezone(dt.timedelta(hours=1))

    commit(store, at=dt.datetime(2026, 8, 5, 9, 30, tzinfo=local))

    assert stored_rows(store)[0]["watermark_utc"] == "2026-08-05T08:30:00+00:00"
    assert store.watermark(SOURCE) == COMMITTED


def test_two_sources_keep_independent_watermarks(tmp_path):
    # The checkpoint is per *source*: one table's progress must not advance
    # another's and skip its rows.
    store = SourceCheckpointStore(tmp_path)
    commit(store)

    assert store.watermark(SOURCE) == COMMITTED
    assert store.watermark(OTHER) is None


def test_repeating_the_same_watermark_is_accepted_and_leaves_one_row(tmp_path):
    # Not-advancing is not going backwards, so an identical commit takes the
    # upsert path: the provenance refreshes and the source keeps one row.
    store = SourceCheckpointStore(tmp_path)
    commit(store, batch="batch-1", run="run-1")

    commit(store, batch="batch-2", run="run-2")

    rows = stored_rows(store)
    assert len(rows) == 1
    assert rows[0]["watermark_utc"] == COMMITTED.isoformat()
    assert rows[0]["batch_id"] == "batch-2"
    assert rows[0]["pipeline_run_id"] == "run-2"


def test_an_earlier_watermark_is_refused_and_changes_nothing(tmp_path):
    # A watermark that went backwards would re-poll ground already covered and,
    # worse, hide the fact that a run lost its place.
    store = SourceCheckpointStore(tmp_path)
    commit(store, batch="batch-1", run="run-1")

    with pytest.raises(ValueError, match="must not move backwards"):
        commit(store, at=COMMITTED - dt.timedelta(minutes=30), batch="b2", run="r2")

    row = stored_rows(store)[0]
    assert (row["watermark_utc"], row["batch_id"], row["pipeline_run_id"]) == (
        COMMITTED.isoformat(),
        "batch-1",
        "run-1",
    )


def test_a_naive_watermark_creates_no_control_state(tmp_path):
    # The instant is checked before anything is opened, so a caller's bad
    # argument does not leave an empty checkpoint file behind.
    store = SourceCheckpointStore(tmp_path)

    with pytest.raises(ValueError, match="timezone-aware"):
        commit(store, at=NAIVE)

    assert not store.path.exists()


def test_a_file_without_the_table_yet_reads_as_unseen(tmp_path):
    # A concurrent first commit creates the file before its DDL commits, so the
    # file existing is not enough: reading must not blow up on a missing table.
    store = SourceCheckpointStore(tmp_path)
    store.path.parent.mkdir(parents=True)
    sqlite3.connect(store.path).close()

    assert store.watermark(SOURCE) is None


def test_a_concurrent_writer_is_waited_for_not_retried(tmp_path):
    # busy_timeout is the whole contention policy: a commit waits out the other
    # writer for that long and then fails plainly, rather than looping and
    # hiding the contention behind a longer wall-clock time.
    store = SourceCheckpointStore(tmp_path)
    commit(store, at=COMMITTED - dt.timedelta(minutes=30))

    writer = sqlite3.connect(store.path)
    writer.execute("BEGIN IMMEDIATE")
    try:
        blocked = SourceCheckpointStore(tmp_path, busy_timeout_ms=300)
        started = time.monotonic()
        with pytest.raises(sqlite3.OperationalError):
            commit(blocked)
        assert time.monotonic() - started >= 0.3
    finally:
        writer.rollback()
        writer.close()


def test_the_checkpoint_file_sits_beside_the_other_base_directory_metadata(tmp_path):
    # One owner of the location: control state is a sibling of the run metadata,
    # not something inside it.
    store = SourceCheckpointStore(tmp_path)

    assert store.path == tmp_path / "_checkpoints" / "sources.db"
