from datetime import date

import pandas as pd

from case_review.case_pool import CasePool
from case_review.case_type import CaseType, Variation
from framework.calendar import WorkingDayCalendar
from framework.dataset import Dataset
from framework.store import Store
from framework.strategy import Refresh
from tests._schema_fixtures import ActivityCase


def _case_type() -> CaseType:
    return CaseType(
        name="cases",
        schema=ActivityCase,
        natural_key=("case_ref",),
        variations=(Variation(id="v1", question_bank_id="qb-100"),),
    )


def _land_gold_cases(store: Store, frame: pd.DataFrame) -> None:
    # Land Cases into the ingest gold exactly as an ingest_silver_to_gold run
    # would — one row per Case, dates as text (SQLite has no date type), which
    # is what the CasePool re-reads (ADR-0006 amendment).
    store.writer("gold", "cases", Refresh()).write(Dataset.from_pandas(frame))


def test_fetch_available_cases_keeps_only_cases_inside_the_working_day_window(
    tmp_path,
):
    # "Available cases" are the eligible candidates: activity dated within the
    # last N working days of as_of (CONTEXT.md). The CasePool reads the ingested
    # silver and narrows to that window using the WorkingDayCalendar — the domain
    # retrieval Selection calls instead of a raw read.
    store = Store(tmp_path / "cases")
    _land_gold_cases(
        store,
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2", "c3", "c4"],
                "adviser": ["a1", "a2", "a3", "a4"],
                # as_of is Fri 2026-05-29; last 3 working days = 27, 28, 29 May.
                "activity_date": [
                    "2026-05-29",  # in window (Fri, as_of)
                    "2026-05-27",  # in window (Wed)
                    "2026-05-22",  # out (the Fri before the window)
                    "2026-05-30",  # out (Sat, after as_of)
                ],
                "amount": [100, 50, 75, 20],
            }
        ),
    )
    pool = CasePool(_case_type(), store, WorkingDayCalendar())

    available = pool.fetch_available_cases(
        as_of=date(2026, 5, 29),
        activity_column="activity_date",
        within_working_days=3,
    )

    assert sorted(available.to_pandas()["case_ref"]) == ["c1", "c2"]


def test_fetch_available_cases_returns_an_empty_pool_when_none_are_eligible(
    tmp_path,
):
    # No Case dated inside the window yields an empty pool, not an error — an
    # empty SelectionPool is a legitimate outcome a downstream run must tolerate.
    store = Store(tmp_path / "cases")
    _land_gold_cases(
        store,
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "adviser": ["a1"],
                "activity_date": ["2026-01-01"],
                "amount": [100],
            }
        ),
    )
    pool = CasePool(_case_type(), store, WorkingDayCalendar())

    available = pool.fetch_available_cases(
        as_of=date(2026, 5, 29),
        activity_column="activity_date",
        within_working_days=3,
    )

    assert len(available) == 0
