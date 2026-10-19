```python
"""Ingest pipeline: the demo Case Type's source feed -> raw -> silver -> gold.

Run through the operator CLI::

    python -m cli run pipelines/ingest --base-dir /tmp/demo --run-date 2026-05-29

Or run the module directly::

    python -m pipelines.ingest.pipeline --base-dir /tmp/demo
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

from framework.core import (
    PipelineError,
    SchemaValidator,
    UniqueValidator,
    format_failure,
)
from framework.io import AccumulateByRun, CsvReader, Refresh
from framework.run import (
    RunContext,
    coerce,
    read,
    run_pipeline,
    transform,
    validate,
    write,
)
from framework.transform import DeriveKey, Filter, LatestPerKey
from tools.environments import known_environments, resolve_base_dir
from tools.medallion import medallion
from tools.store import StoreRegistry

from .schema import NAMESPACE, NATURAL_KEY, ActivityCase

# A Case is identified by its ``case_id`` everywhere downstream, so the column
# DeriveKey stamps, LatestPerKey reduces by and UniqueValidator gates on is the
# same one. Declared here because this feed's gold is written here.
CASE_ID_COLUMN = "case_id"

SAMPLE_CSV = Path(__file__).parent / "sample_data" / "activity_cases.csv"

# Fixed so the working-day window aligns with the bundled feed (Fri 2026-05-29);
# doubles as the Ingest logical_run_id / load_date idempotency key for the demo.
AS_OF = date(2026, 5, 29)


UPSTREAMS = ()


def run(context: RunContext):
    """Land the CSV feed and refine it through raw -> silver -> gold.

    The accumulation strategy carries the run's logical idempotency key (the
    business run a re-drive replaces), derived from the shared RunContext so
    ``--logical-run-id`` flows straight through.
    """
    med = medallion(StoreRegistry(context.base_dir), NAMESPACE)
    strategy = AccumulateByRun.from_context(context)

    # --- raw: land the feed exactly as it arrived ---------------------------
    landed = read(CsvReader(SAMPLE_CSV))
    write(med.raw.writer(NAMESPACE, strategy), landed, name="write-raw")

    # --- silver: this run's rows, typed and checked -------------------------
    # raw accumulates every run, so silver takes only the rows this run landed.
    rows = read(med.raw.reader(NAMESPACE), name="read-raw")
    rows = transform(
        Filter(lambda row: row["logical_run_id"] == strategy.logical_run_id),
        rows,
        name="filter-by-run-id",
    )
    rows = coerce(ActivityCase, rows)
    validate(SchemaValidator(ActivityCase), rows)
    write(med.silver.writer(NAMESPACE, strategy), rows, name="write-silver")

    # --- gold: one current row per Case -------------------------------------
    # Silver accumulates every run, so gold re-reads the whole history and keeps
    # each Case's latest observation. UniqueValidator sits after the reduction,
    # where it cannot fire — a tripwire on the grain, not a check that does work.
    cases = read(med.silver.reader(NAMESPACE), name="read-silver")
    cases = transform(
        DeriveKey(
            into=CASE_ID_COLUMN,
            namespace=NAMESPACE,
            natural_key=list(NATURAL_KEY),
        ),
        cases,
        name="derive-key",
    )
    cases = transform(
        LatestPerKey(key=CASE_ID_COLUMN, by="load_date"), cases, name="latest-per-key"
    )
    validate(UniqueValidator(CASE_ID_COLUMN), cases, name="unique-validate")
    return write(med.gold.writer(NAMESPACE, Refresh()), cases, name="write-gold")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.ingest.pipeline",
        description="Land the demo Case Type feed and refine it to gold.",
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
    # An explicit --base-dir wins; otherwise resolve from the named environment.
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    # Use the same runner as the operator CLI so both entry points share run identity.
    try:
        dataset = run_pipeline(
            run, "ingest", base_dir, upstreams=UPSTREAMS, run_date=AS_OF
        )
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    print(f"Ingested {len(dataset)} cases into the CasePool under {base_dir}")
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
