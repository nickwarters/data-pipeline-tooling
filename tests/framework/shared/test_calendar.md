```python
from datetime import date

from framework.shared.calendar import WorkingDayCalendar


def test_last_n_working_days_skips_weekends_most_recent_first():
    # From Monday, the two most recent working days are that Monday and the
    # preceding Friday — the intervening Sat/Sun are not working days.
    cal = WorkingDayCalendar()  # default Sat/Sun weekend, no holidays
    monday = date(2026, 1, 5)

    assert cal.last_n_working_days(2, monday) == [
        date(2026, 1, 5),  # Monday (most recent first)
        date(2026, 1, 2),  # Friday — Sat 3rd / Sun 4th skipped
    ]


def test_last_n_working_days_skips_configured_holidays():
    # A holiday is non-working even on a weekday, so the window reaches further
    # back to gather its full count.
    cal = WorkingDayCalendar(holidays=[date(2026, 1, 1)])  # New Year (Thu)
    friday = date(2026, 1, 2)

    assert cal.last_n_working_days(2, friday) == [
        date(2026, 1, 2),  # Friday
        date(2025, 12, 31),  # Wednesday — Thu 1st (holiday) skipped
    ]


def test_last_n_working_days_from_a_weekend_starts_at_prior_working_day():
    # Invoked on a Saturday: the window is anchored at the previous Friday — the
    # Saturday itself is not a working day and is not counted.
    cal = WorkingDayCalendar()
    saturday = date(2026, 1, 3)

    assert cal.last_n_working_days(2, saturday) == [
        date(2026, 1, 2),  # Friday
        date(2026, 1, 1),  # Thursday
    ]


def test_last_n_working_days_from_a_holiday_starts_at_prior_working_day():
    # The same boundary handling applies when from_date is itself a holiday.
    cal = WorkingDayCalendar(holidays=[date(2026, 1, 2)])  # Friday off
    friday = date(2026, 1, 2)

    assert cal.last_n_working_days(1, friday) == [date(2026, 1, 1)]  # Thursday


def test_custom_weekend_rule_is_respected():
    # A Fri/Sat weekend (e.g. some regions): Sunday is a working day, Friday is
    # not, so the window steps over Fri/Sat rather than Sat/Sun.
    cal = WorkingDayCalendar(weekend=(4, 5))  # Friday=4, Saturday=5
    sunday = date(2026, 1, 4)

    assert cal.last_n_working_days(2, sunday) == [
        date(2026, 1, 4),  # Sunday — a working day under this rule
        date(2026, 1, 1),  # Thursday — Fri 2nd / Sat 3rd skipped
    ]


def test_is_working_day_distinguishes_weekend_holiday_and_normal_days():
    cal = WorkingDayCalendar(holidays=[date(2026, 1, 1)])
    assert cal.is_working_day(date(2026, 1, 2)) is True  # ordinary Friday
    assert cal.is_working_day(date(2026, 1, 3)) is False  # Saturday
    assert cal.is_working_day(date(2026, 1, 1)) is False  # holiday (Thursday)

```
