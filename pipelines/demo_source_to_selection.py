"""Domain capstone demo: one Case Type, source feed → SelectionPool (#11).

Runs the full per-Case-Type path the framework exists to make routine, composing
the primitives the earlier slices built:

1. **Ingest** — land the bundled CSV feed into ``raw``, then refine it into
   ``silver`` with the Case Type's :mod:`~framework.schema` enforced
   (:func:`~framework.silver.raw_to_silver`). Silver *is* the CasePool.
2. **Selection** — a :class:`~framework.case_pool.CasePool` fetches the
   **available cases** (activity within the working-day window), and a Selection
   :class:`~framework.builder.Pipeline` narrows them with specific Python
   processors (filter the low-value cases out, rank highest-amount first), stamps
   the chosen :class:`~framework.case_type.Variation`'s ``question_bank_id``, and
   accumulates the **SelectionPool** into ``gold`` stamped ``run_id`` /
   ``load_date`` (ADR-0006).

Run from the repo root as a module so the import-only ``framework`` package
resolves on ``sys.path``::

    python -m pipelines.demo_source_to_selection /tmp/demo

The ``as_of`` date is fixed so the working-day window lines up with the bundled
sample feed and the run is deterministic.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from framework.builder import Pipeline
from framework.calendar import WorkingDayCalendar
from framework.case_pool import CasePool
from framework.case_type import CaseType, Variation
from framework.processors import Filter, Sort, Stamp
from framework.readers import CsvReader, DatasetReader
from framework.silver import raw_to_silver
from framework.store import Store


@dataclass
class ActivityCase:
    """The demo Case Type's schema: an activity-dated, advised, valued Case."""

    case_ref: str
    adviser: str
    activity_date: date
    amount: int


# The Case Type bundles its schema with its Variations — declarative, imported
# directly, no registry (ADR-0005). This demo selects under Variation "v1".
CASES = CaseType(
    name="cases",
    schema=ActivityCase,
    variations=(
        Variation(id="v1", question_bank_id="qb-100"),
        Variation(id="v2", question_bank_id="qb-200"),
    ),
)

# Fixed so the working-day window aligns with the bundled feed (Fri 2026-05-29);
# doubles as gold's logical run_id / load_date idempotency key (ADR-0006).
AS_OF = date(2026, 5, 29)
RUN_ID = AS_OF.isoformat()


def main(target_dir: str) -> None:
    sample = Path(__file__).parent / "sample_data" / "activity_cases.csv"
    store = Store(Path(target_dir) / CASES.name)

    # 1. Ingest: CSV feed -> raw (schema-light) -> silver (schema enforced).
    Pipeline("cases", CsvReader(sample)).write_to(store.writer("raw", "cases")).run()
    raw_to_silver(store, "cases", CASES.schema).run()

    # 2. Selection: fetch the available cases from the CasePool, then narrow them.
    pool = CasePool(CASES, store, WorkingDayCalendar())
    available = pool.fetch_available_cases(
        as_of=AS_OF, activity_column="activity_date", within_working_days=5
    )
    variation = CASES.variation("v1")
    selection_pool = (
        Pipeline("selection", DatasetReader(available))
        .with_processor(Filter(lambda row: row["amount"] >= 100))  # high-value only
        .with_processor(Sort("amount", ascending=False))  # rank top-amount first
        .with_processor(Stamp("question_bank_id", variation.question_bank_id))
        .write_to(store.writer("gold", "selection_pool", RUN_ID, RUN_ID))
        .run()
    )

    print(
        f"available cases: {len(available)} -> "
        f"SelectionPool: {len(selection_pool)} cases "
        f"(Question Bank {variation.question_bank_id}, run {RUN_ID})"
    )


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: python -m pipelines.demo_source_to_selection <target_dir>"
        )
    main(sys.argv[1])
