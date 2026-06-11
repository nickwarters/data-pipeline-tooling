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
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from case_review.case_type import CaseType
from case_review.gold import detail_ingest_silver_to_gold, ingest_silver_to_gold
from framework.io import GOLD, RAW, SILVER, AccumulateByRun, CsvReader, StoreCatalog
from framework.run import Pipeline
from framework.transform import (
    Filter,
    Rename,
    SchemaCoercion,
    SchemaValidator,
    SelectColumns,
    Unpivot,
)

PRODUCT_COLS = [f"product_{i}" for i in range(1, 11)]


@dataclass
class CaseSchema:
    """Case columns projected from the wide feed."""

    case_ref: str
    adviser: str
    activity_date: date
    amount: int


SUBJECT = "wide_cases"
RUN_ID = "2026-05-29"

# One Case Type owns the identity contract for this wide feed; both the Cases
# pipeline and the Products Detail-Table pipeline read its namespace + natural
# key, so they derive the *same* case_id with no cross-pipeline join (ADR-0009).
WIDE_CASES = CaseType(name=SUBJECT, schema=CaseSchema, natural_key=("case_ref",))


def main(target_dir: str) -> None:
    sample = Path(__file__).parent / "sample_data" / "wide_cases.csv"
    store = StoreCatalog(target_dir).store(SUBJECT)

    # 1. Land the wide CSV into a shared raw table (all columns, accumulated).
    Pipeline(SUBJECT, CsvReader(sample)).write_to(
        store.writer(RAW, SUBJECT, AccumulateByRun(RUN_ID, RUN_ID))
    ).run()

    # Shared normalisation: the feed uses `case_ref_no`; both pipelines rename
    # it to the canonical `case_ref` (defined once, reused below).
    normalise = Rename({"case_ref_no": "case_ref"})

    # 2a. Cases pipeline: raw → silver (case columns only).
    (
        Pipeline("cases", store.reader(RAW, SUBJECT))
        .with_processor(Filter(lambda row, rid=RUN_ID: row["run_id"] == rid))
        .with_processor(normalise)
        .with_processor(SelectColumns(["case_ref", "adviser", "activity_date", "amount"]))
        .with_processor(SchemaCoercion(CaseSchema))
        .with_post_validator(SchemaValidator(CaseSchema))
        .write_to(store.writer(SILVER, "cases", AccumulateByRun(RUN_ID, RUN_ID)))
        .run()
    )

    # 2b. Cases gold: DeriveKey → LatestPerKey → UniqueValidator → Refresh.
    ingest_silver_to_gold(store, WIDE_CASES, "cases").run()

    # 3a. Products pipeline: raw → silver (product columns + natural key only).
    (
        Pipeline("case_products", store.reader(RAW, SUBJECT))
        .with_processor(Filter(lambda row, rid=RUN_ID: row["run_id"] == rid))
        .with_processor(normalise)
        .with_processor(SelectColumns(["case_ref"] + PRODUCT_COLS))
        .write_to(store.writer(SILVER, "case_products", AccumulateByRun(RUN_ID, RUN_ID)))
        .run()
    )

    # 3b. Products gold: DeriveKey → Unpivot → Refresh. Same WIDE_CASES Case Type
    #     as the Cases pipeline, so case_id matches without a cross-pipeline join.
    detail_ingest_silver_to_gold(
        store,
        WIDE_CASES,
        "case_products",
        unpivot=Unpivot(
            id_vars=["case_id"],
            value_vars=PRODUCT_COLS,
            var_name="product_slot",
            value_name="product_name",
        ),
    ).run()

    cases_gold = store.reader(GOLD, "cases").read()
    products_gold = store.reader(GOLD, "case_products").read()
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
