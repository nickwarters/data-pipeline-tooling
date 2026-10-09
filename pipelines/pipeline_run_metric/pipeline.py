"""Build the ``pipeline_run_metric`` gold tables from the run registry and the
orchestration decisions. See docs/data-dictionary-pipeline-run-metric.md.

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
from tools.orchestration import OrchestrationStore
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
    ("duration_percentiles_daily", schema.DurationPercentilesDaily),
    ("batch_finish_daily", schema.BatchFinishDaily),
)


def run_records_reader(base_dir) -> SqliteReader | DatasetReader:
    """A Reader over the caught-up run registry under ``base_dir``.

    A base directory nothing has run in yet has no registry file at all; that
    reads as no records, not as a failure, so the first run lands empty
    tables rather than refusing to start until something else has run.
    """
    store = RunStore(base_dir)
    store.catch_up()
    if not store.registry_path.exists():
        return DatasetReader(
            Dataset.from_pandas(pd.DataFrame(columns=list(metrics.RECORD_COLUMNS)))
        )
    return SqliteReader(store.registry_path, RUN_RECORDS_TABLE)


def decisions_reader(base_dir) -> DatasetReader:
    """A Reader over the orchestration decisions under ``base_dir``.

    Read through ``OrchestrationStore`` so a store written before a column
    existed is brought up to date first. Nothing orchestrated yet reads as no
    decisions.
    """
    path = RunStore(base_dir).orchestration_path
    rows = OrchestrationStore(path).records() if path.exists() else []
    frame = pd.DataFrame(rows, columns=list(metrics.DECISION_COLUMNS))
    return DatasetReader(Dataset.from_pandas(frame))


def _built(reduce, table: type, data: Dataset, as_of: str, name: str) -> Dataset:
    """Reduce ``data`` to one table and check it against its declared schema."""
    reduced = transform(partial(reduce, as_of=as_of), data, name=f"{name}:reduce")
    return validate(SchemaValidator(table), reduced, name=f"{name}:check")


def run(context: RunContext) -> Dataset:
    """Read each store once, build and check every table, then write them.

    Nothing is written until every table has passed its checks, so a
    reduction or check that fails leaves the previous tables in place together.
    A registry with nothing in it has no latest record to date the tables by;
    the run's own clock stands in, and the tables land empty.
    """
    gold = medallion(StoreRegistry(context.base_dir), schema.SUBJECT).gold

    records = read(run_records_reader(context.base_dir), name="registry:read")
    validate(
        ColumnValidator(list(metrics.RECORD_COLUMNS)), records, name="registry:columns"
    )
    as_of = metrics.latest_instant(records) or timestamps.utc_now_iso()

    decisions = read(decisions_reader(context.base_dir), name="decisions:read")

    tables = {
        "pipeline_run_summary": _built(
            metrics.run_summary,
            schema.PipelineRunSummary,
            records,
            as_of,
            "run_summary",
        ),
        "step_duration_trend_daily": _built(
            metrics.step_duration_trend,
            schema.StepDurationTrendDaily,
            records,
            as_of,
            "duration_trend",
        ),
        "step_row_flow": _built(
            metrics.step_row_flow, schema.StepRowFlow, records, as_of, "row_flow"
        ),
        "duration_percentiles_daily": _built(
            metrics.duration_percentiles,
            schema.DurationPercentilesDaily,
            records,
            as_of,
            "percentiles",
        ),
        "batch_finish_daily": _built(
            metrics.batch_finish,
            schema.BatchFinishDaily,
            decisions,
            as_of,
            "batch_finish",
        ),
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
