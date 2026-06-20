import threading
import uuid

import pandas as pd
import pytest

from case_review.case_type import CaseType
from case_review.gold import ingest_silver_to_gold
from framework._internal.connection import connect
from framework.core.dataset import Dataset
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun, Refresh
from framework.validate.validators import ValidationError
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
