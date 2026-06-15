"""Comprehensive example: multiple sources -> silver, then silver -> gold.

The package follows the scaffold style: schemas live in ``schema.py``,
business rules in ``rules.py``, pipeline-local processors in ``processors.py``,
and bundled fixtures in ``sample_data/``.

Run from the repo root:

    python -m pipelines.comprehensive_examples /tmp/comprehensive-demo
"""

from __future__ import annotations

import os
from pathlib import Path

from framework.io import (
    GOLD,
    RAW,
    SILVER,
    AccumulateByRun,
    CsvReader,
    Refresh,
    StoreCatalog,
)
from framework.run import Pipeline
from framework.transform import (
    Filter,
    JoinDependency,
    JoinWith,
    SchemaCoercion,
    SchemaValidator,
    Score,
    SelectColumns,
    Sort,
)
from framework.validate import ColumnValidator, UniqueValidator

from .processors import AddOpenContactCounts, AdviserSummary
from .rules import high_risk_or_vulnerable, review_priority
from .schema import AdviserReference, CaseSnapshot, OpenContact

CASE_SUBJECT = "complex_cases"
ADVISER_SUBJECT = "adviser_reference"
REPORTING_SUBJECT = "complex_reporting"
SAMPLE_DIR = Path(__file__).parent / "sample_data"
RUN_ID = "2026-05-29"


def bronze_to_silver(base_dir: str | os.PathLike[str], *, run_id: str = RUN_ID) -> None:
    """Land multiple bronze feeds, then validate and join them into silver."""
    catalog = StoreCatalog(base_dir)
    case_store = catalog.store(CASE_SUBJECT)
    adviser_store = catalog.store(ADVISER_SUBJECT)

    _land_raw(case_store, "cases", SAMPLE_DIR / "cases.csv")
    _land_raw(case_store, "accounts", SAMPLE_DIR / "accounts.csv")
    _land_raw(case_store, "contacts", SAMPLE_DIR / "contacts.csv")
    _land_raw(adviser_store, "advisers", SAMPLE_DIR / "advisers.csv")

    (
        Pipeline("advisers-raw-to-silver", adviser_store.reader(RAW, "advisers"))
        .with_validator(ColumnValidator(["adviser_id", "region", "team"]))
        .with_processor(SchemaCoercion(AdviserReference))
        .with_post_validator(SchemaValidator(AdviserReference))
        .with_post_validator(UniqueValidator("adviser_id"))
        .write_to(adviser_store.writer(SILVER, "advisers", Refresh()))
        .run()
    )

    (
        Pipeline("open-contacts-raw-to-silver", case_store.reader(RAW, "contacts"))
        .with_validator(ColumnValidator(["case_ref", "contact_status"]))
        .with_processor(Filter(lambda row: row["contact_status"] == "open"))
        .with_processor(
            SelectColumns(
                ["case_ref", "contact_date", "contact_type", "contact_status"]
            )
        )
        .with_processor(SchemaCoercion(OpenContact))
        .with_post_validator(SchemaValidator(OpenContact))
        .write_to(case_store.writer(SILVER, "open_contacts", Refresh()))
        .run()
    )

    accounts = JoinDependency("accounts", case_store.reader(RAW, "accounts"))
    advisers = JoinDependency("advisers", adviser_store.reader(SILVER, "advisers"))
    (
        Pipeline("case-snapshot-raw-to-silver", case_store.reader(RAW, "cases"))
        .with_validator(ColumnValidator(["case_ref", "customer_id", "adviser_id"]))
        .with_processor(JoinWith(accounts, on="customer_id", how="inner"))
        .with_processor(JoinWith(advisers, on="adviser_id", how="inner"))
        .with_processor(
            AddOpenContactCounts(case_store.reader(SILVER, "open_contacts"))
        )
        .with_processor(SchemaCoercion(CaseSnapshot))
        .with_post_validator(SchemaValidator(CaseSnapshot))
        .with_post_validator(UniqueValidator("case_ref"))
        .write_to(case_store.writer(SILVER, "case_snapshot", Refresh()))
        .run()
    )


def silver_to_gold(base_dir: str | os.PathLike[str], *, run_id: str = RUN_ID) -> None:
    """Assemble silver case data into separate gold consumption tables."""
    catalog = StoreCatalog(base_dir)
    source_store = catalog.store(CASE_SUBJECT)
    reporting_store = catalog.store(REPORTING_SUBJECT)
    strategy = AccumulateByRun(run_id=run_id, load_date=run_id)

    (
        Pipeline(
            "review-queue-silver-to-gold", source_store.reader(SILVER, "case_snapshot")
        )
        .with_processor(Score("review_priority", review_priority))
        .with_processor(Filter(high_risk_or_vulnerable, name="high-risk-or-vulnerable"))
        .with_processor(Sort("review_priority", ascending=False))
        .write_to(reporting_store.writer(GOLD, "review_queue", strategy))
        .run()
    )

    (
        Pipeline(
            "adviser-summary-silver-to-gold",
            source_store.reader(SILVER, "case_snapshot"),
        )
        .with_processor(AdviserSummary())
        .write_to(reporting_store.writer(GOLD, "adviser_summary", strategy))
        .run()
    )


def _land_raw(store, table: str, path: Path) -> None:
    Pipeline(f"{table}-source-to-raw", CsvReader(path)).write_to(
        store.writer(RAW, table, Refresh())
    ).run()


def main(argv: list[str]) -> int:
    target_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    bronze_to_silver(target_dir)
    silver_to_gold(target_dir)
    print(f"comprehensive examples wrote bronze, silver, and gold under {target_dir}")
    return 0
