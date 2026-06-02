"""Fan-out demo: one wide feed → Cases table + Detail Table (issue #39, ADR-0009).

Shows how a single wide ingest feed is fanned into two independent single-table
pipelines over the shared raw table:

1. **Raw** — the wide CSV lands in one shared raw table, stamped with
   ``run_id`` / ``load_date``.
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
import uuid
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from framework.builder import Pipeline
from framework.gold import detail_ingest_silver_to_gold, ingest_silver_to_gold
from framework.processors import Filter, Rename, SelectColumns, Unpivot
from framework.readers import CsvReader
from framework.schema import SchemaCoercion, SchemaValidator
from framework.store import Store
from framework.strategy import AccumulateByRun

PRODUCT_COLS = [f"product_{i}" for i in range(1, 11)]


@dataclass
class CaseSchema:
    """Case columns projected from the wide feed."""

    case_ref: str
    adviser: str
    activity_date: date
    amount: int


SUBJECT = "wide_cases"
CASE_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, SUBJECT)
RUN_ID = "2026-05-29"


def main(target_dir: str) -> None:
    sample = Path(__file__).parent / "sample_data" / "wide_cases.csv"
    store = Store(Path(target_dir) / SUBJECT)

    # 1. Land the wide CSV into a shared raw table (all columns, accumulated).
    Pipeline(SUBJECT, CsvReader(sample)).write_to(
        store.writer("raw", SUBJECT, AccumulateByRun(RUN_ID, RUN_ID))
    ).run()

    # Shared normalisation: the feed uses `case_ref_no`; both pipelines rename
    # it to the canonical `case_ref` (defined once, reused below).
    normalise = Rename({"case_ref_no": "case_ref"})

    # 2a. Cases pipeline: raw → silver (case columns only).
    (
        Pipeline("cases", store.reader("raw", SUBJECT))
        .with_processor(Filter(lambda row, rid=RUN_ID: row["run_id"] == rid))
        .with_processor(normalise)
        .with_processor(SelectColumns(["case_ref", "adviser", "activity_date", "amount"]))
        .with_processor(SchemaCoercion(CaseSchema))
        .with_post_validator(SchemaValidator(CaseSchema))
        .write_to(store.writer("silver", "cases", AccumulateByRun(RUN_ID, RUN_ID)))
        .run()
    )

    # 2b. Cases gold: DeriveKey → LatestPerKey → UniqueValidator → Refresh.
    ingest_silver_to_gold(
        store, "cases", namespace=CASE_NAMESPACE, natural_key=["case_ref"]
    ).run()

    # 3a. Products pipeline: raw → silver (product columns + natural key only).
    (
        Pipeline("case_products", store.reader("raw", SUBJECT))
        .with_processor(Filter(lambda row, rid=RUN_ID: row["run_id"] == rid))
        .with_processor(normalise)
        .with_processor(SelectColumns(["case_ref"] + PRODUCT_COLS))
        .write_to(store.writer("silver", "case_products", AccumulateByRun(RUN_ID, RUN_ID)))
        .run()
    )

    # 3b. Products gold: DeriveKey (same namespace+key as cases) → Unpivot → Refresh.
    detail_ingest_silver_to_gold(
        store,
        "case_products",
        namespace=CASE_NAMESPACE,
        natural_key=["case_ref"],
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    cases_gold = store.reader("gold", "cases").read()
    products_gold = store.reader("gold", "case_products").read()
    print(
        f"cases gold: {len(cases_gold)} rows | "
        f"case_products gold: {len(products_gold)} rows (run {RUN_ID})"
    )


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: python -m pipelines.demo_fan_out <target_dir>"
        )
    main(sys.argv[1])
