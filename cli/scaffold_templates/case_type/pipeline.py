"""Case Type ingest for the ``myfeed`` feed: source -> raw -> silver.

Unlike the generic feed scaffold, this feed's rows are Cases: it declares the
identity contract in ``case_type.py`` and refines the feed through source -> raw
(a faithful, accumulated copy) -> silver (schema coerced + validated).

It deliberately **stops at silver**. How accumulated silver is reduced/assembled
into gold — a single-feed current reduce, a multi-feed join enriching one Case
Type, Detail Tables — is unique per Case Type, so the gold step is left to you.
Its shape is sketched at the foot of ``run``.

Each medallion hop is its own ``*_builder`` -- a single, editable definition of
what that hop does.

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
    RAW,
    SILVER,
    ColumnValidator,
    Dataset,
    PipelineError,
    SchemaValidator,
    format_failure,
)
from framework.io import AccumulateByRun, CsvReader, Reader, StoreCatalog, Writer
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import SchemaCoercion, SchemaValueRulePartitioner

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
    """Build the raw hop: faithful landing zone."""
    p = Pipeline(f"{FEED_NAME}:raw", run_log=run_log)
    r = p.read(reader, name="read")
    # Gate the source's expected columns before landing
    v = p.validate(
        ColumnValidator([f.name for f in fields(MyfeedRow)]), r, name="columns"
    )
    p.write(writer, v, name="write")
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

    coerced = p.transform(SchemaCoercion(CASE_TYPE.schema), r, name="coerce")

    # Opt-in quarantine: value-rule rejects go to reject_writer, good rows proceed
    if reject_writer:
        quarantined = p.quarantine(
            SchemaValueRulePartitioner(CASE_TYPE.schema),
            reject_writer,
            coerced,
            name="quarantine",
        )
    else:
        quarantined = coerced

    validated = p.validate(
        SchemaValidator(CASE_TYPE.schema), quarantined, name="post-validate"
    )
    p.write(writer, validated, name="write")
    return p


def run(context: RunContext) -> Dataset:
    """Refine the feed source -> raw -> silver under the run context; return silver."""
    store = StoreCatalog(context.base_dir).store(FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    # Fetched by the SAS script or orchestrator
    raw_pipeline = raw_builder(
        reader=CsvReader(SAMPLE_CSV), writer=store.writer(RAW, FEED_NAME, strategy)
    )
    raw_pipeline.run()

    silver_pipeline = silver_builder(
        reader=store.reader(RAW, FEED_NAME),
        writer=store.writer(SILVER, FEED_NAME, strategy),
        reject_writer=store.quarantine_writer(FEED_NAME),
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
    #     ingest_silver_to_gold(store, CASE_TYPE).run()   # single-feed current gold
    # ------------------------------------------------------------------------
    return silver


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.myfeed.pipeline",
        description="Refine the myfeed feed source -> raw -> silver.",
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
        f"(layers {RAW}, {SILVER}); add your gold step next (see pipeline.py)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
