```python
from __future__ import annotations

import sys
from pathlib import Path

from framework.core import Dataset, PipelineError, format_failure
from framework.io import AccumulateByRun, CsvReader, Reader, Writer
from framework.run import Pipeline, RunContext, RunLog
from tools.medallion import medallion
from tools.recipes import raw_to_silver, source_to_raw
from tools.store import StoreRegistry

from .case_type import CASE_TYPE

FEED_NAME = "complaints_c"
UPSTREAMS = ()


# The columns the raw hop gates on, in the source's own vocabulary.
SOURCE_COLUMNS = ["record_id", "department", "resolution_days"]


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

    The standard silver hop, composed from the shared recipe; inline it here to
    diverge.
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
