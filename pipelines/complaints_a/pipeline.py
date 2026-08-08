from __future__ import annotations

import sys
from pathlib import Path

from framework.core import Dataset, PipelineError, format_failure
from framework.io import AccumulateByRun, CsvReader, Reader, Writer
from framework.run import Pipeline, RunContext, RunLog
from tools.medallion import medallion
from tools.recipes import raw_to_silver, source_to_raw
from tools.store import StoreRegistry

from .schema import NAMESPACE, ComplaintsARow

UPSTREAMS = ()


# The columns the raw hop gates on, in the source's own vocabulary.
SOURCE_COLUMNS = ["record_id", "label", "amount"]


def raw_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the raw hop: faithful landing zone.

    The standard raw hop, composed from the shared recipe. To diverge, inline
    the recipe's body here and edit it: a recipe is composition, not
    inheritance, so there is nothing to fight.
    """
    return source_to_raw(
        reader,
        writer,
        expected_columns=SOURCE_COLUMNS,
        name=f"{NAMESPACE}:raw",
        run_log=run_log,
    )


def silver_builder(
    reader: Reader,
    writer: Writer,
    reject_writer: Writer | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the silver hop: schema coercion and enforcement + quarantine.

    The standard silver hop, composed from the shared recipe; inline it here to
    diverge.
    """
    return raw_to_silver(
        reader,
        writer,
        schema=ComplaintsARow,
        reject_writer=reject_writer,
        name=f"{NAMESPACE}:silver",
        run_log=run_log,
    )


def run(context: RunContext) -> Dataset:
    """Wire the real readers and writers for the environment and execute."""
    med = medallion(StoreRegistry(context.base_dir), NAMESPACE)
    strategy = AccumulateByRun.from_context(context)

    # In reality, this CSV is fetched from the SAS server.
    # To fetch once for all three pipelines, we would orchestrate a fetch step upstream,
    # and this pipeline would simply use CsvReader on the landed file.
    landing_dir = Path(context.base_dir) / "landing_zone"
    feed_csv = landing_dir / f"{NAMESPACE}.csv"

    # 1. Run Raw
    raw_pipeline = raw_builder(
        reader=CsvReader(feed_csv), writer=med.raw.writer(NAMESPACE, strategy)
    )
    raw_pipeline.run()

    # 2. Run Silver
    silver_pipeline = silver_builder(
        reader=med.raw.reader(NAMESPACE),
        writer=med.silver.writer(NAMESPACE, strategy),
        reject_writer=med.silver.quarantine_writer(NAMESPACE),
    )
    silver = silver_pipeline.run()

    return silver


def main(argv: list[str]) -> int:
    base_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    from framework.run import PipelineRunner

    runner = PipelineRunner()
    runner.register(
        subject=NAMESPACE, pipeline=NAMESPACE, handler=run, freshness=UPSTREAMS
    )
    try:
        runner.run(NAMESPACE, NAMESPACE, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
