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

    python -m framework run pipelines/myfeed [BASE_DIR]

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
    Reader,
    Refresh,
    StoreCatalog,
    Writer,
)
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import Rename, SchemaCoercion
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


def raw_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the source -> raw hop over the given Reader/Writer (not yet run).

    Reads the source, gates it with a ``ColumnValidator`` (every column the schema
    declares must be present before any row is landed -- an error-severity breach
    aborts fail-fast), and writes a faithful copy. ``run`` wires the real
    source/destination; tests call this same builder with sample rows.
    """
    return (
        Pipeline(FEED_NAME, reader, run_log)
        .with_validator(ColumnValidator([f.name for f in fields(MyfeedRow)]))
        .write_to(writer)
    )


def silver_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the raw -> silver hop over the given Reader/Writer (not yet run).

    Renames source columns to the schema's vocabulary (``RENAME``), coerces the
    dtypes a storage round-trip loses (``SchemaCoercion``), and validates the
    declared schema (``SchemaValidator``) before anything lands in silver.
    """
    return (
        Pipeline(FEED_NAME, reader, run_log)
        .with_processor(Rename(RENAME))
        .with_processor(SchemaCoercion(MyfeedRow))
        # TODO: add any further silver processors this feed needs -- e.g. a
        #       Filter to the current run's rows, Parse/SplitColumn to reshape
        #       values, or derived columns.
        .with_post_validator(SchemaValidator(MyfeedRow))
        .write_to(writer)
    )


def gold_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the silver -> gold hop over the given Reader/Writer (not yet run).

    A passthrough to start: reads silver and writes gold unchanged. How
    accumulated silver becomes gold is per-feed (a current reduce, a multi-feed
    join, Detail Tables, ...), so the assembly is yours to build.
    """
    return (
        Pipeline(FEED_NAME, reader, run_log)
        # TODO: build out the gold assembly -- e.g. derive a stable key, reduce
        #       to the current row per entity, join enriching feeds. See #163.
        .write_to(writer)
    )


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Refine the feed source -> raw -> silver -> gold under the run context.

    Wires the real Reader/Writer for each hop and runs the three builders in
    order; returns the gold dataset. The raw/silver accumulation strategy is
    derived from the ``RunContext``, so a re-run under the same logical run id
    (``--logical-run-id``) replaces that business run's rows rather than
    duplicating them. Pass ``describe=True`` to print each pipeline's plan before
    it runs.
    """
    store = StoreCatalog(context.base_dir).store(FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    def execute(pipeline: Pipeline) -> Dataset:
        if describe:
            print(pipeline.describe())
        return pipeline.run()

    execute(
        raw_builder(
            CsvReader(SAMPLE_CSV),
            store.writer(RAW, FEED_NAME, strategy),
            context.run_log,
        )
    )
    execute(
        silver_builder(
            store.reader(RAW, FEED_NAME),
            store.writer(SILVER, FEED_NAME, strategy),
            context.run_log,
        )
    )
    return execute(
        gold_builder(
            store.reader(SILVER, FEED_NAME),
            store.writer(GOLD, FEED_NAME, Refresh()),
            context.run_log,
        )
    )


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

    # Direct invocation builds a default run context and runs the same handler the
    # framework would. The pipeline is fail-fast: a Validator breach aborts before
    # anything lands and raises a PipelineError. Catch the family and present it
    # cleanly so an expected data failure reads as a clear message, not an
    # unhandled traceback; a genuine bug is *not* a PipelineError and keeps its
    # stack trace.
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    try:
        dataset = run(context, describe=args.describe)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    if context.write_replaced:
        print(
            f"Re-run: replaced {len(dataset)} rows (idempotent re-run) under "
            f"{base_dir / FEED_NAME} (layers {RAW}, {SILVER}, {GOLD})."
        )
    else:
        print(
            f"Refined {len(dataset)} rows source -> raw -> silver -> gold under "
            f"{base_dir / FEED_NAME} (layers {RAW}, {SILVER}, {GOLD})."
        )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
