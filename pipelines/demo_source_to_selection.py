"""Domain capstone demo: one Case Type, source feed -> SelectionPool.

Runs the full per-Case-Type path the framework exists to make routine, composing
the primitives the earlier slices built:

1. **Ingest** — land the bundled CSV feed into **raw** (accumulated, stamped
   ``run_id`` / ``load_date``), refine it into **silver** (accumulated, schema
   enforced), then reduce it to a current-only **gold** (one-row-per-Case via
   ``DeriveKey`` → ``LatestPerKey`` → ``UniqueValidator`` → ``Refresh``).
   Gold is the CasePool.
2. **Selection** — a :class:`~case_review.case_pool.CasePool` fetches the
   **available cases** from gold (activity within the working-day window), and a
   Selection :class:`~framework.builder.Pipeline` narrows them with named,
   testable Python rules (score priority, filter the low-value cases out, rank
   highest-priority first),
   stamps the chosen :class:`~case_review.case_type.Variation`'s
   ``question_bank_id``, and accumulates the **SelectionPool** into ``gold``
   stamped ``run_id`` / ``load_date``. ``.explain(...)`` lands a sibling trace
   alongside it — a per-Case verdict of why each available Case was or wasn't
   selected.

Run from the repo root as a module so the import-only ``framework`` package
resolves on ``sys.path``::

    python -m pipelines.demo_source_to_selection /tmp/demo

The ``as_of`` date is fixed so the working-day window lines up with the bundled
sample feed and the run is deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Mapping

from case_review.case_pool import CasePool
from case_review.case_type import CaseType, Variation
from case_review.gold import ingest_silver_to_gold
from framework.io import (
    GOLD,
    RAW,
    AccumulateByRun,
    CsvReader,
    DatasetReader,
    StoreCatalog,
)
from framework.run import (
    FreshnessRequirement,
    Pipeline,
    PipelineRunner,
    RunContext,
    raw_to_silver,
)
from framework.transform import Filter, Score, Sort, Stamp, WorkingDayCalendar


@dataclass
class ActivityCase:
    """The demo Case Type's schema: an activity-dated, advised, valued Case."""

    case_ref: str
    adviser: str
    activity_date: date
    amount: int


# The Case Type bundles its schema and identity contract with its Variations —
# declarative and imported directly. ``natural_key`` is the stable identifying
# column; the Case Type derives its own ``namespace`` from its name, so case_id
# derivation is owned in one place. This demo selects under Variation "v1".
CASES = CaseType(
    name="cases",
    schema=ActivityCase,
    natural_key=("case_ref",),
    variations=(
        Variation(id="v1", question_bank_id="qb-100"),
        Variation(id="v2", question_bank_id="qb-200"),
    ),
)

# Fixed so the working-day window aligns with the bundled feed (Fri 2026-05-29);
# doubles as the Ingest run_id / load_date idempotency key.
AS_OF = date(2026, 5, 29)


def high_value_case(row: Mapping[str, Any]) -> bool:
    """Return whether a Case clears the demo's explainable value gate.

    Kept as a named pure function so the rule can be reused, traced by a named
    ``Filter``, and tested without running a Pipeline.
    """
    return row["amount"] >= 100


def priority_score(row: Mapping[str, Any]) -> int:
    """Return the demo priority score used to rank selected Cases.

    The scorer is deterministic and depends only on the row, so the
    SelectionPool ordering and selection trace score are reproducible.
    """
    return row["amount"] * 2


def run_ingest(context: RunContext):
    sample = Path(__file__).parent / "sample_data" / "activity_cases.csv"
    store = StoreCatalog(context.base_dir).store(CASES.name)

    # The accumulation strategy carries the run's logical idempotency key (the
    # business run a re-drive replaces) and its execution id, derived from the
    # shared RunContext so `--logical-run-id` flows straight through.
    strategy = AccumulateByRun.from_context(context)

    Pipeline("cases", CsvReader(sample)).write_to(
        store.writer(RAW, "cases", strategy)
    ).run()
    raw_to_silver(
        store,
        "cases",
        CASES.schema,
        strategy=strategy,
    ).run()
    return ingest_silver_to_gold(store, CASES).run()


def run_selection(context: RunContext):
    store = StoreCatalog(context.base_dir).store(CASES.name)
    strategy = AccumulateByRun.from_context(context)

    # Named, pure rule functions stay independently testable while Filter/Score
    # provide the framework wiring and trace metadata.
    pool = CasePool(CASES, store, WorkingDayCalendar())
    available = pool.fetch_available_cases(
        as_of=context.run_date, activity_column="activity_date", within_working_days=5
    )
    variation = CASES.variation("v1")
    selection_pool = (
        Pipeline("selection", DatasetReader(available))
        .with_processor(Score("priority_score", priority_score))
        .with_processor(Filter(high_value_case, name="high-value"))
        .with_processor(Sort("priority_score", ascending=False))
        .with_processor(Stamp("question_bank_id", variation.question_bank_id))
        # Land a per-Case trace of why each available Case was or wasn't
        # selected in a sibling table, stamped by this run.
        .explain(
            store.writer(GOLD, "selection_trace", strategy),
            id_column="case_ref",
            score_column="priority_score",
        )
        .write_to(store.writer(GOLD, "selection_pool", strategy))
        .run()
    )

    trace = store.reader(GOLD, "selection_trace").read()
    excluded = sum(1 for v in trace.to_pandas()["verdict"] if v == "excluded")
    print(
        f"available cases: {len(available)} -> "
        f"SelectionPool: {len(selection_pool)} cases "
        f"(Question Bank {variation.question_bank_id}, "
        f"logical run {context.logical_run_id}); "
        f"trace: {len(trace)} considered, {excluded} excluded with a reason"
    )
    return selection_pool


def build_runner() -> PipelineRunner:
    runner = PipelineRunner()
    runner.register(CASES.name, "ingest", run_ingest)
    runner.register(
        CASES.name,
        "selection",
        run_selection,
        freshness=(FreshnessRequirement(upstream_pipeline="ingest"),),
    )
    return runner


def main(target_dir: str) -> None:
    runner = build_runner()
    runner.run(CASES.name, "ingest", target_dir, run_date=AS_OF)
    runner.run(CASES.name, "selection", target_dir, run_date=AS_OF)


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    import sys

    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: python -m pipelines.demo_source_to_selection <target_dir>"
        )
    main(sys.argv[1])
