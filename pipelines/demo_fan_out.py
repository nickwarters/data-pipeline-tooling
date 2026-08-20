"""Fan-out demo: one wide feed -> Cases table + Detail Table.

Shows how a single wide ingest feed is fanned into two independent single-table
pipelines over the shared raw table:

1. **Raw** — the wide CSV lands in one shared raw table, stamped with
   ``logical_run_id`` / ``load_date``.
2. **Cases pipeline** — projects the case columns, applies the shared
   normalisation, schema-coerces and validates, accumulates silver, then
   reduces to a current-only one-row-per-Case gold.
3. **Products pipeline** — projects the product columns + natural key, applies
   the *same* shared normalisation instance, accumulates silver, then derives
   ``case_id`` and unpivots wide→long into the ``case_products`` Detail Table
   gold (empty slots dropped).

Both pipelines read the same raw table, share one normalisation ``Processor``
instance (defined once here), and are each independently validated / atomic
with their own gold write.

Run from the repo root::

    python -m pipelines.demo_fan_out /tmp/demo_fan_out
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from framework.core import SchemaValidator, UniqueValidator
from framework.io import AccumulateByRun, CsvReader, Refresh
from framework.run import read, transform, validate, write
from framework.transform import (
    DeriveKey,
    Filter,
    LatestPerKey,
    Rename,
    SchemaCoercion,
    SelectColumns,
    Unpivot,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

PRODUCT_COLS = [f"product_{i}" for i in range(1, 11)]


@dataclass
class CaseSchema:
    """Case columns projected from the wide feed."""

    case_ref: str
    adviser: str
    activity_date: date
    amount: int


NAMESPACE = "wide_cases"
NATURAL_KEY = ("case_ref",)
RUN_ID = "2026-05-29"
# Both gold reductions stamp and key on the same column, so a Case and its
# products derive the same deterministic id without joining back.
CASE_ID_COLUMN = "case_id"


def main(target_dir: str) -> None:
    sample = Path(__file__).parent / "sample_data" / "wide_cases.csv"
    med = medallion(StoreRegistry(target_dir), NAMESPACE)
    strategy = AccumulateByRun(RUN_ID, RUN_ID)

    # --- raw: the wide feed lands once, shared by both branches -------------
    landed = read(CsvReader(sample))
    write(med.raw.writer(NAMESPACE, strategy), landed, name="write-raw")

    # Shared normalisation: the feed uses `case_ref_no`; both branches rename
    # it to the canonical `case_ref` (defined once, reused below).
    normalise = Rename({"case_ref_no": "case_ref"})
    this_run = Filter(lambda row, rid=RUN_ID: row["logical_run_id"] == rid)

    # --- cases: silver ------------------------------------------------------
    cases = read(med.raw.reader(NAMESPACE), name="read-raw-cases")
    cases = transform(this_run, cases, name="filter-cases")
    cases = transform(normalise, cases, name="normalise-cases")
    cases = transform(
        SelectColumns(["case_ref", "adviser", "activity_date", "amount"]),
        cases,
        name="select-cases",
    )
    cases = transform(SchemaCoercion(CaseSchema), cases, name="coerce-cases")
    validate(SchemaValidator(CaseSchema), cases, name="validate-cases")
    write(med.silver.writer("cases", strategy), cases, name="write-silver-cases")

    # --- cases: gold, one current row per Case ------------------------------
    gold_cases = read(med.silver.reader("cases"), name="read-silver-cases")
    gold_cases = transform(
        DeriveKey(
            into=CASE_ID_COLUMN, namespace=NAMESPACE, natural_key=list(NATURAL_KEY)
        ),
        gold_cases,
        name="derive-key-cases",
    )
    gold_cases = transform(
        LatestPerKey(key=CASE_ID_COLUMN, by="load_date"),
        gold_cases,
        name="latest-per-key",
    )
    validate(UniqueValidator(CASE_ID_COLUMN), gold_cases, name="unique-validate")
    write(med.gold.writer("cases", Refresh()), gold_cases, name="write-gold-cases")

    # --- products: silver ---------------------------------------------------
    prods = read(med.raw.reader(NAMESPACE), name="read-raw-products")
    prods = transform(this_run, prods, name="filter-products")
    prods = transform(normalise, prods, name="normalise-products")
    prods = transform(
        SelectColumns(["case_ref"] + PRODUCT_COLS), prods, name="select-products"
    )
    write(
        med.silver.writer("case_products", strategy),
        prods,
        name="write-silver-products",
    )

    # --- products: gold, wide -> long, linked by case_id --------------------
    # The *same* namespace and natural key as the Cases reduction above, so
    # product rows carry matching case_ids without joining back to Cases gold.
    gold_prods = read(med.silver.reader("case_products"), name="read-silver-products")
    gold_prods = transform(
        DeriveKey(
            into=CASE_ID_COLUMN, namespace=NAMESPACE, natural_key=list(NATURAL_KEY)
        ),
        gold_prods,
        name="derive-key-products",
    )
    gold_prods = transform(
        Unpivot(
            id_vars=[CASE_ID_COLUMN],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
        gold_prods,
        name="unpivot",
    )
    write(
        med.gold.writer("case_products", Refresh()),
        gold_prods,
        name="write-gold-products",
    )

    cases_gold = med.gold.reader("cases").read()
    products_gold = med.gold.reader("case_products").read()
    print(
        f"cases gold: {len(cases_gold)} rows | "
        f"case_products gold: {len(products_gold)} rows (run {RUN_ID})"
    )


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m pipelines.demo_fan_out <target_dir>")
    main(sys.argv[1])
