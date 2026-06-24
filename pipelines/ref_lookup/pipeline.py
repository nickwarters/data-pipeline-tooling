"""Reference lookup pipeline.

Demonstrates a three-step silver pattern:

1. **raw** — land the source CSV faithfully.
2. **ref** — unpivot the category and attribute fields into a tall
   (ref_group, value) lookup table, deduplicate, and stamp each pair with a
   stable MD5-derived id.
3. **cases** — map the ref ids back onto the source rows, then project only
   the refs and id columns (no raw category strings).
4. **customers** — project distinct customer refs.

Run from the repo root::

    python -m pipelines.ref_lookup /tmp/ref-lookup-demo
"""

from __future__ import annotations

import sys
from pathlib import Path

from framework.core import (
    RAW,
    SILVER,
    ColumnValidator,
    Dataset,
)
from framework.io import AccumulateByRun, CsvReader, Refresh, StoreCatalog
from framework.run import Pipeline, RunContext
from framework.transform import SelectColumns, Unpivot, VectorizedDerive

from .processors import (
    REF_FIELDS,
    SOURCE_COLUMNS,
    MapRefIds,
    dedup,
    dedup_ref,
    derive_ref_id,
)

FEED_NAME = "ref_lookup"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "source.csv"

CASES_COLUMNS = [
    "case_ref",
    "cust_ref",
    "brand_id",
    "channel_id",
    "case_cat_1_id",
    "case_cat_2_id",
    "case_cat_3_id",
]


def run(
    context: RunContext,
    *,
    source_csv: Path = SAMPLE_CSV,
) -> Dataset:
    """Wire readers/writers for the environment and execute all three hops."""
    assert context.base_dir is not None, "RunContext.base_dir is required"
    store = StoreCatalog(context.base_dir).store(FEED_NAME)
    csv_path = source_csv

    # 1. Land raw
    p_raw = Pipeline(f"{FEED_NAME}:raw")
    r_raw = p_raw.read(CsvReader(csv_path), name="read")
    v_raw = p_raw.validate(ColumnValidator(SOURCE_COLUMNS), r_raw, name="columns")
    p_raw.write(
        store.writer(RAW, "source", AccumulateByRun.from_context(context)),
        v_raw,
        name="write",
    )
    p_raw.run()

    # 2. Build ref (tall lookup table: one deduplicated row per (ref_group, value) pair)
    p_ref = Pipeline(f"{FEED_NAME}:silver:ref")
    r_ref = p_ref.read(store.reader(RAW, "source"), name="read")
    unpivoted = p_ref.transform(
        Unpivot(
            id_vars=[],
            value_vars=REF_FIELDS,
            var_name="ref_group",
            value_name="value",
        ),
        r_ref,
        name="unpivot",
    )
    selected = p_ref.transform(
        SelectColumns(["ref_group", "value"]), unpivoted, name="select"
    )
    deduped = p_ref.transform(dedup_ref, selected, name="dedup")
    hashed = p_ref.transform(
        VectorizedDerive("id", derive_ref_id), deduped, name="hash"
    )
    p_ref.write(store.writer(SILVER, "ref", Refresh()), hashed, name="write")
    ref_dataset: Dataset = p_ref.run()  # type: ignore[assignment]

    # 3. Build cases (map ref ids back; keep only refs and id columns)
    p_cases = Pipeline(f"{FEED_NAME}:silver:cases")
    r_cases = p_cases.read(store.reader(RAW, "source"), name="read")
    mapped = p_cases.transform(
        MapRefIds(ref_dataset, REF_FIELDS), r_cases, name="map-ids"
    )
    s_cases = p_cases.transform(SelectColumns(CASES_COLUMNS), mapped, name="select")
    p_cases.write(store.writer(SILVER, "cases", Refresh()), s_cases, name="write")
    p_cases.run()

    # 4. Build customers (distinct cust_ref)
    p_cust = Pipeline(f"{FEED_NAME}:silver:customers")
    r_cust = p_cust.read(store.reader(RAW, "source"), name="read")
    s_cust = p_cust.transform(SelectColumns(["cust_ref"]), r_cust, name="select")
    d_cust = p_cust.transform(dedup, s_cust, name="dedup")
    p_cust.write(store.writer(SILVER, "customers", Refresh()), d_cust, name="write")
    customers: Dataset = p_cust.run()  # type: ignore[assignment]

    return customers


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: python -m pipelines.ref_lookup <target_dir>", file=sys.stderr)
        return 1
    base_dir = Path(argv[1])
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    result = run(context, source_csv=SAMPLE_CSV)
    print(f"done — {len(result)} distinct customers")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv))
