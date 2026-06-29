"""Tests for the case-selection example.

Three layers, narrow to wide:

1. the pure rules (a row ``dict`` + a date, no Pipeline) — each selection
   criterion has a focused unit test;
2. :func:`select_cases` over synthetic rows — the per-adviser orchestration,
   including the capacity and type-C-quota cases that the bundled sample also
   carries;
3. the builder and the full ``run`` over the bundled CSVs — the framework wiring,
   schema enforcement, and gold write end to end.
"""

from __future__ import annotations

from datetime import date

from framework.run import RunContext
from pipelines.case_selection import rules
from pipelines.case_selection.pipeline import SUBJECT, run
from pipelines.case_selection.selection import SelectCasesToCheck, select_cases
from tests.framework_testing import given_rows, read_rows
from tools.medallion import medallion
from tools.store import StoreRegistry

AS_OF = date(2026, 6, 25)


def _review(**over):
    base = {
        "adviser": "adv001",
        "case_type": "A",
        "status": "completed",
        "outcome": "pass",
        "selected_date": date(2026, 1, 10),
        "completed_date": date(2026, 1, 25),
    }
    base.update(over)
    return base


# --- 1. the pure rules ------------------------------------------------------
def test_case_type_bands_follow_the_risk_score():
    assert rules.case_type_for_score(149) == "A"
    assert rules.case_type_for_score(150) == "B"
    assert rules.case_type_for_score(249) == "B"
    assert rules.case_type_for_score(250) == "C"
    assert rules.case_type_for_score(900) == "C"


def test_recency_window_is_the_last_15_days_on_or_before_as_of():
    assert rules.is_recent_sale(date(2026, 6, 25), AS_OF)
    assert rules.is_recent_sale(date(2026, 6, 11), AS_OF)
    assert not rules.is_recent_sale(date(2026, 6, 10), AS_OF)  # 15 days -> out
    assert not rules.is_recent_sale(date(2026, 6, 26), AS_OF)  # future


def test_rolling_window_is_counted_by_calendar_month():
    assert rules.in_rolling_window(date(2025, 7, 1), AS_OF)  # 12th month back
    assert not rules.in_rolling_window(date(2025, 6, 30), AS_OF)  # 13th -> out
    assert rules.in_rolling_window(date(2026, 6, 30), AS_OF)  # current month


def test_best_sale_takes_highest_risk_then_category_a_over_b():
    sales = [
        {"sale_id": "S1", "risk_score": 180, "category": "B"},
        {"sale_id": "S2", "risk_score": 180, "category": "A"},
        {"sale_id": "S3", "risk_score": 90, "category": "A"},
    ]
    assert rules.best_sale(sales)["sale_id"] == "S2"


def test_in_progress_case_blocks_selection():
    assert rules.has_case_in_progress([_review(status="in_progress", outcome="none")])
    assert not rules.has_case_in_progress([_review()])


def test_check_capacity_target_is_pro_rata_by_active_sales_months():
    full_year = _sales_in_months(12)  # 12 active months -> target 10
    nine = [_review(selected_date=date(2026, 1, 1)) for _ in range(9)]
    assert not rules.at_check_capacity(nine, full_year, AS_OF)
    assert rules.at_check_capacity(nine + [_review()], full_year, AS_OF)  # 10 -> full
    # Fewer active months scale the target down: 6 active months -> target 5.
    half_year = _sales_in_months(6)
    five = [_review(selected_date=date(2026, 1, 1)) for _ in range(5)]
    assert rules.check_target(half_year, AS_OF) == 5
    assert rules.at_check_capacity(five, half_year, AS_OF)  # 5 >= 5 -> capacity
    assert not rules.at_check_capacity(five[:4], half_year, AS_OF)  # 4 < 5


def test_failed_review_imposes_a_28_day_cooldown():
    recent_fail = _review(outcome="fail", completed_date=date(2026, 6, 10))
    assert rules.blocked_by_failed_review([recent_fail], AS_OF)
    old_fail = _review(outcome="fail", completed_date=date(2026, 5, 1))
    assert not rules.blocked_by_failed_review([old_fail], AS_OF)


def test_minimum_21_day_gap_between_completed_and_next_selection():
    recent = _review(completed_date=date(2026, 6, 10))
    assert rules.too_soon_since_last_case([recent], AS_OF)
    older = _review(completed_date=date(2026, 6, 1))
    assert not rules.too_soon_since_last_case([older], AS_OF)


def test_type_c_quota_forces_c_when_slots_run_out():
    sales = _sales_in_months(5)  # 5 active months -> target 4
    # 2 checks done, 0 of them C: 2 slots left, 2 C still required -> force C even
    # though a score of 100 is naturally type A.
    history = [_review(selected_date=date(2026, 1, 1), case_type="A") for _ in range(2)]
    assert rules.assign_case_type(100, history, sales, AS_OF) == "C"
    # With a C already banked the shortfall is 1, so the low score stays type A.
    history[0] = _review(selected_date=date(2026, 1, 1), case_type="C")
    assert rules.assign_case_type(100, history, sales, AS_OF) == "A"


# --- 2. select_cases over synthetic rows ------------------------------------
def _sale(adviser, risk_score, category="A", sale_id="S", sale_date=date(2026, 6, 20)):
    return {
        "sale_id": sale_id,
        "adviser": adviser,
        "sale_date": sale_date,
        "risk_score": risk_score,
        "category": category,
        "product": "isa",
    }


def _sales_in_months(n, adviser="adv001"):
    """``n`` sales, one in each of the ``n`` rolling months ending at ``AS_OF``.

    Gives the adviser ``n`` *active* months, so ``check_target`` pro-rata's their
    capacity to ``round(10 * n / 12)``.
    """
    out = []
    year, month = AS_OF.year, AS_OF.month
    for i in range(n):
        out.append(_sale(adviser, 100, sale_id=f"S{i}", sale_date=date(year, month, 5)))
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return out


def test_select_cases_picks_one_per_adviser_and_explains_exclusions():
    sales = [
        _sale("clean", 300, sale_id="S1"),
        _sale("busy", 300, sale_id="S2"),
        _sale("stale", 300, sale_id="S3", sale_date=date(2026, 1, 1)),  # not recent
    ]
    reviews = [_review(adviser="busy", status="in_progress", outcome="none")]

    pool, trace = select_cases(sales, reviews, AS_OF)

    assert [r["adviser"] for r in pool] == ["clean"]
    assert pool[0]["case_type"] == "C"  # 300 -> C
    verdicts = {r["adviser"]: r["verdict"] for r in trace}
    assert verdicts == {"clean": "selected", "busy": "excluded"}
    # "stale" had no recent sale, so it is not even a considered adviser.
    assert "stale" not in verdicts


# --- 3. the builder and the full run ----------------------------------------
def test_selection_builder_runs_in_memory_with_recording_writers():
    from tests.framework_testing import RecordingWriter

    sales = given_rows([_sale("adv001", 260, sale_id="S1")])
    reviews = given_rows([])  # clean adviser
    writer = RecordingWriter()
    selector = SelectCasesToCheck(reviews, AS_OF)

    from pipelines.case_selection.pipeline import selection_builder

    selection_builder(sales, selector, writer).run()

    assert len(writer.writes) == 1
    (landed,) = writer.writes
    rows = landed.to_pandas().to_dict("records")
    assert [r["adviser"] for r in rows] == ["adv001"]
    assert rows[0]["case_type"] == "C"
    assert [r["adviser"] for r in selector.trace] == ["adv001"]


def test_run_assembles_the_selection_pool_from_the_bundled_feeds(tmp_path):
    pool = run(RunContext(base_dir=tmp_path, pipeline=SUBJECT, run_date=AS_OF))
    med = medallion(StoreRegistry(tmp_path), SUBJECT)

    selection_pool = read_rows(med.gold, "selection_pool")
    # One Case per eligible adviser, highest-risk first. Case types show all four
    # outcomes: C by score (adv008), B by score (adv001), C forced by the type-C
    # quota (adv006, a low-risk sale), and A by score (adv007).
    assert [r["adviser"] for r in selection_pool] == [
        "adv008",
        "adv001",
        "adv006",
        "adv007",
    ]
    assert [r["case_type"] for r in selection_pool] == ["C", "B", "C", "A"]
    # adv001 picked its category-A sale over the equal-risk category-B one.
    assert (
        next(r for r in selection_pool if r["adviser"] == "adv001")["sale_id"] == "S001"
    )
    assert len(selection_pool) == len(pool)

    trace = read_rows(med.gold, "selection_trace")
    reasons = {r["adviser"]: r["reason"] for r in trace if r["verdict"] == "excluded"}
    assert "in progress" in reasons["adv002"]
    # adv003 is excluded by the pro-rata capacity (5 checks, 6 active months).
    assert "capacity" in reasons["adv003"] and "pro-rata" in reasons["adv003"]
    # adv004 clears the 21-day gap but not the longer 28-day failed-review cooldown.
    assert "cooldown" in reasons["adv004"]
    assert "21 days" in reasons["adv005"]
