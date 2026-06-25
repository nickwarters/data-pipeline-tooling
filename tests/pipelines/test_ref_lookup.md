```python
"""Tests for the ``ref_lookup`` pipeline.

Builder tests are purely in-memory: ``given_rows`` / ``make_dataset`` as the
source, ``RecordingWriter`` as the sink. No SQLite, no temp dirs, no disk I/O.

Only ``test_bundled_sample_run`` wires the real store and touches the filesystem.
"""

from __future__ import annotations

import math

import pytest

from framework.core import SILVER, ValidationError
from framework.io import StoreCatalog
from framework.run import RunContext
from pipelines.ref_lookup.pipeline import (
    FEED_NAME,
    cases_builder,
    customers_builder,
    raw_builder,
    ref_builder,
    run,
)
from tests.framework_testing import (
    RecordingWriter,
    given_rows,
    make_dataset,
    read_rows,
    rows_of,
)

# ---------------------------------------------------------------------------
# raw_builder
# ---------------------------------------------------------------------------


def test_raw_builder_lands_source_rows():
    writer = RecordingWriter()
    reader = given_rows(
        [
            {
                "brand": "A",
                "channel": "Web",
                "case_ref": "CR1",
                "cust_ref": "C1",
                "case_cat_1": "Motor",
                "case_cat_2": "Claims",
                "case_cat_3": "",
            }
        ]
    )
    raw_builder(reader, writer).run()
    assert len(writer.writes) == 1
    assert len(rows_of(writer)) == 1


def test_raw_builder_gates_source_columns():
    writer = RecordingWriter()
    reader = given_rows([{"brand": "A", "channel": "Web"}])  # missing required columns
    with pytest.raises(ValidationError, match="missing required column"):
        raw_builder(reader, writer).run()
    assert len(writer.writes) == 0


# ---------------------------------------------------------------------------
# ref_builder
# ---------------------------------------------------------------------------

SOURCE_ROWS = [
    {
        "brand": "Brand A",
        "channel": "Web",
        "case_ref": "CR1",
        "cust_ref": "C1",
        "case_cat_1": "Motor",
        "case_cat_2": "Claims",
        "case_cat_3": "Fraud",
        "run_id": "1",
    },
    {
        "brand": "Brand B",
        "channel": "Phone",
        "case_ref": "CR2",
        "cust_ref": "C2",
        "case_cat_1": "Home",
        "case_cat_2": "Service",
        "case_cat_3": "",
        "run_id": "1",
    },
    {
        "brand": "Brand A",
        "channel": "Web",
        "case_ref": "CR3",
        "cust_ref": "C1",
        "case_cat_1": "Motor",
        "case_cat_2": "Claims",
        "case_cat_3": "Fraud",
        "run_id": "1",
    },
]


def test_ref_builder_produces_unique_group_value_pairs():
    writer = RecordingWriter()
    ref_builder(given_rows(SOURCE_ROWS), writer).run()

    ref = rows_of(writer)
    pairs = {(r["ref_group"], r["value"]) for r in ref}

    assert ("brand", "Brand A") in pairs
    assert ("brand", "Brand B") in pairs
    assert ("channel", "Web") in pairs
    assert ("channel", "Phone") in pairs
    assert ("case_cat_1", "Motor") in pairs
    assert ("case_cat_1", "Home") in pairs

    # deduplication: each pair appears exactly once
    assert len(pairs) == len(ref)


def test_ref_builder_drops_empty_values():
    writer = RecordingWriter()
    ref_builder(given_rows(SOURCE_ROWS), writer).run()
    ref = rows_of(writer)
    # case_cat_3 is empty for Brand B row — should not appear in ref
    cat3_pairs = [r for r in ref if r["ref_group"] == "case_cat_3"]
    assert all(r["value"] != "" for r in cat3_pairs)


def test_ref_builder_stamps_32_char_md5_id():
    writer = RecordingWriter()
    ref_builder(given_rows(SOURCE_ROWS), writer).run()
    ref = rows_of(writer)
    assert all(len(r["id"]) == 32 for r in ref)


def test_ref_builder_id_is_stable_for_same_pair():
    writer_a = RecordingWriter()
    writer_b = RecordingWriter()
    ref_builder(given_rows(SOURCE_ROWS), writer_a).run()
    ref_builder(given_rows(SOURCE_ROWS), writer_b).run()

    ids_a = {(r["ref_group"], r["value"]): r["id"] for r in rows_of(writer_a)}
    ids_b = {(r["ref_group"], r["value"]): r["id"] for r in rows_of(writer_b)}
    assert ids_a == ids_b


# ---------------------------------------------------------------------------
# cases_builder
# ---------------------------------------------------------------------------

REF_ROWS = [
    {"id": "aaa111", "ref_group": "brand", "value": "Brand A"},
    {"id": "bbb222", "ref_group": "brand", "value": "Brand B"},
    {"id": "ccc333", "ref_group": "channel", "value": "Web"},
    {"id": "ddd444", "ref_group": "channel", "value": "Phone"},
    {"id": "eee555", "ref_group": "case_cat_1", "value": "Motor"},
    {"id": "fff666", "ref_group": "case_cat_1", "value": "Home"},
    {"id": "ggg777", "ref_group": "case_cat_2", "value": "Claims"},
    {"id": "hhh888", "ref_group": "case_cat_2", "value": "Service"},
    {"id": "iii999", "ref_group": "case_cat_3", "value": "Fraud"},
]


def test_cases_builder_maps_ids_and_projects_narrow_columns():
    writer = RecordingWriter()
    ref = make_dataset(REF_ROWS)
    cases_builder(given_rows(SOURCE_ROWS), ref, writer).run()

    cases = rows_of(writer)
    cols = set(cases[0].keys())

    # id columns present
    assert {
        "case_ref",
        "cust_ref",
        "brand_id",
        "channel_id",
        "case_cat_1_id",
        "case_cat_2_id",
        "case_cat_3_id",
    }.issubset(cols)

    # raw category strings absent
    assert "brand" not in cols
    assert "channel" not in cols
    assert "case_cat_1" not in cols

    # Brand A rows carry the expected id
    brand_a_cases = [r for r in cases if r["case_ref"] in ("CR1", "CR3")]
    assert all(r["brand_id"] == "aaa111" for r in brand_a_cases)


def test_cases_builder_nulls_id_when_category_is_empty():
    writer = RecordingWriter()
    ref = make_dataset(REF_ROWS)
    cases_builder(given_rows(SOURCE_ROWS), ref, writer).run()

    cases = rows_of(writer)
    cr2 = next(r for r in cases if r["case_ref"] == "CR2")

    # CR2 has no case_cat_3 value → its case_cat_3_id should be missing
    assert cr2["case_cat_3_id"] is None or (
        isinstance(cr2["case_cat_3_id"], float) and math.isnan(cr2["case_cat_3_id"])
    )


# ---------------------------------------------------------------------------
# customers_builder
# ---------------------------------------------------------------------------


def test_customers_builder_returns_distinct_cust_refs():
    writer = RecordingWriter()
    customers_builder(given_rows(SOURCE_ROWS), writer).run()

    customers = rows_of(writer)
    cust_refs = [r["cust_ref"] for r in customers]

    # SOURCE_ROWS has C1 appearing twice; only one row per customer
    assert sorted(cust_refs) == ["C1", "C2"]
    assert all(list(r.keys()) == ["cust_ref"] for r in customers)


# ---------------------------------------------------------------------------
# full run (disk)
# ---------------------------------------------------------------------------


def test_bundled_sample_run(tmp_path):
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    store = StoreCatalog(tmp_path).store(FEED_NAME)

    ref = read_rows(store, SILVER, "ref")
    cases = read_rows(store, SILVER, "cases")
    customers = read_rows(store, SILVER, "customers")

    # ref: unique, id-stamped pairs from all five fields
    ref_pairs = {(r["ref_group"], r["value"]) for r in ref}
    assert ("brand", "Brand A") in ref_pairs
    assert ("case_cat_1", "Motor") in ref_pairs
    assert len(ref_pairs) == len(ref)
    assert all(len(r["id"]) == 32 for r in ref)

    # cases: one row per source case_ref, narrow shape
    assert {r["case_ref"] for r in cases} == {
        "CR001",
        "CR002",
        "CR003",
        "CR004",
        "CR005",
        "CR006",
    }
    assert "brand" not in cases[0]

    # customers: distinct only
    assert {r["cust_ref"] for r in customers} == {
        "CUST01",
        "CUST02",
        "CUST03",
        "CUST04",
    }
    assert len(customers) == 4

```
