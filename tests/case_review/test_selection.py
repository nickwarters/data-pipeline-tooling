from datetime import date

import pandas as pd

from case_review.case_pool import CasePool
from case_review.case_type import CaseType, Variation
from framework.io.dataset import Dataset
from framework.io.readers import DatasetReader
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun, Refresh
from framework.run.builder import Pipeline
from framework.shared.calendar import WorkingDayCalendar
from framework.transform.processors import Filter, Sort, Stamp
from tests._schema_fixtures import ActivityCase


def _case_type() -> CaseType:
    return CaseType(
        name="cases",
        schema=ActivityCase,
        natural_key=("case_ref",),
        variations=(
            Variation(id="v1", question_bank_id="qb-100"),
            Variation(id="v2", question_bank_id="qb-200"),
        ),
    )


def _land_gold_cases(store: Store, frame: pd.DataFrame) -> None:
    # Land Cases into ingest gold (current-only, one row per Case) as an
    # ingest_silver_to_gold run would — CasePool reads gold.
    store.writer("gold", "cases", Refresh()).write(Dataset.from_pandas(frame))


def test_selection_narrows_the_casepool_into_a_stamped_selection_pool(tmp_path):
    # Acceptance: the full source->selection path for one Case Type. Ingest
    # has landed Cases into silver; the Selection pipeline fetches available cases
    # from the CasePool, narrows them with specific Python processors (a high-value
    # filter, a sort), stamps the chosen Variation's question_bank_id, and writes
    # the SelectionPool into gold stamped run_id / load_date (CONTEXT.md; ).
    store = Store(tmp_path / "cases")
    _land_gold_cases(
        store,
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2", "c3", "c4"],
                "adviser": ["a1", "a2", "a3", "a4"],
                # as_of Fri 2026-05-29; last 3 working days = 27, 28, 29 May.
                "activity_date": [
                    "2026-05-29",  # available, amount 100 -> selected
                    "2026-05-28",  # available, amount 20  -> filtered out
                    "2026-05-27",  # available, amount 200 -> selected
                    "2026-05-22",  # not available (before the window)
                ],
                "amount": [100, 20, 200, 500],
            }
        ),
    )
    case_type = _case_type()
    pool = CasePool(case_type, store, WorkingDayCalendar())
    variation = case_type.variation("v2")

    available = pool.fetch_available_cases(
        as_of=date(2026, 5, 29),
        activity_column="activity_date",
        within_working_days=3,
    )

    (
        Pipeline("selection", DatasetReader(available))
        .with_processor(Filter(lambda row: row["amount"] >= 100))
        .with_processor(Sort("amount", ascending=False))
        .with_processor(Stamp("question_bank_id", variation.question_bank_id))
        .write_to(
            store.writer(
                "gold", "selection_pool", AccumulateByRun("2026-05-29", "2026-05-29")
            )
        )
        .run()
    )

    selection_pool = store.reader("gold", "selection_pool").read().to_pandas()
    # c4 excluded by availability, c2 by the amount filter; the survivors are
    # ranked highest-amount first and all carry v2's Question Bank + run stamps.
    assert list(selection_pool["case_ref"]) == ["c3", "c1"]
    assert set(selection_pool["question_bank_id"]) == {"qb-200"}
    assert set(selection_pool["run_id"]) == {"2026-05-29"}
    assert set(selection_pool["load_date"]) == {"2026-05-29"}
