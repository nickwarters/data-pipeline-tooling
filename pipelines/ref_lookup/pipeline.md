```python
"""Reference lookup pipeline: source -> raw -> silver (ref, cases, customers).

Each medallion hop is its own ``*_builder`` — a single, editable definition of
what that hop does, injected with a ``Reader`` and ``Writer`` so it can be
tested purely in memory without touching the filesystem.

- ``raw_builder``       reads the source CSV and lands it faithfully (column-gated).
- ``ref_builder``       unpivots category/attribute fields into a tall (ref_group,
                        value) lookup table, deduplicates, and stamps each pair
                        with a stable MD5-derived id.
- ``cases_builder``     maps the ref ids back onto the source rows and projects
                        only the case/customer refs and id columns.
- ``customers_builder`` projects distinct customer refs.

``run`` wires the real readers/writers and executes all four hops in order.
Pass ``describe=True`` to print each pipeline's execution plan before running.

Run from the repo root::

    python -m cli run pipelines/ref_lookup [BASE_DIR]

or directly::

    python -m pipelines.ref_lookup.pipeline [BASE_DIR]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from framework.core import (
    ColumnValidator,
    Dataset,
    PipelineError,
    format_failure,
)
from framework.io import (
    AccumulateByRun,
    CsvReader,
    Reader,
    Refresh,
    StoreCatalog,
    Writer,
)
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import SelectColumns, Unpivot, VectorizedDerive
from tools.medallion import medallion

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
UPSTREAMS = ()

CASES_COLUMNS = [
    "case_ref",
    "cust_ref",
    "brand_id",
    "channel_id",
    "case_cat_1_id",
    "case_cat_2_id",
    "case_cat_3_id",
]


def raw_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the raw hop: faithful landing zone, column-gated."""
    p = Pipeline(f"{FEED_NAME}:raw", run_log=run_log)
    r = p.read(reader, name="read")
    v = p.validate(ColumnValidator(SOURCE_COLUMNS), r, name="col-validate")
    p.write(writer, v, name="write")
    return p


def ref_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the ref hop: unpivot -> dedup -> MD5 id -> write lookup table."""
    p = Pipeline(f"{FEED_NAME}:silver:ref", run_log=run_log)
    r = p.read(reader, name="read")
    unpivoted = p.transform(
        Unpivot(
            id_vars=[],
            value_vars=REF_FIELDS,
            var_name="ref_group",
            value_name="value",
        ),
        r,
        name="unpivot",
    )
    selected = p.transform(
        SelectColumns(["ref_group", "value"]), unpivoted, name="select"
    )
    deduped = p.transform(dedup_ref, selected, name="dedup")
    hashed = p.transform(VectorizedDerive("id", derive_ref_id), deduped, name="hash")
    p.write(writer, hashed, name="write")
    return p


def cases_builder(
    reader: Reader,
    ref: Dataset,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the cases hop: map ref ids back, project refs + id columns only.

    ``ref`` is a materialised ref dataset (already written by ``ref_builder``).
    """
    p = Pipeline(f"{FEED_NAME}:silver:cases", run_log=run_log)
    r = p.read(reader, name="read")
    mapped = p.transform(MapRefIds(ref, REF_FIELDS), r, name="map-ids")
    s = p.transform(SelectColumns(CASES_COLUMNS), mapped, name="select")
    p.write(writer, s, name="write")
    return p


def customers_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the customers hop: project and deduplicate distinct customer refs."""
    p = Pipeline(f"{FEED_NAME}:silver:customers", run_log=run_log)
    r = p.read(reader, name="read")
    s = p.transform(SelectColumns(["cust_ref"]), r, name="select")
    d = p.transform(dedup, s, name="dedup")
    p.write(writer, d, name="write")
    return p


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Wire real readers/writers and execute all four hops in order."""
    assert context.base_dir is not None, "RunContext.base_dir is required"
    med = medallion(StoreCatalog(context.base_dir), FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    raw_p = raw_builder(
        reader=CsvReader(SAMPLE_CSV),
        writer=med.raw.writer("source", strategy),
        run_log=context.run_log,
    )
    if describe:
        print(raw_p.describe())
    raw_p.run()

    ref_p = ref_builder(
        reader=med.raw.reader("source"),
        writer=med.silver.writer("ref", Refresh()),
        run_log=context.run_log,
    )
    if describe:
        print(ref_p.describe())
    ref_dataset: Dataset = ref_p.run()  # type: ignore[assignment]

    cases_p = cases_builder(
        reader=med.raw.reader("source"),
        ref=ref_dataset,
        writer=med.silver.writer("cases", Refresh()),
        run_log=context.run_log,
    )
    if describe:
        print(cases_p.describe())
    cases_p.run()

    customers_p = customers_builder(
        reader=med.raw.reader("source"),
        writer=med.silver.writer("customers", Refresh()),
        run_log=context.run_log,
    )
    if describe:
        print(customers_p.describe())
    customers: Dataset = customers_p.run()  # type: ignore[assignment]

    return customers


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.ref_lookup.pipeline",
        description="Refine source -> raw -> silver (ref, cases, customers).",
    )
    parser.add_argument(
        "base_dir",
        nargs="?",
        default=None,
        help="medallion root directory (default: ./data)",
    )
    parser.add_argument(
        "--describe",
        action="store_true",
        help="print each pipeline's plan before running it",
    )
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    from framework.run import PipelineRunner

    def handler(ctx: RunContext) -> Dataset:
        return run(ctx, describe=args.describe)

    runner = PipelineRunner()
    runner.register(
        subject="", pipeline=FEED_NAME, handler=handler, freshness=UPSTREAMS
    )

    try:
        result = runner.run("", FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    rows = len(result) if isinstance(result, Dataset) else 0
    print(f"Refined {rows} distinct customers under {base_dir / FEED_NAME}")
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
