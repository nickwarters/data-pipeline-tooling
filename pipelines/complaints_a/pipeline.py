from __future__ import annotations

import sys
from pathlib import Path

from framework.core import (
    ColumnValidator,
    Dataset,
    PipelineError,
    SchemaValidator,
    format_failure,
)
from framework.io import AccumulateByRun, CsvReader, Reader, Writer
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import SchemaCoercion, SchemaValueRulePartitioner
from tools.medallion import medallion
from tools.store import StoreRegistry

from .schema import NAMESPACE, ComplaintsARow

FEED_NAME = "complaints_a"
UPSTREAMS = ()


# The columns the raw hop gates on, in the source's own vocabulary.
SOURCE_COLUMNS = ["record_id", "label", "amount"]


def raw_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the raw hop: gate the source's columns, then land it faithfully."""
    p = Pipeline(f"{FEED_NAME}:raw", run_log=run_log)
    node = p.read(reader, name="read")
    node = p.validate(ColumnValidator(SOURCE_COLUMNS), node, name="columns")
    p.write(writer, node, name="write")
    return p


def silver_builder(
    reader: Reader,
    writer: Writer,
    reject_writer: Writer | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the silver hop: coerce, quarantine value-rule breaches, validate."""
    p = Pipeline(f"{FEED_NAME}:silver", run_log=run_log)
    node = p.read(reader, name="read")
    node = p.transform(SchemaCoercion(ComplaintsARow), node, name="coerce")
    if reject_writer is not None:
        node = p.quarantine(
            SchemaValueRulePartitioner(ComplaintsARow),
            reject_writer,
            node,
            name="quarantine",
        )
    node = p.validate(SchemaValidator(ComplaintsARow), node, name="post-validate")
    p.write(writer, node, name="write")
    return p


def run(context: RunContext) -> Dataset:
    """Wire the real readers and writers for the environment and execute."""
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    # In reality, this CSV is fetched from the SAS server.
    # To fetch once for all three pipelines, we would orchestrate a fetch step upstream,
    # and this pipeline would simply use CsvReader on the landed file.
    landing_dir = Path(context.base_dir) / "landing_zone"
    feed_csv = landing_dir / f"{FEED_NAME}.csv"

    # 1. Run Raw
    raw_pipeline = raw_builder(
        reader=CsvReader(feed_csv), writer=med.raw.writer(FEED_NAME, strategy)
    )
    raw_pipeline.run()

    # 2. Run Silver
    silver_pipeline = silver_builder(
        reader=med.raw.reader(FEED_NAME),
        writer=med.silver.writer(FEED_NAME, strategy),
        reject_writer=med.silver.quarantine_writer(FEED_NAME),
    )
    silver = silver_pipeline.run()

    return silver


def main(argv: list[str]) -> int:
    base_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    from framework.run import PipelineRunner

    runner = PipelineRunner()
    runner.register(
        subject=NAMESPACE, pipeline=FEED_NAME, handler=run, freshness=UPSTREAMS
    )
    try:
        runner.run(NAMESPACE, FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
