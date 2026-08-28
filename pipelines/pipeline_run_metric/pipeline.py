"""Build the ``pipeline_run_metric`` gold tables from the run registry.

Reads the base directory's run registry -- after catching it up with every
run log, so a run recorded under any subject is visible -- and refreshes three
Aggregate tables in this subject's own gold: one row per run, step durations
per day against their recent past, and the row funnel per step per run. The
reductions are in ``metrics``; each ``to_*`` step here reads the registry,
reduces, validates and writes one table, and ``run`` only hands each step its
Reader and Writer.

Where the registry lives is ``RunStore``'s to say (``tools.observability``),
the same way ``tools.store`` says where data lives; this pipeline names
neither a path nor a table of its own for it.

This pipeline's own run is being recorded while it reads, and its records are
ingested after it returns -- so a run sees every run before it, including its
own previous ones, and never itself.
"""

from __future__ import annotations

import argparse
import sys
from functools import partial
from pathlib import Path

import pandas as pd

from framework.core import (
    ColumnValidator,
    Dataset,
    PipelineError,
    Reader,
    SchemaValidator,
    format_failure,
)
from framework.io import DatasetReader, Refresh, SqliteReader, Writer
from framework.run import RunContext, read, run_pipeline, transform, validate, write
from tools.medallion import medallion
from tools.observability import timestamps
from tools.observability.run_store import RunStore
from tools.store import StoreRegistry

from . import metrics, schema

PIPELINE_NAME = "pipeline_run_metric"
UPSTREAMS = ()

# The registry's one table, as RunRegistry names it.
RUN_RECORDS_TABLE = "run_records"

GOLD_TABLES = (
    ("pipeline_run_summary", schema.PipelineRunSummary),
    ("step_duration_trend_daily", schema.StepDurationTrendDaily),
    ("step_row_flow", schema.StepRowFlow),
)


def run_records_reader(base_dir) -> SqliteReader | DatasetReader:
    """A Reader over the caught-up run registry under ``base_dir``.

    A base directory nothing has run in yet has no registry file at all; that
    reads as no records, not as a failure, so the first run lands three empty
    tables rather than refusing to start until something else has run.
    """
    store = RunStore(base_dir)
    store.catch_up()
    if not store.registry_path.exists():
        return DatasetReader(
            Dataset.from_pandas(pd.DataFrame(columns=list(metrics.RECORD_COLUMNS)))
        )
    return SqliteReader(store.registry_path, RUN_RECORDS_TABLE)


def _records(reader: Reader, at: str, fallback_as_of: str) -> tuple[Dataset, str]:
    """Read the registry, gate it, and settle the instant the table is stamped with.

    A registry with nothing in it has no latest record to date the table by;
    the run's own clock stands in, and the table is empty.
    """
    records = read(reader, name=f"{at}:read")
    validate(
        ColumnValidator(list(metrics.RECORD_COLUMNS)), records, name=f"{at}:columns"
    )
    return records, metrics.latest_instant(records) or fallback_as_of


def to_run_summary(reader: Reader, writer: Writer, fallback_as_of: str) -> Dataset:
    at = "run_summary"
    records, as_of = _records(reader, at, fallback_as_of)
    data = transform(
        partial(metrics.run_summary, as_of=as_of), records, name=f"{at}:reduce"
    )
    validate(SchemaValidator(schema.PipelineRunSummary), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def to_step_duration_trend(
    reader: Reader, writer: Writer, fallback_as_of: str
) -> Dataset:
    at = "step_duration_trend"
    records, as_of = _records(reader, at, fallback_as_of)
    data = transform(
        partial(metrics.step_duration_trend, as_of=as_of),
        records,
        name=f"{at}:reduce",
    )
    validate(
        SchemaValidator(schema.StepDurationTrendDaily), data, name=f"{at}:validate"
    )
    return write(writer, data, name=f"{at}:write")


def to_step_row_flow(reader: Reader, writer: Writer, fallback_as_of: str) -> Dataset:
    at = "step_row_flow"
    records, as_of = _records(reader, at, fallback_as_of)
    data = transform(
        partial(metrics.step_row_flow, as_of=as_of), records, name=f"{at}:reduce"
    )
    validate(SchemaValidator(schema.StepRowFlow), data, name=f"{at}:validate")
    return write(writer, data, name=f"{at}:write")


def run(context: RunContext) -> Dataset:
    """Build each table in publication order.

    The registry Reader is minted once -- catching the registry up once -- and
    handed to each ``to_*`` step with the Writer for its table; every step reads
    what it needs, gates it, reduces, validates and writes. One ``now`` is taken
    here so three empty tables carry the same stamp.
    """
    gold = medallion(StoreRegistry(context.base_dir), schema.SUBJECT).gold
    records = run_records_reader(context.base_dir)
    now = timestamps.utc_now_iso()

    to_run_summary(records, gold.writer("pipeline_run_summary", Refresh()), now)
    to_step_duration_trend(
        records, gold.writer("step_duration_trend_daily", Refresh()), now
    )
    return to_step_row_flow(records, gold.writer("step_row_flow", Refresh()), now)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.pipeline_run_metric.pipeline",
        description="Build the pipeline run metric tables from the run registry.",
    )
    parser.add_argument("--base-dir", default=None)
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    try:
        run_pipeline(run, PIPELINE_NAME, base_dir=base_dir, upstreams=UPSTREAMS)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
