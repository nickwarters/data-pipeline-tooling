import threading
import uuid

import pandas as pd
import pytest

from case_review.case_type import CaseType
from case_review.gold import ingest_silver_to_gold
from framework.io.dataset import Dataset
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun, Refresh
from framework.run.gold import silver_to_gold
from framework.shared.connection import connect
from framework.transform.validators import ValidationError
from tests._schema_fixtures import LandedCase, RuledCase

# The Case Type owns identity now; its namespace derives from its name, so this
# is the same UUID space the explicit _NS used to name.
_CASES = CaseType(name="cases", schema=LandedCase, natural_key=("case_ref",))
_NS = uuid.uuid5(uuid.NAMESPACE_DNS, "cases")


def _land_silver(store: Store, table: str, frame: pd.DataFrame, strategy=None) -> None:
    # Land a snapshot into silver exactly as a raw->silver pipeline would, so the
    # gold builder has a validated upstream to read from.
    store.writer(
        "silver", table, strategy if strategy is not None else Refresh()
    ).write(Dataset.from_pandas(frame))


def test_silver_to_gold_accumulates_stamped_by_run(tmp_path):
    # The builder reads the subject's silver table and accumulates it into gold,
    # stamping each row with the run's run_id / load_date.
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
    # then insert, so a re-run does not duplicate that run's rows.
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
    # later run adds its rows rather than refreshing prior ones. Here
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
    # about to be written into gold (belt-and-braces, ). Conforming
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
    # run is fail-fast and atomic, no gold.db is written.
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


def test_silver_to_gold_aborts_on_a_value_rule_breach_without_writing(tmp_path):
    # Value-level rules enforce at the gold boundary on the same footing as
    # silver, via the same SchemaValidator post-validator: a breach (a case_ref
    # failing its 9-10 digit Pattern) aborts before the gold write — fail-fast and
    # atomic, so no gold.db is written.
    store = Store(tmp_path)
    _land_silver(
        store,
        "selection_pool",
        pd.DataFrame({"case_ref": ["123456789", "NOPE"], "status": ["open", "closed"]}),
    )

    with pytest.raises(ValidationError, match="post-validate failed.*violates pattern"):
        silver_to_gold(
            store,
            "selection_pool",
            run_id="2026-05-30",
            load_date="2026-05-30",
            schema=RuledCase,
        ).run()

    assert not (tmp_path / "gold.db").exists()


def test_silver_to_gold_breach_leaves_prior_accumulation_intact(tmp_path):
    # Atomicity over an accumulating layer: a later breaching run must not delete
    # or insert anything — the post-validate abort happens before the writer's
    # delete-by-run/insert transaction, so a prior run's gold rows survive intact.
    store = Store(tmp_path)
    _land_silver(
        store, "selection_pool", pd.DataFrame({"case_ref": ["c1"], "score": [10]})
    )
    silver_to_gold(
        store,
        "selection_pool",
        run_id="2026-05-29",
        load_date="2026-05-29",
        schema=LandedCase,
    ).run()

    # A second snapshot that breaches the schema (score as text) — its run aborts.
    _land_silver(
        store,
        "selection_pool",
        pd.DataFrame({"case_ref": ["c2"], "score": ["nope"]}),
    )
    with pytest.raises(ValidationError, match="post-validate failed.*score"):
        silver_to_gold(
            store,
            "selection_pool",
            run_id="2026-05-30",
            load_date="2026-05-30",
            schema=LandedCase,
        ).run()

    landed = store.reader("gold", "selection_pool").read().to_pandas()
    assert len(landed) == 1
    assert set(landed["run_id"]) == {"2026-05-29"}


def test_gold_reader_rides_out_an_in_flight_writer_commit(tmp_path):
    # Read-only access to gold tolerates the single writer's in-place commits
    #: with a busy_timeout the reader waits out an exclusive lock
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
            Store(tmp_path, busy_timeout_ms=0).reader("gold", "selection_pool").read()

        # The default share-tolerant reader rides the lock out: release it
        # shortly, and the in-flight read completes instead of erroring.
        threading.Timer(0.2, release.set).start()
        landed = store.reader("gold", "selection_pool").read()
        assert len(landed) == 1
    finally:
        release.set()
        writer.join(timeout=5)


def test_ingest_silver_to_gold_reduces_to_one_row_per_case(tmp_path):
    # ingest_silver_to_gold reads accumulated silver, derives case_id, collapses
    # to the latest row per Case, validates uniqueness, and writes a Refresh gold.
    store = Store(tmp_path)
    _land_silver(
        store,
        "cases",
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2"],
                "score": [10, 20],
                "load_date": ["2026-05-29", "2026-05-29"],
            }
        ),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )

    ingest_silver_to_gold(store, _CASES).run()

    landed = store.reader("gold", "cases").read().to_pandas()
    assert len(landed) == 2
    assert set(landed["case_ref"]) == {"c1", "c2"}
    assert "case_id" in landed.columns


def test_ingest_silver_to_gold_keeps_latest_version_of_a_changed_case(tmp_path):
    # A Case that changes across runs retains all versions in silver but appears
    # once (latest) in gold — the framework is the historian for a destructive source.
    store = Store(tmp_path)
    _land_silver(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [10], "load_date": ["2026-05-29"]}),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )
    _land_silver(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [99], "load_date": ["2026-05-30"]}),
        strategy=AccumulateByRun("2026-05-30", "2026-05-30"),
    )

    ingest_silver_to_gold(store, _CASES).run()

    silver = store.reader("silver", "cases").read().to_pandas()
    gold = store.reader("gold", "cases").read().to_pandas()
    assert len(silver) == 2  # both versions in silver
    assert len(gold) == 1  # one row in gold (latest)
    assert gold["score"].iloc[0] == 99  # latest value


def test_ingest_silver_to_gold_idempotent_re_run_leaves_gold_unchanged(tmp_path):
    # Re-running the same snapshot leaves gold unchanged — Refresh truncates and
    # reloads, and LatestPerKey yields the same deterministic result each run.
    store = Store(tmp_path)
    _land_silver(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [10], "load_date": ["2026-05-29"]}),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )

    ingest_silver_to_gold(store, _CASES).run()
    ingest_silver_to_gold(store, _CASES).run()

    gold = store.reader("gold", "cases").read().to_pandas()
    assert len(gold) == 1
    assert gold["score"].iloc[0] == 10


def test_ingest_silver_to_gold_new_snapshot_updates_gold_to_current(tmp_path):
    # A new snapshot (distinct run_id) accumulates in silver and updates gold to
    # reflect the latest state — gold is always one row per Case.
    store = Store(tmp_path)
    _land_silver(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [10], "load_date": ["2026-05-29"]}),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )
    ingest_silver_to_gold(store, _CASES).run()
    assert store.reader("gold", "cases").read().to_pandas()["score"].iloc[0] == 10

    _land_silver(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [42], "load_date": ["2026-05-30"]}),
        strategy=AccumulateByRun("2026-05-30", "2026-05-30"),
    )
    ingest_silver_to_gold(store, _CASES).run()

    gold = store.reader("gold", "cases").read().to_pandas()
    assert len(gold) == 1
    assert gold["score"].iloc[0] == 42


def test_ingest_silver_to_gold_deterministic_case_id(tmp_path):
    # case_id is a deterministic uuid5: same natural key, same namespace, same
    # id across runs and machines.
    store = Store(tmp_path)
    _land_silver(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "load_date": ["2026-05-29"]}),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )

    ingest_silver_to_gold(store, _CASES).run()
    first_id = store.reader("gold", "cases").read().to_pandas()["case_id"].iloc[0]

    ingest_silver_to_gold(store, _CASES).run()
    second_id = store.reader("gold", "cases").read().to_pandas()["case_id"].iloc[0]

    assert first_id == second_id
    assert first_id == str(uuid.uuid5(_NS, "c1"))
