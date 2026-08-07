```python
"""The per-list ``Modified`` watermark, and the window rule computed over it.

No network and no tenant: a checkpoint is control state on disk, so every test
here drives a real SQLite file under ``tmp_path`` and reads it back with plain
``sqlite3`` to assert what was persisted.
"""

import datetime as dt
import sqlite3
import time
from uuid import UUID

import pytest

from tools.integrations.sharepoint_checkpoint import (
    SharePointCheckpointStore,
    SharePointSource,
)

SITE = "https://contoso.sharepoint.com/sites/case-review"
LIST_ID = UUID("1b6f2a3c-0000-4a1f-9c7e-5f2d8a4b1e01")
OTHER_LIST_ID = UUID("2c7e3b4d-0000-4b2a-8d6f-6a3e9b5c2f12")
SOURCE = SharePointSource(SITE, LIST_ID)

SERVER_NOW = dt.datetime(2026, 8, 5, 9, 0, tzinfo=dt.timezone.utc)
OVERLAP = dt.timedelta(minutes=5)
SAFETY_LAG = dt.timedelta(minutes=2)
NAIVE = dt.datetime(2026, 8, 5, 9, 0)


def window(
    store,
    source=SOURCE,
    *,
    server_now=SERVER_NOW,
    overlap=OVERLAP,
    safety_lag=SAFETY_LAG,
):
    return store.window(
        source, server_now=server_now, overlap=overlap, safety_lag=safety_lag
    )


def commit(store, source=SOURCE, *, window_end, batch="batch-1", run="run-1"):
    store.commit(
        source,
        window_end=window_end,
        ingestion_batch_id=batch,
        pipeline_run_id=run,
    )


def stored_rows(store):
    """Every persisted checkpoint row, read back outside the store."""
    con = sqlite3.connect(store.path)
    try:
        cur = con.execute("SELECT * FROM sharepoint_checkpoints ORDER BY source_key")
        columns = [d[0] for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]
    finally:
        con.close()


def test_an_unseen_source_has_no_watermark_and_creates_no_file(tmp_path):
    # Reading is a read: a source nobody has committed for must not bring the
    # control-state file (or its DDL) into existence as a side effect.
    store = SharePointCheckpointStore(tmp_path)

    assert store.committed_watermark(SOURCE) is None
    assert not store.path.exists()


def test_the_first_window_has_no_lower_bound(tmp_path):
    # Nothing has been committed, so there is no floor to resume from: the first
    # run fetches the full current list, up to the safe upper boundary.
    store = SharePointCheckpointStore(tmp_path)

    first = window(store)

    assert first.start is None
    assert first.end == SERVER_NOW - SAFETY_LAG


def test_a_committed_source_resumes_one_overlap_early(tmp_path):
    # The overlap is deliberate re-reading: an item whose Modified landed either
    # side of the last boundary is re-observed rather than missed.
    store = SharePointCheckpointStore(tmp_path)
    watermark = dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc)
    commit(store, window_end=watermark)

    next_window = window(store)

    assert next_window.start == watermark - OVERLAP
    assert next_window.end == SERVER_NOW - SAFETY_LAG


def test_two_lists_under_one_site_keep_independent_watermarks(tmp_path):
    # The checkpoint is per *list*, not per site: one list's progress must not
    # advance another's and skip its changes.
    store = SharePointCheckpointStore(tmp_path)
    other = SharePointSource(SITE, OTHER_LIST_ID)
    commit(store, window_end=dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc))

    assert store.committed_watermark(SOURCE) == dt.datetime(
        2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc
    )
    assert store.committed_watermark(other) is None


def test_a_commit_survives_reopening_the_store(tmp_path):
    # Durability is the whole point: the next run is a new process.
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc)
    commit(SharePointCheckpointStore(tmp_path), window_end=committed)

    reopened = SharePointCheckpointStore(tmp_path)

    assert reopened.committed_watermark(SOURCE) == committed


def test_repeating_the_same_window_end_is_accepted_and_leaves_one_row(tmp_path):
    # Not-advancing is not going backwards, so an identical commit takes the
    # upsert path: the provenance refreshes and the source keeps one row.
    store = SharePointCheckpointStore(tmp_path)
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc)
    commit(store, window_end=committed, batch="batch-1", run="run-1")

    commit(store, window_end=committed, batch="batch-2", run="run-2")

    rows = stored_rows(store)
    assert len(rows) == 1
    assert rows[0]["watermark_utc"] == committed.isoformat()
    assert rows[0]["ingestion_batch_id"] == "batch-2"
    assert rows[0]["pipeline_run_id"] == "run-2"


def test_an_older_window_end_is_refused_and_changes_nothing(tmp_path):
    # A watermark that went backwards would re-poll ground already covered and,
    # worse, hide the fact that a run lost its place.
    store = SharePointCheckpointStore(tmp_path)
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc)
    commit(store, window_end=committed, batch="batch-1", run="run-1")

    with pytest.raises(ValueError, match="must not move backwards"):
        commit(
            store,
            window_end=dt.datetime(2026, 8, 5, 8, 0, tzinfo=dt.timezone.utc),
            batch="batch-2",
            run="run-2",
        )

    row = stored_rows(store)[0]
    assert (
        row["watermark_utc"],
        row["ingestion_batch_id"],
        row["pipeline_run_id"],
    ) == (committed.isoformat(), "batch-1", "run-1")


@pytest.mark.parametrize(
    "call",
    [
        lambda store: window(store, server_now=NAIVE),
        lambda store: commit(store, window_end=NAIVE),
    ],
    ids=["server_now", "window_end"],
)
def test_a_naive_instant_is_refused(tmp_path, call):
    # A naive datetime has no single UTC meaning; reading it as the local zone
    # would shift the watermark by whatever offset the running box is in.
    with pytest.raises(ValueError, match="timezone-aware"):
        call(SharePointCheckpointStore(tmp_path))


def test_an_offset_aware_commit_is_stored_as_the_same_utc_instant(tmp_path):
    # One conversion, at the boundary: the stored text is UTC with an explicit
    # offset, matching the shape every other persisted instant carries.
    store = SharePointCheckpointStore(tmp_path)
    local = dt.timezone(dt.timedelta(hours=1))

    commit(store, window_end=dt.datetime(2026, 8, 5, 9, 30, tzinfo=local))

    assert stored_rows(store)[0]["watermark_utc"] == "2026-08-05T08:30:00+00:00"
    assert store.committed_watermark(SOURCE) == dt.datetime(
        2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc
    )


def test_a_window_that_has_not_advanced_yet_is_empty_rather_than_an_error(tmp_path):
    # Running again before the safe upper bound has moved past the committed
    # watermark is ordinary operation, not a failure: there is nothing left to
    # poll yet, so None is returned rather than a window of covered ground.
    store = SharePointCheckpointStore(tmp_path)
    first = window(store)
    commit(store, window_end=first.end)

    assert window(store) is None


@pytest.mark.parametrize(
    "kwargs",
    [
        {"overlap": dt.timedelta(minutes=-1)},
        {"safety_lag": dt.timedelta(minutes=-1)},
    ],
    ids=["overlap", "safety_lag"],
)
def test_a_negative_overlap_or_safety_lag_is_refused(tmp_path, kwargs):
    # A negative safety lag reads into the future; a negative overlap opens a
    # permanent gap between consecutive windows.
    store = SharePointCheckpointStore(tmp_path)

    with pytest.raises(ValueError, match="must not be negative"):
        window(store, **kwargs)


@pytest.mark.parametrize(
    "site",
    [
        "https://user:secret@contoso.sharepoint.com/sites/case-review",
        "https://user@contoso.sharepoint.com/sites/case-review",
    ],
    ids=["user_and_password", "user_only"],
)
def test_credentials_in_the_site_url_never_reach_the_store(tmp_path, site):
    # Credentials must not survive in persisted control state — and the keyed
    # site is what the key is built from, so the same list addressed with and
    # without them is one source, not two.
    store = SharePointCheckpointStore(tmp_path)
    credentialled = SharePointSource(site, LIST_ID)
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc)

    commit(store, credentialled, window_end=committed)

    rows = stored_rows(store)
    assert len(rows) == 1
    assert "@" not in rows[0]["site"]
    assert credentialled.key == SOURCE.key
    assert store.committed_watermark(SOURCE) == committed


def test_a_trailing_slash_addresses_the_same_source(tmp_path):
    store = SharePointCheckpointStore(tmp_path)
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc)

    commit(store, SharePointSource(SITE + "/", LIST_ID), window_end=committed)

    assert store.committed_watermark(SOURCE) == committed


def test_the_host_folds_to_lower_case_but_the_path_does_not(tmp_path):
    # DNS does not distinguish hosts by case; a site path may.
    store = SharePointCheckpointStore(tmp_path)
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc)

    commit(
        store,
        SharePointSource("https://CONTOSO.SharePoint.com/sites/case-review", LIST_ID),
        window_end=committed,
    )

    assert store.committed_watermark(SOURCE) == committed
    assert store.committed_watermark(SharePointSource(SITE.upper(), LIST_ID)) is None


def test_a_naive_window_end_creates_no_control_state(tmp_path):
    # The instant is checked before anything is opened, so a caller's bad
    # argument does not leave an empty checkpoint file behind.
    store = SharePointCheckpointStore(tmp_path)

    with pytest.raises(ValueError, match="timezone-aware"):
        commit(store, window_end=NAIVE)

    assert not store.path.exists()


def test_a_file_without_the_table_yet_reads_as_unseen(tmp_path):
    # A concurrent first commit creates the file before its DDL commits, so the
    # file existing is not enough: reading must not blow up on a missing table.
    store = SharePointCheckpointStore(tmp_path)
    store.path.parent.mkdir(parents=True)
    sqlite3.connect(store.path).close()

    assert store.committed_watermark(SOURCE) is None
    assert window(store).start is None


def test_a_concurrent_writer_is_waited_for_not_retried(tmp_path):
    # busy_timeout is the whole contention policy: a commit waits out the other
    # writer for that long and then fails plainly, rather than looping and
    # hiding the contention behind a longer wall-clock time.
    store = SharePointCheckpointStore(tmp_path)
    commit(store, window_end=dt.datetime(2026, 8, 5, 8, 0, tzinfo=dt.timezone.utc))

    writer = sqlite3.connect(store.path)
    writer.execute("BEGIN IMMEDIATE")
    try:
        blocked = SharePointCheckpointStore(tmp_path, busy_timeout_ms=300)
        started = time.monotonic()
        with pytest.raises(sqlite3.OperationalError):
            commit(
                blocked,
                window_end=dt.datetime(2026, 8, 5, 8, 30, tzinfo=dt.timezone.utc),
            )
        assert time.monotonic() - started >= 0.3
    finally:
        writer.rollback()
        writer.close()


def test_the_checkpoint_file_sits_beside_the_other_base_directory_metadata(tmp_path):
    # One owner of the location: control state is a sibling of the run metadata,
    # not something inside it.
    store = SharePointCheckpointStore(tmp_path)

    assert store.path == tmp_path / "_checkpoints" / "sharepoint.db"

```
