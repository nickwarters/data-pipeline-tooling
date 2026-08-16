"""Build reviewer activity gold and publish its local Report Feeds."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from framework.core import Dataset, PipelineError, format_failure
from framework.io import Refresh
from framework.run import (
    Pipeline,
    RunContext,
    run_pipeline,
)
from readers.sharepoint_cases import UPSTREAM as SYNC_UPSTREAM
from readers.sharepoint_cases import CurrentCasesReader
from tools.medallion import medallion
from tools.observability import timestamps
from tools.store import StoreRegistry

from .gold import (
    SUBJECT,
    TABLE,
    reviewer_activity_daily_builder,
)
from .report_feed import (
    ReportFeedWriter,
    empty_report_dataset,
    reviewer_report_feed_builder,
)

PIPELINE_NAME = "reviewer_activity"
# Cited, not restated: the freshness requirement travels with the reader, so
# what this pipeline must wait for follows from what it reads.
UPSTREAMS = (SYNC_UPSTREAM,)


def build_reviewer_activity_daily_pipeline(
    context: RunContext,
    *,
    describe: bool = False,
) -> Pipeline:
    """Build the aggregate pipeline over Sync's current Cases.

    The source is read through its Shared Reader and the target through this
    pipeline's own medallion. That asymmetry is the design: a pipeline resolves
    where it *writes*, and never where someone else's data lives.
    """
    output = medallion(StoreRegistry(context.base_dir), SUBJECT)
    pipeline = reviewer_activity_daily_builder(
        CurrentCasesReader(base_dir=context.base_dir),
        output.gold.writer(TABLE, Refresh()),
        run_log=context.run_log,
    )
    if describe:
        print(pipeline.describe())
    return pipeline


def publish_report_feeds(context: RunContext, *, describe: bool = False) -> Dataset:
    """Publish per-Reviewer files from the committed aggregate gold table."""
    registry = StoreRegistry(context.base_dir)
    output = medallion(registry, SUBJECT)
    writer = ReportFeedWriter(
        context.base_dir,
        generated_at=timestamps.utc_now_iso(),
    )
    pipeline = reviewer_report_feed_builder(
        output.gold.reader(TABLE), writer, run_log=context.run_log
    )
    if describe:
        print(pipeline.describe())
    result = pipeline.run(context)
    if not isinstance(result, Dataset):
        raise TypeError("Report Feed publication did not return a Dataset")
    return result


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Refresh the aggregate, then publish Report Feeds from committed gold."""
    if context.params.get("publish_only", "").lower() in {"1", "true", "yes"}:
        if context.dry_run:
            return empty_report_dataset()
        return publish_report_feeds(context, describe=describe)

    aggregate = build_reviewer_activity_daily_pipeline(context, describe=describe)
    aggregate_result = aggregate.run(context)
    if context.dry_run:
        return aggregate_result
    return publish_report_feeds(context, describe=describe)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.reviewer_activity.pipeline",
        description="Build the reviewer activity aggregate from Sync gold.",
    )
    parser.add_argument("--base-dir", default=None)
    parser.add_argument("--describe", action="store_true")
    parser.add_argument("--publish-only", action="store_true")
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    try:
        run_pipeline(
            lambda context: run(context, describe=args.describe),
            PIPELINE_NAME,
            base_dir=base_dir,
            upstreams=() if args.publish_only else UPSTREAMS,
            params={"publish_only": "true"} if args.publish_only else None,
        )
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
