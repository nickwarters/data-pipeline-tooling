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

from framework.core import GOLD, RAW, SILVER
from framework.io import AccumulateByRun, CsvReader, Refresh, StoreCatalog
from framework.run import Pipeline
from framework.transform import (
    Filter,
    JoinDependency,
    JoinWith,
    SchemaCoercion,
    Score,
    SelectColumns,
    Sort,
)
from framework.validate import ColumnValidator, SchemaValidator, UniqueValidator

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

    p_adv = Pipeline("advisers-raw-to-silver")
    r_adv = p_adv.read(adviser_store.reader(RAW, "advisers"), name="read")
    v1_adv = p_adv.validate(ColumnValidator(["adviser_id", "region", "team"]), r_adv, name="val-cols")
    c_adv = p_adv.transform(SchemaCoercion(AdviserReference), v1_adv, name="coerce")
    v2_adv = p_adv.validate(SchemaValidator(AdviserReference), c_adv, name="val-schema")
    v3_adv = p_adv.validate(UniqueValidator("adviser_id"), v2_adv, name="val-unique")
    w_adv = p_adv.write(adviser_store.writer(SILVER, "advisers", Refresh()), v3_adv, name="write")
    p_adv.run()

    p_con = Pipeline("open-contacts-raw-to-silver")
    r_con = p_con.read(case_store.reader(RAW, "contacts"), name="read")
    v1_con = p_con.validate(ColumnValidator(["case_ref", "contact_status"]), r_con, name="val-cols")
    f_con = p_con.transform(Filter(lambda row: row["contact_status"] == "open"), v1_con, name="filter")
    s_con = p_con.transform(SelectColumns(["case_ref", "contact_date", "contact_type", "contact_status"]), f_con, name="select")
    c_con = p_con.transform(SchemaCoercion(OpenContact), s_con, name="coerce")
    v2_con = p_con.validate(SchemaValidator(OpenContact), c_con, name="val-schema")
    w_con = p_con.write(case_store.writer(SILVER, "open_contacts", Refresh()), v2_con, name="write")
    p_con.run()

    accounts = JoinDependency("accounts", case_store.reader(RAW, "accounts"))
    advisers = JoinDependency("advisers", adviser_store.reader(SILVER, "advisers"))
    p_snp = Pipeline("case-snapshot-raw-to-silver")
    r_snp = p_snp.read(case_store.reader(RAW, "cases"), name="read")
    v1_snp = p_snp.validate(ColumnValidator(["case_ref", "customer_id", "adviser_id"]), r_snp, name="val-cols")
    j1_snp = p_snp.transform(JoinWith(accounts, on="customer_id", how="inner"), v1_snp, name="join-accounts")
    j2_snp = p_snp.transform(JoinWith(advisers, on="adviser_id", how="inner"), j1_snp, name="join-advisers")
    a_snp = p_snp.transform(AddOpenContactCounts(case_store.reader(SILVER, "open_contacts")), j2_snp, name="add-counts")
    c_snp = p_snp.transform(SchemaCoercion(CaseSnapshot), a_snp, name="coerce")
    v2_snp = p_snp.validate(SchemaValidator(CaseSnapshot), c_snp, name="val-schema")
    v3_snp = p_snp.validate(UniqueValidator("case_ref"), v2_snp, name="val-unique")
    w_snp = p_snp.write(case_store.writer(SILVER, "case_snapshot", Refresh()), v3_snp, name="write")
    p_snp.run()


def silver_to_gold(base_dir: str | os.PathLike[str], *, run_id: str = RUN_ID) -> None:
    """Assemble silver case data into separate gold consumption tables."""
    catalog = StoreCatalog(base_dir)
    source_store = catalog.store(CASE_SUBJECT)
    reporting_store = catalog.store(REPORTING_SUBJECT)
    strategy = AccumulateByRun(run_id=run_id, load_date=run_id)

    p_rq = Pipeline("review-queue-silver-to-gold")
    r_rq = p_rq.read(source_store.reader(SILVER, "case_snapshot"), name="read")
    s_rq = p_rq.transform(Score("review_priority", review_priority), r_rq, name="score")
    f_rq = p_rq.transform(Filter(high_risk_or_vulnerable, name="high-risk-or-vulnerable"), s_rq, name="filter")
    so_rq = p_rq.transform(Sort("review_priority", ascending=False), f_rq, name="sort")
    w_rq = p_rq.write(reporting_store.writer(GOLD, "review_queue", strategy), so_rq, name="write")
    p_rq.run()

    p_as = Pipeline("adviser-summary-silver-to-gold")
    r_as = p_as.read(source_store.reader(SILVER, "case_snapshot"), name="read")
    a_as = p_as.transform(AdviserSummary(), r_as, name="summary")
    w_as = p_as.write(reporting_store.writer(GOLD, "adviser_summary", strategy), a_as, name="write")
    p_as.run()


def _land_raw(store, table: str, path: Path) -> None:
    p = Pipeline(f"{table}-source-to-raw")
    r = p.read(CsvReader(path), name="read")
    w = p.write(store.writer(RAW, table, Refresh()), r, name="write")
    p.run()


def main(argv: list[str]) -> int:
    target_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    bronze_to_silver(target_dir)
    silver_to_gold(target_dir)
    print(f"comprehensive examples wrote bronze, silver, and gold under {target_dir}")
    return 0
