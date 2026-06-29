"""Tests for the friendly ``Schedule`` constructors (issue #248).

These exercise the ergonomic facade over the concrete schedule classes:
operator-friendly names map to the same ``is_due`` semantics, and bad input
fails with clear messages. The underlying classes are covered separately in
``test_scheduled_orchestrator.py``.
"""

import datetime as dt

import pytest

from tools.calendar import WorkingDayCalendar
from tools.orchestration import (
    DayOfMonth,
    LastWorkingDayOfMonth,
    ManualOnly,
    NthWorkingDayOfMonth,
    Schedule,
    SpecificWeekdays,
    Weekdays,
)

# June 2026: the 1st is a Monday; the 13th/14th are the weekend; the 15th is a
# seeded holiday (a Monday). The 30th is the last working day of the month.
HOLIDAY = dt.date(2026, 6, 15)
CALENDAR = WorkingDayCalendar(holidays={HOLIDAY})


def test_daily_runs_on_working_days_only():
    schedule = Schedule.daily()

    assert isinstance(schedule, Weekdays)
    assert schedule.is_due(dt.date(2026, 6, 12), CALENDAR)  # Friday
    assert not schedule.is_due(dt.date(2026, 6, 13), CALENDAR)  # Saturday
    assert not schedule.is_due(dt.date(2026, 6, 14), CALENDAR)  # Sunday
    assert not schedule.is_due(HOLIDAY, CALENDAR)  # holiday Monday


def test_on_weekdays_monday_and_wednesday():
    schedule = Schedule.on_weekdays("monday", "wednesday")

    assert isinstance(schedule, SpecificWeekdays)
    assert schedule.is_due(dt.date(2026, 6, 1), CALENDAR)  # Monday
    assert schedule.is_due(dt.date(2026, 6, 3), CALENDAR)  # Wednesday
    assert not schedule.is_due(dt.date(2026, 6, 2), CALENDAR)  # Tuesday


def test_on_weekdays_is_case_insensitive_and_ignores_surrounding_space():
    schedule = Schedule.on_weekdays("MONDAY", " Wednesday ")

    assert schedule == SpecificWeekdays([0, 2])


def test_on_weekdays_skips_weekends_and_holidays():
    schedule = Schedule.on_weekdays("monday")

    # The 15th is a Monday, but it is a seeded holiday, so it is not due.
    assert not schedule.is_due(HOLIDAY, CALENDAR)
    # A non-holiday Monday is due.
    assert schedule.is_due(dt.date(2026, 6, 1), CALENDAR)


def test_on_weekdays_rejects_unknown_name():
    with pytest.raises(ValueError, match="unknown weekday name 'funday'"):
        Schedule.on_weekdays("monday", "funday")


def test_on_weekdays_requires_at_least_one_name():
    with pytest.raises(ValueError, match="at least one weekday name"):
        Schedule.on_weekdays()


def test_day_of_month_on_a_working_day():
    schedule = Schedule.day_of_month(21)

    assert isinstance(schedule, DayOfMonth)
    # 21 May 2026 is a Thursday.
    assert schedule.is_due(dt.date(2026, 5, 21), CALENDAR)
    assert not schedule.is_due(dt.date(2026, 5, 20), CALENDAR)


def test_day_of_month_rejects_invalid_day():
    with pytest.raises(ValueError, match="day of month must be 1..31"):
        Schedule.day_of_month(32)


def test_nth_working_day_of_month_first():
    schedule = Schedule.nth_working_day_of_month(1)

    assert isinstance(schedule, NthWorkingDayOfMonth)
    # 1 June 2026 is the first working day (a Monday).
    assert schedule.is_due(dt.date(2026, 6, 1), CALENDAR)
    assert not schedule.is_due(dt.date(2026, 6, 2), CALENDAR)


def test_nth_working_day_of_month_rejects_non_positive():
    with pytest.raises(ValueError, match="working-day ordinal must be positive"):
        Schedule.nth_working_day_of_month(0)


def test_last_working_day_of_month():
    schedule = Schedule.last_working_day_of_month()

    assert isinstance(schedule, LastWorkingDayOfMonth)
    # 30 June 2026 is a Tuesday and the last working day of the month.
    assert schedule.is_due(dt.date(2026, 6, 30), CALENDAR)
    assert not schedule.is_due(dt.date(2026, 6, 29), CALENDAR)


def test_manual_only_never_due():
    schedule = Schedule.manual_only()

    assert isinstance(schedule, ManualOnly)
    assert not schedule.is_due(dt.date(2026, 6, 1), CALENDAR)
