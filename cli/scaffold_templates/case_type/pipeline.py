"""Case Type ingest for the ``myfeed`` feed: source -> raw -> silver.

Unlike the generic feed scaffold, this feed's rows are Cases: it declares the
identity contract in ``case_type.py`` and refines the feed through source -> raw
(a faithful, accumulated copy) -> silver (schema coerced + validated).

It deliberately **stops at silver**. How accumulated silver is reduced/assembled
into gold — a single-feed current reduce, a multi-feed join enriching one Case
Type, Detail Tables — is unique per Case Type, so the gold step is left to you.
Its shape is sketched at the foot of ``run``.

Each medallion hop is its own ``*_builder`` -- a single, editable definition of
what that hop does, composed through the public facades (``framework.core`` /
``framework.io`` / ``framework.transform`` / ``framework.run``) and the shared
``tools.recipes`` hop recipes.

Address it by its location on disk -- the framework imports
``pipelines.myfeed.pipeline`` and runs its ``run(context)`` callable::

    python -m cli run pipelines/myfeed --base-dir BASE_DIR

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
from framework.io import AccumulateByRun, CsvReader, Reader, Writer
from framework.run import Pipeline, RunContext, RunLog
from tools.environments import base_dir_for, known_environments
from tools.medallion import medallion
from tools.recipes import raw_to_silver, source_to_raw
from tools.store import StoreRegistry

from .case_type import CASE_TYPE
from .schema import MyfeedRow

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"

# Pipelines this feed depends on being fresh before it runs
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

    The standard silver hop, composed from the shared recipe: coerce the dtypes
    storage loses, route value-rule breaches to ``reject_writer`` (opt-in, so
    the good rows still land), then validate the Case Type's declared schema.
    Inline the recipe's body here to customise it.
    """
    return raw_to_silver(
        reader,
        writer,
        schema=CASE_TYPE.schema,
        reject_writer=reject_writer,
        name=f"{FEED_NAME}:silver",
        run_log=run_log,
    )


def run(context: RunContext) -> Dataset:
    """Refine the feed source -> raw -> silver under the run context; return silver."""
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    # Fetched by the SAS script or orchestrator
    raw_pipeline = raw_builder(
        reader=CsvReader(SAMPLE_CSV), writer=med.raw.writer(FEED_NAME, strategy)
    )
    raw_pipeline.run()

    silver_pipeline = silver_builder(
        reader=med.raw.reader(FEED_NAME),
        writer=med.silver.writer(FEED_NAME, strategy),
        reject_writer=med.silver.quarantine_writer(FEED_NAME),
        run_log=context.run_log,
    )
    silver = silver_pipeline.run()

    # --- gold is yours to assemble ------------------------------------------
    # How accumulated silver becomes gold is unique per Case Type, so the
    # scaffold stops at silver. When you're ready, add a gold step reading
    # the same Case Type so its case_id derives consistently with any Detail
    # Tables:
    #
    #     from case_review.gold import ingest_silver_to_gold
    #     ingest_silver_to_gold(med, CASE_TYPE).run()   # single-feed current gold
    # ------------------------------------------------------------------------
    return silver


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.myfeed.pipeline",
        description="Refine the myfeed feed source -> raw -> silver.",
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
    # An explicit --base-dir wins over the environment's own root, but the
    # environment is still activated either way -- a path says where a run
    # lands, never how strictly it may create a table no migration declared.
    try:
        base_dir = base_dir_for(args.env, override=args.base_dir)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    from framework.run import PipelineRunner

    def handler(ctx: RunContext) -> Dataset:
        return run(ctx, describe=args.describe)

    runner = PipelineRunner()
    runner.register(
        subject=CASE_TYPE.name, pipeline=FEED_NAME, handler=handler, freshness=UPSTREAMS
    )
    try:
        silver = runner.run(CASE_TYPE.name, FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    rows = len(silver) if isinstance(silver, Dataset) else 0
    print(
        f"Refined {rows} rows source -> raw -> silver for Case Type "
        f"'{CASE_TYPE.name}' under {Path(base_dir) / FEED_NAME} "
        "(layers raw, silver); add your gold step next (see pipeline.py)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
