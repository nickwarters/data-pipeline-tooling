"""Case Type ingest for the ``complaints_b`` feed: source -> raw -> silver.

Complaints A/B/C are one SAS complaints export split three ways. Each is its own
Case Type with its own ingest, and ``pipelines/complaint_selection`` is the one
place the three come back together, as a Selection group.

Each medallion step is its own ``to_*`` function, so a test can drive one with
sample rows and a recording writer without touching SQLite or the filesystem.

Address it by its location on disk, which is the label its run history is
recorded under -- and so the label a downstream ``FreshnessRequirement`` names::

    python -m cli run pipelines/complaints_b --base-dir BASE_DIR

or run the module directly. It routes through the same ``run_pipeline``, so
both record one identity::

    python -m pipelines.complaints_b.pipeline --base-dir BASE_DIR
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from framework.core import ColumnValidator, Dataset, PipelineError, format_failure
from framework.io import AccumulateByRun, CsvReader, Reader, Writer
from framework.run import RunContext, enforce, read, run_pipeline, validate, write
from tools.environments import known_environments, resolve_base_dir
from tools.medallion import medallion
from tools.store import StoreRegistry

from .schema import NAMESPACE, ComplaintsBRow

FEED_NAME = "complaints_b"

# Pipelines this feed depends on being fresh before it runs.
UPSTREAMS = ()

# The columns ``to_raw`` gates on, in the source's own vocabulary.
SOURCE_COLUMNS = ["record_id", "category", "priority", "received_date"]


def to_raw(reader: Reader, writer: Writer) -> Dataset:
    """Gate the source's columns, then land the feed faithfully.

    Edit these three lines to change it.
    """
    data = read(reader, name="raw:read")
    validate(ColumnValidator(SOURCE_COLUMNS), data, name="raw:column_validator")
    return write(writer, data, name="raw:write")


def to_silver(
    reader: Reader, writer: Writer, reject_writer: Writer | None = None
) -> Dataset:
    """Enforce the declared schema on this Case Type's accumulated raw rows.

    ``enforce`` is the coerce -> quarantine -> validate sequence in the order
    that makes it correct, and each part still records its own step. Given no
    ``reject_writer`` it is simply coerce -> validate.

    Every step here names the layer it is landing in, so a run log holding both
    this and ``to_raw`` says which ``read`` was which rather than ``read`` and
    ``read-2``.
    """
    data = read(reader, name="silver:read")
    data = enforce(ComplaintsBRow, data, reject_writer=reject_writer, name="silver")
    return write(writer, data, name="silver:write")


def run(context: RunContext) -> Dataset:
    """Refine the feed source -> raw -> silver under the run context; return silver."""
    # Where the feed lands follows FEED_NAME, never the identity NAMESPACE:
    # they are separate declarations even when their values coincide, and a Case
    # Type renamed must keep writing to the same place on disk.
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    # Fetched by the SAS script
    feed_csv = Path(context.base_dir) / "landing_zone" / f"{FEED_NAME}.csv"

    to_raw(
        CsvReader(feed_csv),
        med.raw.writer(FEED_NAME, strategy),
    )
    return to_silver(
        med.raw.reader(FEED_NAME),
        med.silver.writer(FEED_NAME, strategy),
        med.silver.quarantine_writer(FEED_NAME),
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.complaints_b.pipeline",
        description="Refine the complaints_b feed source -> raw -> silver.",
    )
    parser.add_argument(
        "--base-dir",
        dest="base_dir",
        default=None,
        help="medallion root directory; omit to resolve it from --env",
    )
    parser.add_argument(
        "--env",
        help="named environment to resolve base_dir from when no --base-dir is "
        f"given ({', '.join(known_environments())}); defaults to $PIPELINE_ENV or dev",
    )
    args = parser.parse_args(argv[1:])
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    # The *same* run_pipeline the operator CLI uses, so a run started here and
    # one started with `cli run` record under one identity -- one pipeline
    # label, one logical_run_id, one run history. Anything else gives the feed
    # two, and complaint_selection's FreshnessRequirement("complaints_b") only ever
    # resolves against one of them.
    try:
        silver = run_pipeline(run, FEED_NAME, base_dir, upstreams=UPSTREAMS)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    rows = len(silver) if isinstance(silver, Dataset) else 0
    print(
        f"Refined {rows} rows source -> raw -> silver for Case Type "
        f"'{NAMESPACE}' under {Path(base_dir) / FEED_NAME}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
