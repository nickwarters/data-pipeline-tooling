"""Ingest pipeline for the ``myfeed`` feed: source -> raw -> silver -> gold.

Every line here **does its work when it is reached**. Put a breakpoint on one,
step over it, and the variable holds the actual rows at that point in the feed —
which is the whole reason the steps are written this way
([ADR-0027](../../docs/adr/0027-eager-steps-are-the-default-authoring-model.md)).

Each medallion step is its own ``to_*`` function, so a test can drive one with
sample rows and a recording writer without touching SQLite, the network, or the
filesystem. ``run`` calls the three in order.

- ``to_raw``    reads the source and lands it faithfully (column-gated).
- ``to_silver`` narrows and renames the source columns, then enforces the schema.
- ``to_gold``   assembles silver into gold — a passthrough to start (see the TODO).

Address it by its location on disk::

    python -m cli run pipelines/myfeed --base-dir BASE_DIR

or run the module directly, which is what a PyCharm run configuration does::

    python -m pipelines.myfeed.pipeline --base-dir BASE_DIR
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import fields
from pathlib import Path

from framework.core import ColumnValidator, Dataset, PipelineError, format_failure
from framework.io import AccumulateByRun, CsvReader, Reader, Refresh, Writer
from framework.run import (
    RunContext,
    enforce,
    read,
    run_pipeline,
    transform,
    validate,
    write,
)
from framework.transform import Rename, SelectColumns
from tools.environments import known_environments, resolve_base_dir
from tools.medallion import medallion
from tools.store import StoreRegistry

from .schema import MyfeedRow

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"

# Source columns whose names differ from the schema's fields, mapped to the
# canonical field names. raw keeps the source names faithfully; silver renames
# them to the schema's vocabulary. Empty when the source already uses identifiers.
RENAME: dict[str, str] = {}

# The source columns silver keeps. raw lands whatever the source gave; silver
# narrows it to the columns this feed declares, so a wider source does not leak
# through into silver, gold and quarantine -- whose tables are declared at this
# shape by migrations/myfeed/. A scaffold seeded from a feed file replaces this
# with the source's own column names (RENAME's keys, plus the ones that needed
# no renaming). Edit it when the feed should carry more or fewer columns, and
# add a migration beside the change.
SELECT_RAW_COLUMNS = [f.name for f in fields(MyfeedRow)]

# Pipelines this feed depends on being fresh before it runs (a tuple of
# ``framework.run.FreshnessRequirement``). A source feed has none.
UPSTREAMS = ()


def to_raw(reader: Reader, writer: Writer) -> Dataset:
    """Land the source unchanged, once its columns are as expected.

    Edit these three lines to change it.
    """
    data = read(reader, name="raw:read")
    expected = [f.name for f in fields(MyfeedRow)]
    validate(ColumnValidator(expected), data, name="raw:column_validator")
    return write(writer, data, name="raw:write")


def to_silver(
    reader: Reader, writer: Writer, reject_writer: Writer | None = None
) -> Dataset:
    """Narrow and rename the source columns, then enforce the declared schema.

    ``enforce`` is the coerce -> quarantine -> validate sequence in the order
    that makes it correct, and each part still records its own step. Given no
    ``reject_writer`` it is simply coerce -> validate. Edit these lines to change
    it.

    Every step names the layer it is landing in, so one run log holding all three
    of these says which ``read`` was which rather than ``read``, ``read-2``,
    ``read-3``. ``enforce``'s ``name`` prefixes all three steps it records.
    """
    data = read(reader, name="silver:read")
    data = transform(SelectColumns(SELECT_RAW_COLUMNS), data, name="silver:select")
    if RENAME:
        data = transform(Rename(RENAME), data, name="silver:rename")
    data = enforce(MyfeedRow, data, reject_writer=reject_writer, name="silver")
    return write(writer, data, name="silver:write")


def to_gold(reader: Reader, writer: Writer) -> Dataset:
    """Assemble silver into gold."""
    data = read(reader, name="gold:read")
    # TODO: build out the gold assembly (e.g. derive a stable key, reduce, join)
    return write(writer, data, name="gold:write")


def run(context: RunContext) -> Dataset:
    """Refine the feed source -> raw -> silver -> gold under the run context."""
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    strategy = AccumulateByRun.from_context(context)

    to_raw(
        CsvReader(SAMPLE_CSV),
        med.raw.writer(FEED_NAME, strategy),
    )
    to_silver(
        med.raw.reader(FEED_NAME),
        med.silver.writer(FEED_NAME, strategy),
        med.silver.quarantine_writer(FEED_NAME),
    )
    return to_gold(
        med.silver.reader(FEED_NAME),
        med.gold.writer(FEED_NAME, Refresh()),
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.myfeed.pipeline",
        description="Refine the myfeed feed source -> raw -> silver -> gold.",
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
    # An explicit path wins; otherwise resolve base_dir from the named environment.
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    # The *same* run_pipeline the operator CLI uses, so a run started here and
    # one started with `cli run` record under one identity — one pipeline label,
    # one logical_run_id, one run history. Anything else gives the feed two.
    try:
        result = run_pipeline(run, FEED_NAME, base_dir, upstreams=UPSTREAMS)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    rows = len(result) if isinstance(result, Dataset) else 0
    print(
        f"Refined {rows} rows source -> raw -> silver -> gold "
        f"under {base_dir / FEED_NAME}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
