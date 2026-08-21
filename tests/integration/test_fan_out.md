```python
"""Fan-out: one wide feed -> Cases table + Detail Table.

These tests verify the fan-out pattern end-to-end: a shared raw table is read
by two independent single-table passes, each projecting only its columns,
sharing one normalisation Processor, and landing current-state gold via Refresh.

Each pass writes its own reduction out with the eager steps. There is no shared
gold builder to call: the Cases reduction and the Detail reduction are a handful
of lines each, and what makes them agree is that both are handed the *same*
namespace and natural key -- which is the thing these tests actually check.
"""

import pandas as pd

from framework.core.dataset import Dataset
from framework.core.validators import UniqueValidator
from framework.io.strategy import AccumulateByRun, Refresh
from framework.run import read, transform, validate, write
from framework.transform.processors import (
    DeriveKey,
    Filter,
    LatestPerKey,
    Rename,
    SelectColumns,
    Unpivot,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

NAMESPACE = "wide_cases"
NATURAL_KEY = ("case_ref",)
CASE_ID = "case_id"

PRODUCT_COLS = [f"product_{i}" for i in range(1, 4)]  # keep small for tests


def _derive_key(dataset, *, name):
    return transform(
        DeriveKey(into=CASE_ID, namespace=NAMESPACE, natural_key=list(NATURAL_KEY)),
        dataset,
        name=name,
    )


def _reduce_cases_to_gold(med, table="cases"):
    """Accumulated case silver -> one current row per Case."""
    data = read(med.silver.reader(table), name=f"{table}:read")
    data = _derive_key(data, name=f"{table}:derive-key")
    data = transform(
        LatestPerKey(key=CASE_ID, by="load_date"), data, name=f"{table}:latest-per-key"
    )
    validate(UniqueValidator(CASE_ID), data, name=f"{table}:unique-validate")
    write(med.gold.writer(table, Refresh()), data, name=f"{table}:write")


def _reduce_products_to_gold(med, table="products"):
    """Accumulated product silver -> one row per Case per filled product slot."""
    data = read(med.silver.reader(table), name=f"{table}:read")
    data = _derive_key(data, name=f"{table}:derive-key")
    data = transform(
        Unpivot(
            id_vars=[CASE_ID],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
        data,
        name=f"{table}:unpivot",
    )
    write(med.gold.writer(table, Refresh()), data, name=f"{table}:write")


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
    # Reads projected silver (case_ref + products), derives case_id, unpivots
    # wide to long, writes Refresh to gold.
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

    _reduce_products_to_gold(med)

    gold = med.gold.reader("products").read().to_pandas()
    # c1 has product_1=widget, product_2=doodad (product_3 is None → dropped)
    # c2 has product_1=gadget (product_2 and product_3 are None → dropped)
    assert len(gold) == 3
    assert set(gold.columns) >= {"case_id", "product_slot", "product_name"}


def test_detail_case_id_matches_case_id_derived_independently(tmp_path):
    # The Detail Table's case_id is derived from the same natural_key under the
    # same namespace as the Case table; no cross-pipeline join is needed.
    med = medallion(StoreRegistry(tmp_path), "wide_cases")
    # Seed case silver (needs load_date for the LatestPerKey reduction)
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

    _reduce_cases_to_gold(med)
    _reduce_products_to_gold(med)

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
    this_run = Filter(lambda row, rid=run_id: row["run_id"] == rid)

    cases = read(med.raw.reader("wide_cases"), name="cases:read")
    cases = transform(this_run, cases, name="cases:filter")
    cases = transform(normalise, cases, name="cases:normalise")
    cases = transform(SelectColumns(["case_ref", "amount"]), cases, name="cases:select")
    write(
        med.silver.writer("cases", AccumulateByRun(run_id, run_id)),
        cases,
        name="cases:write-silver",
    )
    _reduce_cases_to_gold(med)

    products = read(med.raw.reader("wide_cases"), name="products:read")
    products = transform(this_run, products, name="products:filter")
    products = transform(normalise, products, name="products:normalise")
    products = transform(
        SelectColumns(["case_ref"] + PRODUCT_COLS), products, name="products:select"
    )
    write(
        med.silver.writer("products", AccumulateByRun(run_id, run_id)),
        products,
        name="products:write-silver",
    )
    _reduce_products_to_gold(med)

    cases_gold = med.gold.reader("cases").read().to_pandas()
    products_gold = med.gold.reader("products").read().to_pandas()

    assert len(cases_gold) == 2

    # c1 has product_1=widget, product_2=doodad; c2 has product_1=gadget
    # product_2 for c2 and product_3 for both are None → dropped
    assert len(products_gold) == 3

```
