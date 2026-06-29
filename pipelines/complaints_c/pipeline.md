```python
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

from .case_type import CASE_TYPE

FEED_NAME = "complaints_c"
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
        ColumnValidator(["record_id", "department", "resolution_days"]),
        r,
        name="columns",
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
    """Wire the real readers and writers for the environment and execute."""
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    # Fetched by the SAS script
    landing_dir = Path(context.base_dir) / "landing_zone"
    feed_csv = landing_dir / f"{FEED_NAME}.csv"

    raw_pipeline = raw_builder(
        reader=CsvReader(feed_csv), writer=med.raw.writer(FEED_NAME, strategy)
    )
    raw_pipeline.run()

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
        subject=CASE_TYPE.name, pipeline=FEED_NAME, handler=run, freshness=UPSTREAMS
    )
    try:
        runner.run(CASE_TYPE.name, FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

```
