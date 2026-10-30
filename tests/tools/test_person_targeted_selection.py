from datetime import date

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import DatasetReader
from framework.run import read, transform
from tools.calendar import WorkingDayCalendar
from tools.person_targeted_selection import (
    AT_TARGET,
    CHECK_COLUMNS,
    CURRENT_COLUMNS,
    NO_ELIGIBLE_CASE,
    SELECTED,
    STATE_COLUMNS,
    WITHIN_CADENCE,
    PersonTargetedSelection,
    PersonTargetedSelectionConfig,
    active_months,
    best_case,
    check_verdict,
    checks_in_window,
    is_overdue,
    other_room,
    plan_checks,
    pro_rata,
    unservable_since,
)

CONFIG = PersonTargetedSelectionConfig(case_types=("q", "a", "b"), quota_case_type="q")
CALENDAR = WorkingDayCalendar()
AS_OF = date(2026, 10, 30)  # a Friday; the sale window opens Monday 12 October

# The rolling window ending October 2026, as (year, month).
WINDOW = [(2025, m) for m in range(11, 13)] + [(2026, m) for m in range(1, 11)]


def _history(adviser="adv", case_type="a", months=12):
    # One sale on the 1st of each of the last `months` window months: activity
    # only, since every 1st falls outside the sale window.
    return [
        _sale(adviser, case_type, f"h-{adviser}-{y}-{m}", 0, date(y, m, 1))
        for y, m in WINDOW[-months:]
    ]


def _sale(adviser, case_type, sale_id, risk, sale_date=date(2026, 10, 28)):
    return dict(
        adviser=adviser,
        case_type=case_type,
        sale_id=sale_id,
        sale_date=sale_date,
        risk_score=risk,
    )


def _checks(n, adviser="adv", case_type="a", month=(2026, 5), status="Completed"):
    return [
        dict(
            adviser=adviser,
            case_type=case_type,
            month=month,
            status=status,
            check_count=n,
        )
    ]


def _mixed(n, adviser="adv"):
    # n checks with the quota met: 2 from the quota Case Type, the rest from "a".
    return _checks(2, adviser, "q") + _checks(n - 2, adviser, "a")


def _current(adviser="adv", case_type="a", outstanding=0, last=None):
    return [
        dict(
            adviser=adviser,
            case_type=case_type,
            outstanding_case_count=outstanding,
            last_reportable_date=last,
        )
    ]


def _verdict(counts, sales, currents=(), voided=()):
    return check_verdict(
        counts, sales, list(currents), AS_OF, CONFIG, CALENDAR, voided_sale_ids=voided
    )


# --- the pro-rata basis -------------------------------------------------------


@pytest.mark.parametrize(
    ("months", "target", "quota"), [(12, 10, 2), (6, 5, 1), (3, 3, 1), (1, 1, 0)]
)
def test_the_target_and_the_quota_pro_rata_by_one_half_up_rule(months, target, quota):
    assert pro_rata(10, months, CONFIG) == target
    assert pro_rata(2, months, CONFIG) == quota


def test_an_active_month_is_one_with_a_sale_in_any_of_the_groups_case_types():
    sales = [
        _sale("adv", "a", "1", 0, date(2026, 3, 2)),
        _sale("adv", "b", "2", 0, date(2026, 3, 9)),  # same month: counted once
        _sale("adv", "q", "3", 0, date(2026, 4, 1)),
        _sale("adv", "elsewhere", "4", 0, date(2026, 5, 1)),  # not in the group
        _sale("adv", "a", "5", 0, date(2025, 10, 1)),  # before the window
    ]

    assert active_months(sales, AS_OF, CONFIG) == 2


def test_only_countable_checks_in_the_window_and_the_group_count():
    counts = [
        *_checks(3, case_type="a"),
        *_checks(2, case_type="q", status="Actions In Progress"),
        *_checks(4, case_type="b", status="Void"),
        *_checks(5, case_type="elsewhere"),
        *_checks(6, case_type="a", month=(2025, 10)),
    ]

    assert checks_in_window(counts, AS_OF, CONFIG) == 5


# --- the gates ----------------------------------------------------------------


def test_an_adviser_at_target_is_not_selected():
    verdict, _, sale = _verdict(_checks(10), _history() + [_sale("adv", "a", "s", 9)])

    assert (verdict, sale) == (AT_TARGET, None)


def test_one_outstanding_check_holds_the_adviser_across_the_group():
    verdict, reason, _ = _verdict(
        _checks(5),
        _history() + [_sale("adv", "a", "s", 9)],
        _current(case_type="b", outstanding=1),
    )

    assert verdict == WITHIN_CADENCE
    assert reason == "a check is outstanding"


def test_an_adviser_is_selectable_twenty_working_days_after_reportable():
    sales = _history() + [_sale("adv", "a", "s", 9)]

    eligible, _, _ = _verdict(_mixed(9), sales, _current(last=date(2026, 10, 2)))
    waiting, reason, _ = _verdict(_mixed(9), sales, _current(last=date(2026, 10, 5)))

    assert eligible == SELECTED
    assert (waiting, reason) == (WITHIN_CADENCE, "next eligible 2026-11-02")


def test_the_latest_reportable_across_the_group_sets_the_clock():
    sales = _history() + [_sale("adv", "a", "s", 9)]
    currents = _current(case_type="a", last=date(2026, 9, 1)) + _current(
        case_type="b", last=date(2026, 10, 5)
    )

    assert _verdict(_mixed(9), sales, currents)[0] == WITHIN_CADENCE


def test_behind_shortens_the_cadence_to_ten_working_days():
    sales = _history() + [_sale("adv", "a", "s", 9)]
    last = _current(last=date(2026, 10, 16))

    assert _verdict(_mixed(8), sales, last)[0] == SELECTED  # 2 short: Behind
    assert _verdict(_mixed(9), sales, last)[0] == WITHIN_CADENCE  # 1 short


def test_overdue_is_past_twenty_five_working_days_and_only_under_target():
    assert is_overdue(1, date(2026, 9, 24), AS_OF, CONFIG, CALENDAR) is True
    assert is_overdue(1, date(2026, 9, 25), AS_OF, CONFIG, CALENDAR) is False
    assert is_overdue(0, date(2026, 9, 24), AS_OF, CONFIG, CALENDAR) is False
    assert is_overdue(1, None, AS_OF, CONFIG, CALENDAR) is False


def test_a_sale_outside_the_working_day_window_is_not_eligible():
    too_old = _verdict(
        [], _history() + [_sale("adv", "a", "old", 9, date(2026, 10, 9))]
    )
    in_time = _verdict(
        [], _history() + [_sale("adv", "a", "new", 9, date(2026, 10, 12))]
    )

    assert too_old[0] == NO_ELIGIBLE_CASE
    assert in_time[2]["sale_id"] == "new"


def test_a_sale_that_produced_a_voided_case_is_not_selected_again():
    sales = _history() + [_sale("adv", "a", "dup", 99), _sale("adv", "a", "next", 1)]

    _, _, sale = _verdict([], sales, voided={"dup"})

    assert sale["sale_id"] == "next"


# --- which Case: the reserved quota and risk ---------------------------------


def test_risk_wins_over_the_quota_case_type_while_other_places_remain():
    sales = _history() + [
        _sale("adv", "q", "quota", 100),
        _sale("adv", "a", "other", 200),
    ]

    _, _, sale = _verdict([], sales)

    assert sale["sale_id"] == "other"


def test_after_eight_other_checks_only_the_quota_case_type_is_eligible():
    sales = _history() + [
        _sale("adv", "q", "quota", 50),
        _sale("adv", "a", "other", 300),
    ]

    _, _, sale = _verdict(_checks(8, case_type="a"), sales)

    assert sale["sale_id"] == "quota"


def test_after_eight_other_checks_with_no_quota_sale_there_is_no_eligible_case():
    sales = _history() + [_sale("adv", "a", "other", 300)]

    verdict, reason, sale = _verdict(_checks(8, case_type="a"), sales)

    assert (verdict, sale) == (NO_ELIGIBLE_CASE, None)
    assert "no q sale" in reason


def test_an_adviser_who_only_works_the_quota_case_type_meets_the_target_from_it():
    sales = _history(case_type="q") + [_sale("adv", "q", "quota", 5)]

    assert _verdict(_checks(9, case_type="q"), sales)[2]["sale_id"] == "quota"
    assert _verdict(_checks(10, case_type="q"), sales)[0] == AT_TARGET


def test_a_part_year_adviser_reserves_the_pro_rata_quota():
    # 3 active months: target 3, quota 1, so 2 places for other Case Types.
    sales = _history(months=3)

    assert other_room(_checks(1, case_type="b"), sales, AS_OF, CONFIG) == 1
    assert other_room(_checks(2, case_type="b"), sales, AS_OF, CONFIG) == 0


def test_risk_beats_the_spread_and_the_spread_breaks_equal_scores():
    checks = {"q": 0, "a": 0, "b": 3}

    risky = best_case(
        [_sale("adv", "a", "a1", 100), _sale("adv", "b", "b1", 200)], checks
    )
    tied = best_case(
        [_sale("adv", "b", "b1", 100), _sale("adv", "a", "a1", 100)], checks
    )
    same = best_case([_sale("adv", "a", "z", 100), _sale("adv", "a", "y", 100)], checks)

    assert risky["sale_id"] == "b1"
    assert tied["sale_id"] == "a1"
    assert same["sale_id"] == "y"


# --- the run ------------------------------------------------------------------


def test_selected_advisers_are_ordered_largest_shortfall_first():
    sales = [
        *_history("near"),
        _sale("near", "a", "near-sale", 999),
        *_history("far"),
        _sale("far", "a", "far-sale", 1),
    ]
    counts = _mixed(9, adviser="near") + _mixed(2, adviser="far")

    selected, _ = plan_checks(sales, counts, [], AS_OF, CONFIG, CALENDAR)

    assert [s["sale_id"] for s in selected] == ["far-sale", "near-sale"]


def test_every_adviser_in_the_roster_gets_a_state_row():
    sales = [*_history("served"), _sale("served", "a", "s", 1), *_history("starved")]
    sales.append(_sale("outsider", "elsewhere", "x", 1))  # not in the group

    _, state = plan_checks(sales, [], [], AS_OF, CONFIG, CALENDAR)

    assert {r["adviser"]: r["verdict"] for r in state} == {
        "served": SELECTED,
        "starved": NO_ELIGIBLE_CASE,
    }


def test_unservable_since_carries_a_streak_forward_and_clears_it():
    earlier = date(2026, 10, 1)
    streak = {"verdict": NO_ELIGIBLE_CASE, "unservable_since": earlier}

    assert unservable_since(None, NO_ELIGIBLE_CASE, AS_OF) == AS_OF
    assert unservable_since(streak, NO_ELIGIBLE_CASE, AS_OF) == earlier
    assert unservable_since(streak, SELECTED, AS_OF) is None
    assert unservable_since({"verdict": SELECTED}, NO_ELIGIBLE_CASE, AS_OF) == AS_OF


# --- the processor ------------------------------------------------------------


def _frame(rows, columns=None):
    return Dataset.from_pandas(pd.DataFrame(list(rows), columns=columns))


def _processor(checks=(), current=(), **overrides):
    # Months arrive as stored, "YYYY-MM"; an empty input still has its columns.
    check_rows = [
        {**c, "month": f"{c['month'][0]}-{c['month'][1]:02d}"} for c in checks
    ]
    return PersonTargetedSelection(
        CONFIG,
        checks=_frame(check_rows, CHECK_COLUMNS),
        current=_frame(current, CURRENT_COLUMNS),
        as_of=AS_OF,
        calendar=CALENDAR,
        **overrides,
    )


def _sales_dataset():
    rows = [
        *_history("adv"),
        _sale("adv", "a", "chosen", 50),
        _sale("adv", "b", "passed-over", 10),
    ]
    frame = pd.DataFrame(rows)
    frame["sale_date"] = frame["sale_date"].map(date.isoformat)  # as stored
    frame["branch"] = "north"
    return Dataset.from_pandas(frame)


def test_the_processor_returns_the_chosen_sales_with_every_column():
    selected = _processor()(_sales_dataset()).to_pandas()

    assert selected["sale_id"].tolist() == ["chosen"]
    assert selected["branch"].tolist() == ["north"]


def test_plan_returns_one_state_row_per_adviser():
    plan = _processor(checks=_checks(3), current=_current(last=date(2026, 9, 1))).plan(
        _sales_dataset()
    )

    advisers = plan.advisers.to_pandas()
    assert list(advisers.columns) == list(STATE_COLUMNS)
    row = advisers.iloc[0]
    assert (row["adviser"], row["verdict"], row["shortfall"]) == ("adv", SELECTED, 7)
    assert row["sale_id"] == "chosen"


def test_the_previous_state_carries_unservable_since_forward():
    previous = _frame(
        [dict(adviser="adv", verdict=NO_ELIGIBLE_CASE, unservable_since="2026-10-01")]
    )
    sales = Dataset.from_pandas(pd.DataFrame(_history("adv")))

    plan = _processor(previous=previous).plan(sales)

    assert plan.advisers.to_pandas().iloc[0]["unservable_since"] == date(2026, 10, 1)


def test_it_runs_as_an_eager_transform_step():
    selected = transform(_processor(), read(DatasetReader(_sales_dataset())))

    assert selected.to_pandas()["sale_id"].tolist() == ["chosen"]


def test_a_missing_column_is_named():
    sales = Dataset.from_pandas(pd.DataFrame([{"adviser": "adv"}]))

    with pytest.raises(ValueError, match="not found in sales.*case_type"):
        _processor()(sales)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        (dict(case_types=()), "at least one case type"),
        (dict(case_types=("a", "a")), "must not repeat"),
        (dict(quota_case_type="z"), "must be one of"),
        (dict(case_type_quota=11), "between 0 and"),
        (dict(behind_band=0), "at least 1"),
        (dict(catch_up_cadence_days=21), "cadence must satisfy"),
        (dict(due_days=19), "cadence must satisfy"),
    ],
)
def test_the_config_is_checked_when_built(overrides, message):
    settings = dict(case_types=("q", "a"), quota_case_type="a")
    settings.update(overrides)

    with pytest.raises(ValueError, match=message):
        PersonTargetedSelectionConfig(**settings)
