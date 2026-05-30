import threading

import pandas as pd
import pytest

from framework.connection import connect
from framework.dataset import Dataset
from framework.gold import silver_to_gold
from framework.store import Store
from framework.validators import ValidationError
from tests._schema_fixtures import LandedCase


def _land_silver(store: Store, table: str, frame: pd.DataFrame) -> None:
    # Land a snapshot into silver exactly as a raw->silver pipeline would, so the
    # gold builder has a validated upstream to read from.
    store.writer("silver", table).write(Dataset.from_pandas(frame))


def test_silver_to_gold_accumulates_stamped_by_run(tmp_path):
    # The builder reads the subject's silver table and accumulates it into gold,
    # stamping each row with the run's run_id / load_date (ADR-0006).
    store = Store(tmp_path)
    _land_silver(
        store,
        "selection_pool",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": [10, 20]}),
    )

    silver_to_gold(
        store, "selection_pool", run_id="2026-05-30", load_date="2026-05-30"
    ).run()

    assert (tmp_path / "gold.db").exists()
    landed = store.reader("gold", "selection_pool").read().to_pandas()
    assert len(landed) == 2
    assert set(landed["run_id"]) == {"2026-05-30"}
    assert set(landed["load_date"]) == {"2026-05-30"}


def test_silver_to_gold_re_run_replaces_only_that_run(tmp_path):
    # Re-driving the same run_id through the builder is idempotent: delete-by-run
    # then insert, so a re-run does not duplicate that run's rows (ADR-0006).
    store = Store(tmp_path)
    _land_silver(
        store,
        "selection_pool",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": [10, 20]}),
    )

    silver_to_gold(
        store, "selection_pool", run_id="2026-05-30", load_date="2026-05-30"
    ).run()
    silver_to_gold(
        store, "selection_pool", run_id="2026-05-30", load_date="2026-05-30"
    ).run()

    assert len(store.reader("gold", "selection_pool").read()) == 2


def test_silver_to_gold_keeps_history_across_distinct_runs(tmp_path):
    # Distinct runs accumulate — gold is the audit trail of past selections, so a
    # later run adds its rows rather than refreshing prior ones (ADR-0006). Here
    # the silver snapshot itself changes between runs, as a real re-selection would.
    store = Store(tmp_path)

    _land_silver(store, "selection_pool", pd.DataFrame({"case_ref": ["c1"]}))
    silver_to_gold(
        store, "selection_pool", run_id="2026-05-29", load_date="2026-05-29"
    ).run()

    _land_silver(store, "selection_pool", pd.DataFrame({"case_ref": ["c2", "c3"]}))
    silver_to_gold(
        store, "selection_pool", run_id="2026-05-30", load_date="2026-05-30"
    ).run()

    landed = store.reader("gold", "selection_pool").read().to_pandas()
    assert len(landed) == 3
    assert set(landed["run_id"]) == {"2026-05-29", "2026-05-30"}


def test_silver_to_gold_enforces_schema_then_accumulates(tmp_path):
    # When a schema is supplied it is enforced as a post-validator on the data
    # about to be written into gold (belt-and-braces, ADR-0008). Conforming
    # silver passes the check, so the run completes and the rows accumulate.
    store = Store(tmp_path)
    _land_silver(
        store,
        "selection_pool",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": [10, 20]}),
    )

    silver_to_gold(
        store,
        "selection_pool",
        run_id="2026-05-30",
        load_date="2026-05-30",
        schema=LandedCase,
    ).run()

    landed = store.reader("gold", "selection_pool").read()
    assert len(landed) == 2


def test_silver_to_gold_aborts_at_the_gold_boundary_without_writing(tmp_path):
    # A schema breach in the data bound for gold (here: score as text, not int)
    # fails at the post-validate step with a located message — and because the
    # run is fail-fast and atomic (ADR-0007), no gold.db is written.
    store = Store(tmp_path)
    _land_silver(
        store,
        "selection_pool",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": ["oops", "nope"]}),
    )

    with pytest.raises(ValidationError, match="post-validate failed.*score"):
        silver_to_gold(
            store,
            "selection_pool",
            run_id="2026-05-30",
            load_date="2026-05-30",
            schema=LandedCase,
        ).run()

    assert not (tmp_path / "gold.db").exists()


def test_silver_to_gold_breach_leaves_prior_accumulation_intact(tmp_path):
    # Atomicity over an accumulating layer: a later breaching run must not delete
    # or insert anything — the post-validate abort happens before the writer's
    # delete-by-run/insert transaction, so a prior run's gold rows survive intact.
    store = Store(tmp_path)
    _land_silver(store, "selection_pool", pd.DataFrame({"case_ref": ["c1"], "score": [10]}))
    silver_to_gold(
        store, "selection_pool", run_id="2026-05-29", load_date="2026-05-29",
        schema=LandedCase,
    ).run()

    # A second snapshot that breaches the schema (score as text) — its run aborts.
    _land_silver(
        store, "selection_pool",
        pd.DataFrame({"case_ref": ["c2"], "score": ["nope"]}),
    )
    with pytest.raises(ValidationError, match="post-validate failed.*score"):
        silver_to_gold(
            store, "selection_pool", run_id="2026-05-30", load_date="2026-05-30",
            schema=LandedCase,
        ).run()

    landed = store.reader("gold", "selection_pool").read().to_pandas()
    assert len(landed) == 1
    assert set(landed["run_id"]) == {"2026-05-29"}


def test_gold_reader_rides_out_an_in_flight_writer_commit(tmp_path):
    # Read-only access to gold tolerates the single writer's in-place commits
    # (ADR-0001): with a busy_timeout the reader waits out an exclusive lock
    # instead of erroring. Drive it by holding a real lock on gold.db while a
    # gold Store reader reads concurrently.
    store = Store(tmp_path)
    _land_silver(store, "selection_pool", pd.DataFrame({"case_ref": ["c1"]}))
    silver_to_gold(
        store, "selection_pool", run_id="2026-05-30", load_date="2026-05-30"
    ).run()
    gold_db = tmp_path / "gold.db"

    locked = threading.Event()
    release = threading.Event()

    def hold_exclusive_lock() -> None:
        con = connect(gold_db)
        try:
            con.execute("BEGIN EXCLUSIVE")
            locked.set()
            release.wait(timeout=5)
            con.commit()
        finally:
            con.close()

    writer = threading.Thread(target=hold_exclusive_lock)
    writer.start()
    try:
        assert locked.wait(timeout=5)

        # A reader that refuses to wait (busy_timeout 0) errors on the held lock
        # — proof the contention is real, not incidental. (pandas wraps the
        # underlying sqlite3.OperationalError as a DatabaseError.)
        with pytest.raises(pd.errors.DatabaseError, match="locked"):
            Store(tmp_path, busy_timeout_ms=0).reader(
                "gold", "selection_pool"
            ).read()

        # The default share-tolerant reader rides the lock out: release it
        # shortly, and the in-flight read completes instead of erroring.
        threading.Timer(0.2, release.set).start()
        landed = store.reader("gold", "selection_pool").read()
        assert len(landed) == 1
    finally:
        release.set()
        writer.join(timeout=5)
