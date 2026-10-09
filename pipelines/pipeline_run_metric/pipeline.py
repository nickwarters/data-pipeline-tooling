"""Build the ``pipeline_run_metric`` gold tables from the run registry.

Reads the base directory's run registry -- after catching it up with every
run log, so a run recorded under any subject is visible -- and refreshes three
Aggregate tables in this subject's own gold: one row per run, step durations
per day against their recent past, and the row funnel per step per run.

``run`` reads the registry once, builds and checks every table, and only then
writes them; the reductions themselves are in ``metrics``.

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
    SchemaValidator,
    format_failure,
)
from framework.io import DatasetReader, Refresh, SqliteReader
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

    Catching up also migrates an existing registry, logs or none, so the
    ``SqliteReader`` finds every declared record column on an older file.

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


def build_run_summary(records: Dataset, as_of: str) -> Dataset:
    data = transform(
        partial(metrics.run_summary, as_of=as_of), records, name="run_summary:reduce"
    )
    return validate(
        SchemaValidator(schema.PipelineRunSummary), data, name="run_summary:check"
    )


def build_step_duration_trend(records: Dataset, as_of: str) -> Dataset:
    data = transform(
        partial(metrics.step_duration_trend, as_of=as_of),
        records,
        name="duration_trend:reduce",
    )
    return validate(
        SchemaValidator(schema.StepDurationTrendDaily),
        data,
        name="duration_trend:check",
    )


def build_step_row_flow(records: Dataset, as_of: str) -> Dataset:
    data = transform(
        partial(metrics.step_row_flow, as_of=as_of), records, name="row_flow:reduce"
    )
    return validate(SchemaValidator(schema.StepRowFlow), data, name="row_flow:check")


def run(context: RunContext) -> Dataset:
    """Read the registry once, build and check every table, then write them.

    Nothing is written until all three tables have passed their checks, so a
    reduction or check that fails leaves the previous tables in place together.
    A registry with nothing in it has no latest record to date the tables by;
    the run's own clock stands in, and the three tables land empty.
    """
    gold = medallion(StoreRegistry(context.base_dir), schema.SUBJECT).gold

    records = read(run_records_reader(context.base_dir), name="registry:read")
    validate(
        ColumnValidator(list(metrics.RECORD_COLUMNS)), records, name="registry:columns"
    )
    as_of = metrics.latest_instant(records) or timestamps.utc_now_iso()

    tables = {
        "pipeline_run_summary": build_run_summary(records, as_of),
        "step_duration_trend_daily": build_step_duration_trend(records, as_of),
        "step_row_flow": build_step_row_flow(records, as_of),
    }
    for table, data in tables.items():
        written = write(gold.writer(table, Refresh()), data, name=f"{table}:write")
    return written


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
