"""Tests for the ref_lookup pipeline.

The pipeline builds three silver tables from a wide source CSV:
- ``ref``: deduplicated (ref_group, value) pairs with stable MD5 ids.
- ``cases``: one row per case, carrying only refs and ref-table ids.
- ``customers``: distinct customer refs.
"""

from __future__ import annotations

import math

from framework.core import SILVER
from framework.io import StoreCatalog
from framework.run import RunContext
from pipelines.ref_lookup.pipeline import FEED_NAME, SAMPLE_CSV, run
from tests.framework_testing import read_rows


def test_run_produces_ref_cases_customers_silver(tmp_path):
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    store = StoreCatalog(tmp_path).store(FEED_NAME)

    ref = read_rows(store, SILVER, "ref")
    cases = read_rows(store, SILVER, "cases")
    customers = read_rows(store, SILVER, "customers")

    # ref: unique (ref_group, value) pairs from brand, channel, case_cat_*
    ref_pairs = {(r["ref_group"], r["value"]) for r in ref}
    assert ("brand", "Brand A") in ref_pairs
    assert ("brand", "Brand B") in ref_pairs
    assert ("channel", "Web") in ref_pairs
    assert ("channel", "Phone") in ref_pairs
    assert ("channel", "Email") in ref_pairs
    assert ("case_cat_1", "Motor") in ref_pairs
    assert ("case_cat_1", "Home") in ref_pairs
    assert ("case_cat_1", "Life") in ref_pairs

    # no duplicate pairs
    assert len(ref_pairs) == len(ref)

    # each ref row carries a 32-char MD5 hex id
    assert all(len(r["id"]) == 32 for r in ref)

    # same (ref_group, value) pair always gets the same id
    brand_a_rows = [
        r for r in ref if r["ref_group"] == "brand" and r["value"] == "Brand A"
    ]
    assert len(brand_a_rows) == 1
    brand_a_id = brand_a_rows[0]["id"]

    # cases: one row per source case_ref
    case_refs = {r["case_ref"] for r in cases}
    assert case_refs == {"CR001", "CR002", "CR003", "CR004", "CR005", "CR006"}

    # cases carry cust_ref and id columns, not raw category strings
    case_cols = set(cases[0].keys())
    assert "case_ref" in case_cols
    assert "cust_ref" in case_cols
    assert "brand_id" in case_cols
    assert "channel_id" in case_cols
    assert "case_cat_1_id" in case_cols
    assert "brand" not in case_cols
    assert "channel" not in case_cols

    # Brand A rows get the same brand_id
    brand_a_cases = [r for r in cases if r["cust_ref"] == "CUST01"]
    assert all(r["brand_id"] == brand_a_id for r in brand_a_cases)

    # rows with empty case_cat_2 / case_cat_3 get a missing value for those id columns
    # (NaN from the left join, which round-trips through SQLite as NaN or None)
    cr005 = next(r for r in cases if r["case_ref"] == "CR005")
    assert cr005["case_cat_1_id"] is not None
    assert cr005["case_cat_2_id"] is None or (
        isinstance(cr005["case_cat_2_id"], float) and math.isnan(cr005["case_cat_2_id"])
    )

    # customers: distinct cust_ref only
    cust_refs = {r["cust_ref"] for r in customers}
    assert cust_refs == {"CUST01", "CUST02", "CUST03", "CUST04"}
    assert len(customers) == 4
    assert all(list(r.keys()) == ["cust_ref"] for r in customers)


def test_run_uses_bundled_sample_by_default(tmp_path):
    result = run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))
    assert len(result) > 0


def test_ref_ids_are_stable_across_runs(tmp_path):
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))
    store = StoreCatalog(tmp_path).store(FEED_NAME)
    first_ref = {
        (r["ref_group"], r["value"]): r["id"] for r in read_rows(store, SILVER, "ref")
    }

    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))
    second_ref = {
        (r["ref_group"], r["value"]): r["id"] for r in read_rows(store, SILVER, "ref")
    }

    assert first_ref == second_ref


def test_custom_source_csv(tmp_path):
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), source_csv=SAMPLE_CSV)
    store = StoreCatalog(tmp_path).store(FEED_NAME)
    cases = read_rows(store, SILVER, "cases")
    assert len(cases) == 6
