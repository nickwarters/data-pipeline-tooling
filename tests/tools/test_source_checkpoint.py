"""Test the source checkpoint: positions, the store, and the window rule over them."""

import datetime as dt
import sqlite3
import time

import pytest

from tools.source_checkpoint import (
    Instant,
    InstantWindow,
    Source,
    SourceCheckpointStore,
    instant_window,
)

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


def test_a_committed_position_resumes_one_overlap_early():
    # The overlap is deliberate re-reading: a row stamped either side of the
    # last boundary is re-observed rather than missed.
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=UTC)

    assert window(committed) == InstantWindow(
        start=committed - OVERLAP, end=SOURCE_NOW - SAFETY_LAG
    )


def test_a_window_that_has_not_advanced_yet_is_none_rather_than_an_error():
    # Running again before the safe upper bound has moved past the committed
    # position is ordinary operation, not a failure: there is nothing left to
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


# --- the position -------------------------------------------------------------


def test_an_instant_is_one_utc_moment_however_it_was_spelled():
    local = dt.timezone(dt.timedelta(hours=1))

    spelled_locally = Instant(dt.datetime(2026, 8, 5, 9, 30, tzinfo=local))

    assert spelled_locally == Instant(dt.datetime(2026, 8, 5, 8, 30, tzinfo=UTC))
    assert spelled_locally.encode() == "2026-08-05T08:30:00+00:00"
    assert Instant.decode(spelled_locally.encode()) == spelled_locally


def test_a_naive_instant_position_is_refused():
    with pytest.raises(ValueError, match="timezone-aware"):
        Instant(NAIVE)


def test_an_instant_advances_to_a_later_or_equal_one_and_not_an_earlier():
    now = Instant(SOURCE_NOW)

    assert now.may_advance_to(Instant(SOURCE_NOW + dt.timedelta(minutes=1)))
    assert now.may_advance_to(Instant(SOURCE_NOW))
    assert not now.may_advance_to(Instant(SOURCE_NOW - dt.timedelta(minutes=1)))


def test_a_source_needs_both_a_kind_and_a_key():
    with pytest.raises(ValueError, match="kind"):
        Source("", "claims.dbo.Complaint")
    with pytest.raises(ValueError, match="key"):
        Source("sql-table", "")


# --- the store ----------------------------------------------------------------

SOURCE = Source("sql-table", "claims.dbo.Complaint")
OTHER = Source("sql-table", "claims.dbo.Adviser")
COMMITTED = dt.datetime(2026, 8, 5, 8, 30, tzinfo=UTC)


def commit(store, source=SOURCE, *, at=COMMITTED, batch="batch-1", run="run-1"):
    store.commit(source, Instant(at), batch_id=batch, pipeline_run_id=run)


def stored_rows(store):
    """Every persisted checkpoint row, read back outside the store."""
    con = sqlite3.connect(store.path)
    try:
        cur = con.execute("SELECT * FROM source_checkpoints ORDER BY kind, key")
        columns = [d[0] for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]
    finally:
        con.close()


def test_an_unseen_source_has_no_position_and_creates_no_file(tmp_path):
    # Reading is a read: a source nobody has committed for must not bring the
    # control-state file (or its DDL) into existence as a side effect.
    store = SourceCheckpointStore(tmp_path)

    assert store.position(SOURCE) is None
    assert not store.path.exists()


def test_a_commit_is_read_back_and_survives_reopening_the_store(tmp_path):
    # Durability is the whole point: the next run is a new process.
    commit(SourceCheckpointStore(tmp_path))

    assert SourceCheckpointStore(tmp_path).position(SOURCE) == Instant(COMMITTED)


def test_two_sources_of_one_kind_keep_independent_positions(tmp_path):
    # The checkpoint is per *source*: one table's progress must not advance
    # another's and skip its rows.
    store = SourceCheckpointStore(tmp_path)
    commit(store)

    assert store.position(SOURCE) == Instant(COMMITTED)
    assert store.position(OTHER) is None


def test_the_same_key_under_another_kind_is_another_source(tmp_path):
    store = SourceCheckpointStore(tmp_path)
    commit(store)

    assert store.position(Source("sharepoint-list", SOURCE.key)) is None


def test_repeating_the_same_position_is_accepted_and_leaves_one_row(tmp_path):
    # Not-advancing is not going backwards, so an identical commit takes the
    # upsert path: the provenance refreshes and the source keeps one row.
    store = SourceCheckpointStore(tmp_path)
    commit(store, batch="batch-1", run="run-1")

    commit(store, batch="batch-2", run="run-2")

    rows = stored_rows(store)
    assert len(rows) == 1
    assert rows[0]["position_kind"] == "instant"
    assert rows[0]["position"] == COMMITTED.isoformat()
    assert rows[0]["batch_id"] == "batch-2"
    assert rows[0]["pipeline_run_id"] == "run-2"


def test_an_earlier_position_is_refused_and_changes_nothing(tmp_path):
    # A position that went backwards would re-poll ground already covered and,
    # worse, hide the fact that a run lost its place.
    store = SourceCheckpointStore(tmp_path)
    commit(store, batch="batch-1", run="run-1")

    with pytest.raises(ValueError, match="must not move backwards"):
        commit(store, at=COMMITTED - dt.timedelta(minutes=30), batch="b2", run="r2")

    row = stored_rows(store)[0]
    assert (row["position"], row["batch_id"], row["pipeline_run_id"]) == (
        COMMITTED.isoformat(),
        "batch-1",
        "run-1",
    )


def test_a_position_of_another_kind_is_refused(tmp_path):
    # A source does not change what it is measured in; a commit that tries is a
    # wiring mistake, not an advance.
    class Sequence:
        kind = "sequence"

        def __init__(self, n):
            self.n = n

        def encode(self):
            return str(self.n)

        @classmethod
        def decode(cls, text):
            return cls(int(text))

        def may_advance_to(self, successor):
            return successor.n >= self.n

    store = SourceCheckpointStore(tmp_path)
    commit(store)

    with pytest.raises(ValueError, match="measured in 'instant', not 'sequence'"):
        store.commit(SOURCE, Sequence(7), batch_id="b", pipeline_run_id="r")


def test_a_stored_kind_this_code_does_not_know_is_refused_on_read(tmp_path):
    # Reading a row written by newer code must fail plainly rather than
    # silently reading as unseen and re-fetching the source whole.
    store = SourceCheckpointStore(tmp_path)
    commit(store)
    con = sqlite3.connect(store.path)
    con.execute("UPDATE source_checkpoints SET position_kind = 'delta-link'")
    con.commit()
    con.close()

    with pytest.raises(ValueError, match="does not know"):
        store.position(SOURCE)


def test_a_naive_position_creates_no_control_state(tmp_path):
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

    assert store.position(SOURCE) is None


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


# --- carry-over from the pre-generic file -----------------------------------------

LEGACY_KEY = "https://contoso.sharepoint.com/sites/case-review|1b6f2a3c-0000-4a1f-9c7e-5f2d8a4b1e01"
LEGACY_SOURCE = Source("sharepoint-list", LEGACY_KEY)


def write_legacy_file(base_dir, rows):
    """A ``_checkpoints/sharepoint.db`` exactly as the pre-generic store wrote it."""
    path = base_dir / "_checkpoints" / "sharepoint.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE sharepoint_checkpoints (source_key TEXT PRIMARY KEY, site TEXT, "
        "list_id TEXT, watermark_utc TEXT, ingestion_batch_id TEXT, "
        "pipeline_run_id TEXT, committed_at_utc TEXT)"
    )
    con.executemany(
        "INSERT INTO sharepoint_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)", rows
    )
    con.commit()
    con.close()
    return path


LEGACY_ROW = (
    LEGACY_KEY,
    "https://contoso.sharepoint.com/sites/case-review",
    "1b6f2a3c-0000-4a1f-9c7e-5f2d8a4b1e01",
    COMMITTED.isoformat(),
    "old-batch",
    "old-run",
    "2026-08-05T08:31:00+00:00",
)


def test_a_list_committed_under_the_old_file_is_not_read_as_unseen(tmp_path):
    # The whole point of the carry-over: an upgraded base directory must not
    # re-fetch every list whole on its first run.
    write_legacy_file(tmp_path, [LEGACY_ROW])
    store = SourceCheckpointStore(tmp_path)

    assert store.position(LEGACY_SOURCE) == Instant(COMMITTED)
    assert not store.path.exists()  # still a read; the new file is not conjured


def test_only_a_sharepoint_list_is_looked_up_in_the_old_file(tmp_path):
    write_legacy_file(
        tmp_path, [(SOURCE.key, "", "", COMMITTED.isoformat(), "b", "r", "c")]
    )

    assert SourceCheckpointStore(tmp_path).position(SOURCE) is None


def test_the_first_commit_carries_every_old_row_over_with_its_provenance(tmp_path):
    other_key = LEGACY_KEY.replace("1b6f2a3c", "2c7e3b4d")
    other_row = (
        (other_key,) + LEGACY_ROW[1:3] + ("2026-08-05T07:00:00+00:00", "b2", "r2", "c2")
    )
    write_legacy_file(tmp_path, [LEGACY_ROW, other_row])
    store = SourceCheckpointStore(tmp_path)

    commit(
        store,
        LEGACY_SOURCE,
        at=COMMITTED + dt.timedelta(hours=1),
        batch="new",
        run="new",
    )

    rows = {row["key"]: row for row in stored_rows(store)}
    assert (
        rows[LEGACY_KEY]["position"] == (COMMITTED + dt.timedelta(hours=1)).isoformat()
    )
    assert rows[LEGACY_KEY]["batch_id"] == "new"
    assert rows[other_key] == {
        "kind": "sharepoint-list",
        "key": other_key,
        "position_kind": "instant",
        "position": "2026-08-05T07:00:00+00:00",
        "batch_id": "b2",
        "pipeline_run_id": "r2",
        "committed_at_utc": "c2",
    }


def test_the_first_commit_still_honours_the_old_position_it_is_advancing_from(tmp_path):
    # The monotonic guard reads what was carried over, so an upgrade cannot be
    # used to slip a position backwards past the old file.
    write_legacy_file(tmp_path, [LEGACY_ROW])
    store = SourceCheckpointStore(tmp_path)

    with pytest.raises(ValueError, match="must not move backwards"):
        commit(store, LEGACY_SOURCE, at=COMMITTED - dt.timedelta(hours=1))

    assert store.position(LEGACY_SOURCE) == Instant(COMMITTED)


def test_once_carried_over_the_old_file_is_never_consulted_again(tmp_path):
    legacy = write_legacy_file(tmp_path, [LEGACY_ROW])
    store = SourceCheckpointStore(tmp_path)
    commit(store, OTHER)  # any first commit performs the carry-over

    # Rewrite the old file with a newer watermark: it must be ignored now.
    legacy.unlink()
    write_legacy_file(
        tmp_path, [LEGACY_ROW[:3] + ("2030-01-01T00:00:00+00:00",) + LEGACY_ROW[4:]]
    )

    assert store.position(LEGACY_SOURCE) == Instant(COMMITTED)
    assert legacy.exists()  # and it is never deleted


def test_a_base_directory_without_the_old_file_carries_nothing_and_records_that(
    tmp_path,
):
    store = SourceCheckpointStore(tmp_path)
    commit(store)

    con = sqlite3.connect(store.path)
    names = [r[0] for r in con.execute("SELECT name FROM checkpoint_migrations")]
    con.close()
    assert names == ["carry_over_sharepoint_checkpoints"]
    assert store.position(LEGACY_SOURCE) is None
