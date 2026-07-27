"""Ingest pipeline for the ``myfeed`` feed: source -> raw -> silver -> gold.

Each medallion hop is its own ``*_builder`` -- a single, editable definition of
what that hop does, composed through the public facades (``framework.core`` /
``framework.io`` / ``framework.transform`` / ``framework.run``) and the shared
``tools.recipes`` hop recipes. ``run`` orchestrates the three in order; tests
call a builder directly with sample rows and a recording writer, so the first
test drives the actual hop rather than a rebuild of it.

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

from framework.core import Dataset, PipelineError, format_failure
from framework.io import AccumulateByRun, CsvReader, Reader, Refresh, Writer
from framework.run import Pipeline, RunContext, RunLog
from tools.environments import known_environments, resolve_base_dir
from tools.medallion import medallion
from tools.recipes import raw_to_silver, source_to_raw
from tools.store import StoreRegistry

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
    """Build the raw hop: faithful landing zone.

    This is the standard raw hop, composed from the shared recipe: gate the
    source's expected columns, then land the source unchanged. To customise,
    inline the recipe's body here -- a recipe is composition, not inheritance,
    so there is nothing to fight.
    """
    return source_to_raw(
        reader,
        writer,
        expected_columns=[f.name for f in fields(MyfeedRow)],
        name=f"{FEED_NAME}:raw",
        run_log=run_log,
    )


def silver_builder(
    reader: Reader,
    writer: Writer,
    reject_writer: Writer | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the silver hop: schema coercion and enforcement + quarantine.

    The standard silver hop, composed from the shared recipe: rename the source
    columns to the schema's vocabulary, coerce the dtypes storage loses,
    quarantine value-rule breaches, then validate the declared schema. Inline
    the recipe's body here to customise it.
    """
    return raw_to_silver(
        reader,
        writer,
        schema=MyfeedRow,
        rename=RENAME,
        reject_writer=reject_writer,
        name=f"{FEED_NAME}:silver",
        run_log=run_log,
    )


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
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    raw_p = raw_builder(
        reader=CsvReader(SAMPLE_CSV),
        writer=med.raw.writer(FEED_NAME, strategy),
        run_log=context.run_log,
    )
    if describe:
        print(raw_p.describe())
    raw_p.run()

    silver_p = silver_builder(
        reader=med.raw.reader(FEED_NAME),
        writer=med.silver.writer(FEED_NAME, strategy),
        reject_writer=med.silver.quarantine_writer(FEED_NAME),
        run_log=context.run_log,
    )
    if describe:
        print(silver_p.describe())
    silver_p.run()

    gold_p = gold_builder(
        reader=med.silver.reader(FEED_NAME),
        writer=med.gold.writer(FEED_NAME, Refresh()),
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
        "--base-dir",
        dest="base_dir",
        default=None,
        help="medallion root directory; omit to resolve it from --env",
    )
    parser.add_argument(
        "--env",
        help="named environment to resolve base_dir from when no --base-dir is "
        f"given ({', '.join(known_environments())}); defaults to $PIPELINE_ENV or dev",
    )
    parser.add_argument(
        "--describe",
        action="store_true",
        help="print each pipeline's plan before running it",
    )
    args = parser.parse_args(argv[1:])
    # An explicit path wins; otherwise resolve base_dir from the named environment.
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

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
