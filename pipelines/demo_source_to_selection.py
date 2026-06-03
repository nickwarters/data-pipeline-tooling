"""Domain capstone demo: one Case Type, source feed → SelectionPool (#11).

Runs the full per-Case-Type path the framework exists to make routine, composing
the primitives the earlier slices built:

1. **Ingest** — land the bundled CSV feed into **raw** (accumulated, stamped
   ``run_id`` / ``load_date``), refine it into **silver** (accumulated, schema
   enforced), then reduce it to a current-only **gold** (one-row-per-Case via
   ``DeriveKey`` → ``LatestPerKey`` → ``UniqueValidator`` → ``Refresh``).
   Gold *is* the CasePool (ADR-0006 amendment).
2. **Selection** — a :class:`~framework.case_pool.CasePool` fetches the
   **available cases** from gold (activity within the working-day window), and a
   Selection :class:`~framework.builder.Pipeline` narrows them with specific
   Python processors (filter the low-value cases out, rank highest-amount first),
   stamps the chosen :class:`~framework.case_type.Variation`'s
   ``question_bank_id``, and accumulates the **SelectionPool** into ``gold``
   stamped ``run_id`` / ``load_date`` (ADR-0006). ``.explain(...)`` lands a
   sibling **SelectionTrace** alongside it — a per-Case verdict of why each
   available Case was or wasn't selected (#53, ADR-0007 amendment 02).

Run from the repo root as a module so the import-only ``framework`` package
resolves on ``sys.path``::

    python -m pipelines.demo_source_to_selection /tmp/demo

The ``as_of`` date is fixed so the working-day window lines up with the bundled
sample feed and the run is deterministic.
"""

from __future__ import annotations

import sys
import uuid
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from framework.builder import Pipeline
from framework.calendar import WorkingDayCalendar
from framework.case_pool import CasePool
from framework.case_type import CaseType, Variation
from framework.gold import ingest_silver_to_gold
from framework.processors import Filter, Sort, Stamp
from framework.readers import CsvReader, DatasetReader
from framework.silver import raw_to_silver
from framework.store import Store
from framework.strategy import AccumulateByRun


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

# Stable namespace for deterministic case_id derivation — uuid5(NAMESPACE_DNS,
# Case Type name) so each Case Type has its own UUID space (ADR-0009).
CASE_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, CASES.name)

# Fixed so the working-day window aligns with the bundled feed (Fri 2026-05-29);
# doubles as the Ingest run_id / load_date idempotency key (ADR-0006).
AS_OF = date(2026, 5, 29)
RUN_ID = AS_OF.isoformat()


def main(target_dir: str) -> None:
    sample = Path(__file__).parent / "sample_data" / "activity_cases.csv"
    store = Store(Path(target_dir) / CASES.name)

    # 1. Ingest: CSV feed -> raw (accumulate, system-of-record) -> silver
    #    (accumulate, schema enforced) -> gold (current-only, one row per Case).
    Pipeline("cases", CsvReader(sample)).write_to(
        store.writer("raw", "cases", AccumulateByRun(RUN_ID, RUN_ID))
    ).run()
    raw_to_silver(store, "cases", CASES.schema, strategy=AccumulateByRun(RUN_ID, RUN_ID)).run()
    ingest_silver_to_gold(store, "cases", namespace=CASE_NAMESPACE, natural_key=["case_ref"]).run()

    # 2. Selection: fetch the available cases from the CasePool, then narrow them.
    pool = CasePool(CASES, store, WorkingDayCalendar())
    available = pool.fetch_available_cases(
        as_of=AS_OF, activity_column="activity_date", within_working_days=5
    )
    variation = CASES.variation("v1")
    selection_pool = (
        Pipeline("selection", DatasetReader(available))
        .with_processor(Filter(lambda row: row["amount"] >= 100, name="high-value"))
        .with_processor(Sort("amount", ascending=False))  # rank top-amount first
        .with_processor(Stamp("question_bank_id", variation.question_bank_id))
        # Explainability (#53): land a per-Case trace of why each available Case
        # was/wasn't selected in a sibling table, stamped by this run.
        .explain(
            store.writer("gold", "selection_trace", AccumulateByRun(RUN_ID, RUN_ID)),
            id_column="case_ref",
        )
        .write_to(store.writer("gold", "selection_pool", AccumulateByRun(RUN_ID, RUN_ID)))
        .run()
    )

    trace = store.reader("gold", "selection_trace").read()
    excluded = sum(1 for v in trace.to_pandas()["verdict"] if v == "excluded")
    print(
        f"available cases: {len(available)} -> "
        f"SelectionPool: {len(selection_pool)} cases "
        f"(Question Bank {variation.question_bank_id}, run {RUN_ID}); "
        f"trace: {len(trace)} considered, {excluded} excluded with a reason"
    )


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: python -m pipelines.demo_source_to_selection <target_dir>"
        )
    main(sys.argv[1])
