"""Ingest pipeline: the demo Case Type's source feed -> raw -> silver -> gold.

The first half of the capstone path the framework exists to make routine: land
the bundled CSV feed into **raw** (accumulated, stamped ``logical_run_id`` /
``load_date``), refine it into **silver** (accumulated, schema enforced), then
reduce it to a current-only **gold** (one row per Case via
``DeriveKey`` -> ``LatestPerKey`` -> ``UniqueValidator`` -> ``Refresh``). Gold is
the CasePool the downstream ``selection`` pipeline reads.

Address it by its location on disk::

    python -m cli run pipelines/ingest /tmp/demo --run-date 2026-05-29

or run the module directly with a default run context::

    python -m pipelines.ingest.pipeline /tmp/demo
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from case_review.case_type import CaseType, Variation
from case_review.gold import ingest_silver_to_gold
from framework.core import PipelineError, SchemaValidator, format_failure
from framework.io import AccumulateByRun, CsvReader
from framework.run import Pipeline, RunContext
from framework.transform import Filter, SchemaCoercion
from tools.environments import known_environments, resolve_base_dir
from tools.medallion import medallion
from tools.store import StoreRegistry

SAMPLE_CSV = Path(__file__).parent / "sample_data" / "activity_cases.csv"

# Fixed so the working-day window aligns with the bundled feed (Fri 2026-05-29);
# doubles as the Ingest logical_run_id / load_date idempotency key for the demo.
AS_OF = date(2026, 5, 29)


@dataclass
class ActivityCase:
    """The demo Case Type's schema: an activity-dated, advised, valued Case."""

    case_ref: str
    adviser: str
    activity_date: date
    amount: int


# The Case Type bundles its schema and identity contract with its Variations --
# declarative and imported directly. ``natural_key`` is the stable identifying
# column; the Case Type derives its own ``namespace`` from its name, so case_id
# derivation is owned in one place. The downstream ``selection`` pipeline imports
# this same CASES so the two halves share one identity definition.
CASES = CaseType(
    name="cases",
    schema=ActivityCase,
    natural_key=("case_ref",),
    variations=(
        Variation(id="v1", question_bank_id="qb-100"),
        Variation(id="v2", question_bank_id="qb-200"),
    ),
)

# This pipeline has no upstream — it is the source of the CasePool.
UPSTREAMS = ()


def run(context: RunContext):
    """Land the CSV feed and refine it through raw -> silver -> gold.

    The accumulation strategy carries the run's logical idempotency key (the
    business run a re-drive replaces) and its execution id, derived from the
    shared RunContext so ``--logical-run-id`` flows straight through.
    """
    med = medallion(StoreRegistry(context.base_dir), CASES.name)
    strategy = AccumulateByRun.from_context(context)

    p = Pipeline("cases")
    r = p.read(CsvReader(SAMPLE_CSV), name="read")
    p.write(med.raw.writer("cases", strategy), r, name="write")
    p.run()

    p_silver = Pipeline("cases")
    r_silver = p_silver.read(med.raw.reader("cases"), name="read")
    current = r_silver
    if isinstance(strategy, AccumulateByRun):
        logical_run_id = strategy.logical_run_id
        current = p_silver.transform(
            Filter(lambda row, _rid=logical_run_id: row["logical_run_id"] == _rid),
            current,
            name="filter-by-run-id",
        )
    coerced = p_silver.transform(SchemaCoercion(CASES.schema), current, name="coerce")
    validated = p_silver.validate(
        SchemaValidator(CASES.schema), coerced, name="post-validate"
    )
    p_silver.write(med.silver.writer("cases", strategy), validated, name="write")
    p_silver.run()

    return ingest_silver_to_gold(med, CASES).run()


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
    # Direct invocation builds a default run context (fixed AS_OF run date so the
    # demo is deterministic) and runs the same handler the framework would.
    context = RunContext(base_dir=base_dir, pipeline="ingest", run_date=AS_OF)
    try:
        dataset = run(context)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    print(f"Ingested {len(dataset)} cases into the CasePool under {base_dir}")
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
