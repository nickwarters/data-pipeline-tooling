```python
"""Fan-out: one wide feed → Cases table + Detail Table (issue #39, ADR-0009).

These tests verify the fan-out pattern end-to-end: a shared raw table is read
by two independent single-table pipelines, each projecting only its columns,
sharing one normalisation Processor, and landing current-state gold via Refresh.
"""

import uuid

import pandas as pd

from framework.builder import Pipeline
from framework.dataset import Dataset
from case_review.gold import detail_ingest_silver_to_gold, ingest_silver_to_gold
from framework.processors import Filter, Rename, SelectColumns, Unpivot
from framework.store import Store
from framework.strategy import AccumulateByRun, Refresh

_NS = uuid.uuid5(uuid.NAMESPACE_DNS, "wide_cases")

PRODUCT_COLS = [f"product_{i}" for i in range(1, 4)]  # keep small for tests


def _write_wide_raw(store: Store, run_id: str) -> None:
    """Seed a shared raw table with a wide feed (case + product columns)."""
    store.writer("raw", "wide_cases", AccumulateByRun(run_id, run_id)).write(
        Dataset.from_pandas(
            pd.DataFrame(
                {
                    "run_id": [run_id, run_id],
                    "load_date": [run_id, run_id],
                    "case_ref_no": ["c1", "c2"],
                    "adviser": ["adv-a", "adv-b"],
                    "amount": [500, 120],
                    "product_1": ["widget", "gadget"],
                    "product_2": ["doodad", None],
                    "product_3": [None, None],
                }
            )
        )
    )


# ---------------------------------------------------------------------------
# detail_ingest_silver_to_gold factory
# ---------------------------------------------------------------------------


def test_detail_silver_to_gold_produces_one_row_per_product(tmp_path):
    # Verifies the factory: reads projected silver (case_ref + products), derives
    # case_id, unpivots wide→long, writes Refresh to gold.
    store = Store(tmp_path)
    # Seed the silver table (already-projected product columns + natural key)
    store.writer("silver", "products", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame(
                {
                    "case_ref": ["c1", "c2"],
                    "product_1": ["widget", "gadget"],
                    "product_2": ["doodad", None],
                    "product_3": [None, None],
                }
            )
        )
    )

    detail_ingest_silver_to_gold(
        store,
        "products",
        namespace=_NS,
        natural_key=["case_ref"],
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    gold = store.reader("gold", "products").read().to_pandas()
    # c1 has product_1=widget, product_2=doodad (product_3 is None → dropped)
    # c2 has product_1=gadget (product_2 and product_3 are None → dropped)
    assert len(gold) == 3
    assert set(gold.columns) >= {"case_id", "product_slot", "product_name"}


def test_detail_case_id_matches_case_id_derived_independently(tmp_path):
    # ADR-0009: the Detail Table's case_id is derived from the same natural_key
    # under the same namespace as the Case table — no cross-pipeline join needed.
    store = Store(tmp_path)
    # Seed case silver (needs load_date for LatestPerKey in ingest_silver_to_gold)
    store.writer("silver", "cases", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"case_ref": ["c1"], "amount": [500], "load_date": ["2026-06-01"]})
        )
    )
    # Seed product silver
    store.writer("silver", "products", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"case_ref": ["c1"], "product_1": ["widget"], "product_2": [None], "product_3": [None]})
        )
    )

    # Build cases gold (case_id derived independently)
    ingest_silver_to_gold(
        store, "cases", namespace=_NS, natural_key=["case_ref"]
    ).run()

    # Build products gold (case_id derived independently — same namespace + key)
    detail_ingest_silver_to_gold(
        store,
        "products",
        namespace=_NS,
        natural_key=["case_ref"],
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    cases_gold = store.reader("gold", "cases").read().to_pandas()
    products_gold = store.reader("gold", "products").read().to_pandas()

    # The case_id in products must equal the case_id in cases for the same case_ref
    assert len(cases_gold) == 1
    assert len(products_gold) == 1  # only widget; None rows dropped
    assert cases_gold.iloc[0]["case_id"] == products_gold.iloc[0]["case_id"]


# ---------------------------------------------------------------------------
# End-to-end fan-out acceptance (ADR-0009 shape)
# ---------------------------------------------------------------------------


def test_fan_out_two_pipelines_over_shared_raw_produce_cases_and_detail(tmp_path):
    # Acceptance (ADR-0009): one wide feed → shared raw table → N independent
    # single-table pipelines, each projecting its own columns, sharing one
    # normalisation Processor instance, landing current-state gold.
    store = Store(tmp_path / "subject")
    run_id = "2026-06-01"

    # ---- Seed shared raw (the wide feed — column case_ref_no normalised by the shared processor) ----
    _write_wide_raw(store, run_id)

    # ---- Shared normalisation processor (defined once, used by both pipelines) ----
    normalise = Rename({"case_ref_no": "case_ref"})

    # ---- Cases pipeline: raw → silver (case columns only) ----
    (
        Pipeline("cases", store.reader("raw", "wide_cases"))
        .with_processor(Filter(lambda row, rid=run_id: row["run_id"] == rid))
        .with_processor(normalise)
        .with_processor(SelectColumns(["case_ref", "amount"]))
        .write_to(store.writer("silver", "cases", AccumulateByRun(run_id, run_id)))
        .run()
    )

    ingest_silver_to_gold(
        store, "cases", namespace=_NS, natural_key=["case_ref"]
    ).run()

    # ---- Products pipeline: raw → silver (product columns only) ----
    (
        Pipeline("products", store.reader("raw", "wide_cases"))
        .with_processor(Filter(lambda row, rid=run_id: row["run_id"] == rid))
        .with_processor(normalise)
        .with_processor(SelectColumns(["case_ref"] + PRODUCT_COLS))
        .write_to(store.writer("silver", "products", AccumulateByRun(run_id, run_id)))
        .run()
    )

    detail_ingest_silver_to_gold(
        store,
        "products",
        namespace=_NS,
        natural_key=["case_ref"],
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    cases_gold = store.reader("gold", "cases").read().to_pandas()
    products_gold = store.reader("gold", "products").read().to_pandas()

    # 2 cases in gold, one row each
    assert len(cases_gold) == 2

    # c1 has product_1=widget, product_2=doodad; c2 has product_1=gadget
    # product_2 for c2 and product_3 for both are None → dropped
    assert len(products_gold) == 3

    # All product rows link back to a known case_id
    known_case_ids = set(cases_gold["case_id"])
    assert set(products_gold["case_id"]).issubset(known_case_ids)


# ---------------------------------------------------------------------------
# Demo pipeline
# ---------------------------------------------------------------------------


def test_demo_fan_out_runs_end_to_end(tmp_path):
    # Smoke test: the demo pipeline runs without error and produces both
    # cases and case_products gold tables from the bundled wide CSV.
    from pipelines.demo_fan_out import main

    main(str(tmp_path))

    store = Store(tmp_path / "wide_cases")
    cases = store.reader("gold", "cases").read().to_pandas()
    products = store.reader("gold", "case_products").read().to_pandas()

    assert len(cases) == 4
    assert set(cases.columns) >= {"case_id", "case_ref"}
    # c1:2 + c2:1 + c3:3 + c4:1 = 7 non-empty product slots across 4 cases
    assert len(products) == 7
    assert set(products.columns) >= {"case_id", "product_slot", "product_name"}
    # All product rows link to a valid case
    assert set(products["case_id"]).issubset(set(cases["case_id"]))


def test_demo_fan_out_is_runnable_as_a_module(tmp_path):
    # Belt-and-braces: the documented `python -m` invocation runs from the repo
    # root, proving the import-only framework package resolves on sys.path.
    import subprocess
    import sys
    from pathlib import Path as P

    result = subprocess.run(
        [sys.executable, "-m", "pipelines.demo_fan_out", str(tmp_path)],
        capture_output=True,
        text=True,
        cwd=P(__file__).resolve().parent.parent,
    )
    assert result.returncode == 0
    assert "case_products gold" in result.stdout

```
