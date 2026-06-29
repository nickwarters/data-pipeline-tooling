```python
"""Fan-out: one wide feed -> Cases table + Detail Table.

These tests verify the fan-out pattern end-to-end: a shared raw table is read
by two independent single-table pipelines, each projecting only its columns,
sharing one normalisation Processor, and landing current-state gold via Refresh.
"""

import pandas as pd

from case_review.case_type import CaseType
from case_review.gold import detail_ingest_silver_to_gold, ingest_silver_to_gold
from framework.core.dataset import Dataset
from framework.io.strategy import AccumulateByRun, Refresh
from framework.run.builder import Pipeline
from framework.transform.processors import Filter, Rename, SelectColumns, Unpivot
from tests._schema_fixtures import LandedCase
from tools.medallion import medallion
from tools.store import StoreRegistry

# One Case Type owns identity for the wide feed; the Cases and Detail builders
# both read it, so case_id matches with no cross-pipeline join.
_WIDE_CASES = CaseType(name="wide_cases", schema=LandedCase, natural_key=("case_ref",))

PRODUCT_COLS = [f"product_{i}" for i in range(1, 4)]  # keep small for tests


def _write_wide_raw(med, run_id: str) -> None:
    """Seed a shared raw table with a wide feed (case + product columns)."""
    med.raw.writer("wide_cases", AccumulateByRun(run_id, run_id)).write(
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


def test_detail_silver_to_gold_produces_one_row_per_product(tmp_path):
    # Verifies the factory: reads projected silver (case_ref + products), derives
    # case_id, unpivots wide to long, writes Refresh to gold.
    med = medallion(StoreRegistry(tmp_path), "wide_cases")
    # Seed the silver table (already-projected product columns + natural key)
    med.silver.writer("products", Refresh()).write(
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
        med,
        _WIDE_CASES,
        "products",
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    gold = med.gold.reader("products").read().to_pandas()
    # c1 has product_1=widget, product_2=doodad (product_3 is None → dropped)
    # c2 has product_1=gadget (product_2 and product_3 are None → dropped)
    assert len(gold) == 3
    assert set(gold.columns) >= {"case_id", "product_slot", "product_name"}


def test_detail_case_id_matches_case_id_derived_independently(tmp_path):
    # The Detail Table's case_id is derived from the same natural_key under the
    # same namespace as the Case table; no cross-pipeline join is needed.
    med = medallion(StoreRegistry(tmp_path), "wide_cases")
    # Seed case silver (needs load_date for LatestPerKey in ingest_silver_to_gold)
    med.silver.writer("cases", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame(
                {"case_ref": ["c1"], "amount": [500], "load_date": ["2026-06-01"]}
            )
        )
    )
    # Seed product silver
    med.silver.writer("products", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame(
                {
                    "case_ref": ["c1"],
                    "product_1": ["widget"],
                    "product_2": [None],
                    "product_3": [None],
                }
            )
        )
    )

    ingest_silver_to_gold(med, _WIDE_CASES, "cases").run()

    detail_ingest_silver_to_gold(
        med,
        _WIDE_CASES,
        "products",
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    cases_gold = med.gold.reader("cases").read().to_pandas()
    products_gold = med.gold.reader("products").read().to_pandas()

    assert len(cases_gold) == 1
    assert len(products_gold) == 1  # only widget; None rows dropped
    assert cases_gold.iloc[0]["case_id"] == products_gold.iloc[0]["case_id"]


def test_fan_out_two_pipelines_over_shared_raw_produce_cases_and_detail(tmp_path):
    med = medallion(StoreRegistry(tmp_path), "subject")
    run_id = "2026-06-01"

    _write_wide_raw(med, run_id)

    normalise = Rename({"case_ref_no": "case_ref"})

    p_cases = Pipeline("cases")
    r_cases = p_cases.read(med.raw.reader("wide_cases"), name="read")
    f_cases = p_cases.transform(
        Filter(lambda row, rid=run_id: row["run_id"] == rid), r_cases, name="filter"
    )
    n_cases = p_cases.transform(normalise, f_cases, name="normalise")
    s_cases = p_cases.transform(
        SelectColumns(["case_ref", "amount"]), n_cases, name="select"
    )
    p_cases.write(
        med.silver.writer("cases", AccumulateByRun(run_id, run_id)),
        s_cases,
        name="write",
    )
    p_cases.run()

    ingest_silver_to_gold(med, _WIDE_CASES, "cases").run()

    p_products = Pipeline("products")
    r_products = p_products.read(med.raw.reader("wide_cases"), name="read")
    f_products = p_products.transform(
        Filter(lambda row, rid=run_id: row["run_id"] == rid), r_products, name="filter"
    )
    n_products = p_products.transform(normalise, f_products, name="normalise")
    s_products = p_products.transform(
        SelectColumns(["case_ref"] + PRODUCT_COLS), n_products, name="select"
    )
    p_products.write(
        med.silver.writer("products", AccumulateByRun(run_id, run_id)),
        s_products,
        name="write",
    )
    p_products.run()

    detail_ingest_silver_to_gold(
        med,
        _WIDE_CASES,
        "products",
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    cases_gold = med.gold.reader("cases").read().to_pandas()
    products_gold = med.gold.reader("products").read().to_pandas()

    assert len(cases_gold) == 2

    # c1 has product_1=widget, product_2=doodad; c2 has product_1=gadget
    # product_2 for c2 and product_3 for both are None → dropped
    assert len(products_gold) == 3

    known_case_ids = set(cases_gold["case_id"])
    assert set(products_gold["case_id"]).issubset(known_case_ids)


def test_demo_fan_out_runs_end_to_end(tmp_path):
    # Smoke test: the demo pipeline runs without error and produces both
    # cases and case_products gold tables from the bundled wide CSV.
    from pipelines.demo_fan_out import main

    main(str(tmp_path))

    med = medallion(StoreRegistry(tmp_path), "wide_cases")
    cases = med.gold.reader("cases").read().to_pandas()
    products = med.gold.reader("case_products").read().to_pandas()

    assert len(cases) == 4
    assert set(cases.columns) >= {"case_id", "case_ref"}
    # c1:2 + c2:1 + c3:3 + c4:1 = 7 non-empty product slots across 4 cases
    assert len(products) == 7
    assert set(products.columns) >= {"case_id", "product_slot", "product_name"}
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
        cwd=P(__file__).resolve().parent.parent.parent,
    )
    assert result.returncode == 0
    assert "case_products gold" in result.stdout

```
