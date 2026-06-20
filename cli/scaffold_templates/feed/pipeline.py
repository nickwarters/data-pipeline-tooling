"""Ingest pipeline for the ``myfeed`` feed: source -> raw -> silver -> gold.

Each medallion hop is its own ``*_builder`` -- a single, editable definition of
what that hop does, composed through the public facades (``framework.io`` /
``framework.transform`` / ``framework.validate`` / ``framework.run``). ``run``
orchestrates the three in order; tests call a builder directly with sample rows
and a recording writer, so the first test drives the actual hop rather than a
rebuild of it.

- ``raw_builder``   reads the source and lands it faithfully (column-gated).
- ``silver_builder`` renames source columns to the schema's vocabulary, coerces
  the dtypes storage loses, and validates the declared schema.
- ``gold_builder``  assembles silver into gold -- a passthrough to start; the
  assembly is yours to build (see the TODO and #163).

Address it by its location on disk -- the framework imports
``pipelines.myfeed.pipeline`` and runs its ``run(context)`` callable::

    python -m cli run pipelines/myfeed [BASE_DIR]

or run the module directly with a default run context::

    python -m pipelines.myfeed.pipeline [BASE_DIR]
    python -m pipelines.myfeed.pipeline [BASE_DIR] --describe   # print each plan

Both run from the repo root so the import-only ``framework`` package resolves on
``sys.path``.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import fields
from pathlib import Path

from framework.core import GOLD, RAW, SILVER, Dataset, PipelineError, format_failure
from framework.io import (
    AccumulateByRun,
    CsvReader,
    Refresh,
    StoreCatalog,
)
from framework.run import Pipeline, RunContext
from framework.validate import ColumnValidator, SchemaValidator

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


def build_pipeline(context: RunContext) -> Pipeline:
    store = StoreCatalog(context.base_dir).store(FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    # 1. Initialize the DAG Pipeline
    p = Pipeline(FEED_NAME, run_log=context.run_log)

    # -------------------------------------------------------------------------
    # RAW LAYER
    # Reads the source, gates it with a ColumnValidator, and writes a faithful copy.
    # -------------------------------------------------------------------------
    raw_source = p.read(CsvReader(SAMPLE_CSV), name="read_csv")
    
    raw_validated = p.validate(
        ColumnValidator([f.name for f in fields(MyfeedRow)]), 
        raw_source, 
        name="raw_col_validate"
    )
    
    raw_written = p.write(
        store.writer(RAW, FEED_NAME, strategy), 
        raw_validated, 
        name="write_raw"
    )

    # -------------------------------------------------------------------------
    # SILVER LAYER
    # Renames source columns, coerces dtypes, and validates schema.
    # We continue the graph from `raw_written` to avoid re-reading from disk.
    # -------------------------------------------------------------------------
    def rename_and_coerce(dataset: Dataset) -> Dataset:
        # Instead of generic processor classes, manipulate the data directly
        df = dataset.to_pandas()
        if RENAME:
            df = df.rename(columns=RENAME)
        # Assuming you have a helper for schema coercion or just use raw pandas:
        # df = coerce_to_schema(df, MyfeedRow)
        return Dataset(df)

    silver_transformed = p.transform(rename_and_coerce, raw_written, name="silver_transform")
    
    silver_validated = p.validate(
        SchemaValidator(MyfeedRow), 
        silver_transformed, 
        name="silver_schema_validate"
    )
    
    silver_written = p.write(
        store.writer(SILVER, FEED_NAME, strategy), 
        silver_validated, 
        name="write_silver"
    )

    # -------------------------------------------------------------------------
    # GOLD LAYER
    # A passthrough to start: reads silver and writes gold unchanged.
    # -------------------------------------------------------------------------
    def assemble_gold(dataset: Dataset) -> Dataset:
        # TODO: build out the gold assembly (e.g. derive a stable key, reduce, join)
        return dataset

    gold_transformed = p.transform(assemble_gold, silver_written, name="gold_transform")
    
    gold_written = p.write(
        store.writer(GOLD, FEED_NAME, Refresh()), 
        gold_transformed, 
        name="write_gold"
    )

    return p


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Refine the feed source -> raw -> silver -> gold under the run context."""
    pipeline = build_pipeline(context)
    if describe:
        print(pipeline.describe())
    
    return pipeline.run(context)


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

    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    try:
        run(context, describe=args.describe)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    
    # We don't have len(dataset) easily accessible anymore with the DAG without
    # an explicit output, but we can change the message.
    print(f"Refined source -> raw -> silver -> gold under {base_dir / FEED_NAME}")
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
