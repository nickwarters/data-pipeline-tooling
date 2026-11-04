```python
"""Case Type ingest for the ``myfeed`` feed: source -> raw -> silver.

Unlike the generic feed scaffold, this feed's rows are Cases: it declares the
identity contract beside the row schema and refines the feed through source ->
raw (a faithful, accumulated copy) -> silver (schema coerced + validated).

It deliberately **stops at silver**. How accumulated silver is reduced/assembled
into gold — a single-feed current reduce, a multi-feed join enriching one Case
Type, Detail Tables — is unique per Case Type, so the gold step is left to you.
Its shape is sketched at the foot of ``run``.

Each medallion step is its own ``to_*`` function, so a test can drive one with
sample rows and a recording writer without touching SQLite or the filesystem.

Address it by its location on disk::

    python -m cli run pipelines/myfeed --base-dir BASE_DIR

or run the module directly::

    python -m pipelines.myfeed.pipeline --base-dir BASE_DIR
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import fields
from pathlib import Path

from framework.core import ColumnValidator, Dataset, PipelineError, format_failure
from framework.io import AccumulateByRun, CsvReader, Reader, Writer
from framework.run import (
    RunContext,
    enforce,
    read,
    run_pipeline,
    transform,
    validate,
    write,
)
from framework.transform import SelectColumns
from tools.environments import known_environments, resolve_base_dir
from tools.medallion import medallion
from tools.store import StoreRegistry

from .schema import NAMESPACE, NATURAL_KEY, MyfeedRow  # noqa: F401

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"

# The source columns silver keeps. raw lands whatever the source gave; silver
# narrows it to the columns this Case Type declares, so a wider source does not
# leak through into silver -- whose table is declared at this shape by
# migrations/myfeed/. Edit it when the feed should carry more or fewer columns,
# and add a migration beside the change.
SELECT_RAW_COLUMNS = [f.name for f in fields(MyfeedRow)]

# Pipelines this feed depends on being fresh before it runs
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
    """Narrow the source columns, then enforce the declared schema.

    ``enforce`` is the coerce -> quarantine -> validate sequence in the order
    that makes it correct, and each part still records its own step. Given no
    ``reject_writer`` it is simply coerce -> validate. Edit these lines to change
    it.

    Every step names the layer it is landing in, so one run log holding both this
    and ``to_raw`` says which ``read`` was which rather than ``read`` and
    ``read-2``. ``enforce``'s ``name`` prefixes all three steps it records.
    """
    data = read(reader, name="silver:read")
    data = transform(SelectColumns(SELECT_RAW_COLUMNS), data, name="silver:select")
    data = enforce(MyfeedRow, data, reject_writer=reject_writer, name="silver")
    return write(writer, data, name="silver:write")


def run(context: RunContext) -> Dataset:
    """Refine the feed source -> raw -> silver under the run context; return silver."""
    med = medallion(StoreRegistry(context.base_dir), NAMESPACE)
    strategy = AccumulateByRun.from_context(context)

    # Fetched by the SAS script or orchestrator
    to_raw(
        CsvReader(SAMPLE_CSV),
        med.raw.writer(FEED_NAME, strategy),
    )
    silver = to_silver(
        med.raw.reader(FEED_NAME),
        med.silver.writer(FEED_NAME, strategy),
        med.silver.quarantine_writer(FEED_NAME),
    )

    # --- gold is yours to assemble ------------------------------------------
    # How accumulated silver becomes gold is unique per Case Type, so the
    # scaffold stops at silver. When you're ready, add a gold step passing the
    # same declared namespace and natural key used by any Detail Tables, so
    # their case_ids derive consistently:
    #
    #     def to_gold(reader, writer):
    #         data = read(reader)
    #         data = transform(
    #             DeriveKey(into="case_id", namespace=NAMESPACE,
    #                       natural_key=list(NATURAL_KEY)),
    #             data, name="derive-key",
    #         )
    #         data = transform(LatestPerKey(key="case_id", by="load_date"),
    #                          data, name="latest-per-key")
    #         validate(UniqueValidator("case_id"), data)
    #         return write(writer, data)
    #
    # There is deliberately no shared builder to call: with this few Case Types
    # there is not enough evidence of what a shared reduction should generalise
    # over. What makes a Case and its Detail rows agree is that both derive
    # their key from the *same* NAMESPACE and NATURAL_KEY, not a common helper.
    # ------------------------------------------------------------------------
    return silver


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.myfeed.pipeline",
        description="Refine the myfeed feed source -> raw -> silver.",
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
        silver = run_pipeline(run, FEED_NAME, base_dir, upstreams=UPSTREAMS)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    rows = len(silver) if isinstance(silver, Dataset) else 0
    print(
        f"Refined {rows} rows source -> raw -> silver for Case Type "
        f"'{NAMESPACE}' under {Path(base_dir) / NAMESPACE} "
        "(layers raw, silver); add your gold step next (see pipeline.py)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

```
