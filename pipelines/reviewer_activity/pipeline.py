"""Build the reviewer activity gold aggregate from Sync gold."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from framework.core import Dataset, PipelineError, format_failure
from framework.io import Refresh
from framework.run import (
    FreshnessRequirement,
    PipelineRunner,
    RunContext,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

from .gold import (
    SUBJECT,
    SYNC_SUBJECT,
    SYNC_TABLE,
    TABLE,
    reviewer_activity_daily_builder,
)

PIPELINE_NAME = "reviewer_activity"
UPSTREAMS = (FreshnessRequirement("sharepoint_cases"),)


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Read Sync's current gold and refresh the reviewer activity aggregate."""
    registry = StoreRegistry(context.base_dir)
    sync = medallion(registry, SYNC_SUBJECT)
    output = medallion(registry, SUBJECT)
    pipeline = reviewer_activity_daily_builder(
        sync.gold.reader(SYNC_TABLE),
        output.gold.writer(TABLE, Refresh()),
        run_log=context.run_log,
    )
    if describe:
        print(pipeline.describe())
    return pipeline.run()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.reviewer_activity.pipeline",
        description="Build the reviewer activity aggregate from Sync gold.",
    )
    parser.add_argument("--base-dir", default=None)
    parser.add_argument("--describe", action="store_true")
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    def handler(context: RunContext) -> Dataset:
        return run(context, describe=args.describe)

    runner = PipelineRunner()
    runner.register(
        subject="",
        pipeline=PIPELINE_NAME,
        handler=handler,
        freshness=UPSTREAMS,
    )
    try:
        runner.run("", PIPELINE_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
