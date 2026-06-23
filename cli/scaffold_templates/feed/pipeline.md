```python
"""Ingest pipeline for the ``myfeed`` feed: source -> raw -> silver -> gold.

Each medallion hop is its own ``*_builder`` -- a single, editable definition of
what that hop does, composed through the public facades (``framework.io`` /
``framework.transform`` / ``framework.validate`` / ``framework.run``). ``run``
orchestrates the three in order; tests call a builder directly with sample rows
and a recording writer, so the first test drives the actual hop rather than a
rebuild of it.

- ``raw_builder``   reads the source and lands it faithfully (column-gated).
- ``silver_builder`` renames source columns, coerces dtypes, and validates.
- ``gold_builder``  assembles silver into gold -- a passthrough to start; the
  assembly is yours to build (see the TODO and #163).

Address it by its location on disk -- the framework imports
``pipelines.myfeed.pipeline`` and runs its ``run(context)`` callable::

    python -m cli run pipelines/myfeed [BASE_DIR]

or run the module directly with a default run context::

    python -m pipelines.myfeed.pipeline [BASE_DIR]

Both run from the repo root so the import-only ``framework`` package resolves on
``sys.path``.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import fields
from pathlib import Path

from framework.core import (
    GOLD,
    RAW,
    SILVER,
    ColumnValidator,
    Dataset,
    PipelineError,
    SchemaValidator,
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
from framework.transform import SchemaCoercion, SchemaValueRulePartitioner

from .schema import MyfeedRow

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"

# Source columns whose names differ from the schema's fields, mapped to the
# canonical field names. raw keeps the source names faithfully; silver renames
# them to the schema's vocabulary. Empty when the source already uses identifiers.
RENAME: dict[str, str] = {}

# Pipelines this feed depends on being fresh before it runs (a tuple of
# ``framework.run.FreshnessRequirement``). A source feed has none.
UPSTREAMS = ()


def raw_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the raw hop: faithful landing zone."""
    p = Pipeline(f"{FEED_NAME}:raw", run_log=run_log)
    r = p.read(reader, name="read")

    # Gate the source's expected columns before landing
    v = p.validate(
        ColumnValidator([f.name for f in fields(MyfeedRow)]), r, name="raw_col_validate"
    )
    p.write(writer, v, name="write_raw")
    return p


def silver_builder(
    reader: Reader,
    writer: Writer,
    reject_writer: Writer | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the silver hop: schema coercion and enforcement + quarantine."""
    p = Pipeline(f"{FEED_NAME}:silver", run_log=run_log)
    r = p.read(reader, name="read")

    def rename_columns(dataset: Dataset) -> Dataset:
        if RENAME:
            return Dataset(dataset.to_pandas().rename(columns=RENAME))
        return dataset

    renamed = p.transform(rename_columns, r, name="silver_rename")
    coerced = p.transform(SchemaCoercion(MyfeedRow), renamed, name="coerce")

    if reject_writer:
        quarantined = p.quarantine(
            SchemaValueRulePartitioner(MyfeedRow),
            reject_writer,
            coerced,
            name="quarantine",
        )
    else:
        quarantined = coerced

    validated = p.validate(
        SchemaValidator(MyfeedRow), quarantined, name="post-validate"
    )
    p.write(writer, validated, name="write_silver")
    return p


def gold_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the gold hop: assemble silver into gold."""
    p = Pipeline(f"{FEED_NAME}:gold", run_log=run_log)
    r = p.read(reader, name="read")

    def assemble_gold(dataset: Dataset) -> Dataset:
        # TODO: build out the gold assembly (e.g. derive a stable key, reduce, join)
        return dataset

    assembled = p.transform(assemble_gold, r, name="gold_transform")
    p.write(writer, assembled, name="write_gold")
    return p


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Refine the feed source -> raw -> silver -> gold under the run context."""
    store = StoreCatalog(context.base_dir).store(FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    raw_p = raw_builder(
        reader=CsvReader(SAMPLE_CSV),
        writer=store.writer(RAW, FEED_NAME, strategy),
        run_log=context.run_log,
    )
    if describe:
        print(raw_p.describe())
    raw_p.run()

    silver_p = silver_builder(
        reader=store.reader(RAW, FEED_NAME),
        writer=store.writer(SILVER, FEED_NAME, strategy),
        reject_writer=store.quarantine_writer(FEED_NAME),
        run_log=context.run_log,
    )
    if describe:
        print(silver_p.describe())
    silver_p.run()

    gold_p = gold_builder(
        reader=store.reader(SILVER, FEED_NAME),
        writer=store.writer(GOLD, FEED_NAME, Refresh()),
        run_log=context.run_log,
    )
    if describe:
        print(gold_p.describe())
    gold = gold_p.run()

    return gold


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.myfeed.pipeline",
        description="Refine the myfeed feed source -> raw -> silver -> gold.",
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
        subject="",
        pipeline=FEED_NAME,
        handler=handler,
        freshness=UPSTREAMS,
    )

    try:
        result = runner.run("", FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    rows = len(result) if isinstance(result, Dataset) else 0
    print(
        f"Refined {rows} rows source -> raw -> silver -> gold "
        f"under {base_dir / FEED_NAME}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
