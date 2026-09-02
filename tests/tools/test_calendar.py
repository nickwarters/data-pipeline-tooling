"""Test YAML-seeded working-day arithmetic and operator-facing errors."""

import datetime as dt
import re

import pytest

from tools.calendar import WorkingDayCalendar


def _calendar_file(tmp_path, text):
    path = tmp_path / "calendar.yml"
    path.write_text(text, encoding="utf-8")
    return path


def test_holidays_are_seeded_over_the_default_weekend(tmp_path):
    path = _calendar_file(
        tmp_path,
        """
holidays:
  - 2026-05-25
  - 2026-12-25
""",
    )

    calendar = WorkingDayCalendar.from_yaml(path)

    # 25 May is the holiday; adjacent dates cover weekday and weekend defaults.
    assert calendar.is_working_day(dt.date(2026, 5, 25)) is False
    assert calendar.is_working_day(dt.date(2026, 5, 26)) is True
    assert calendar.is_working_day(dt.date(2026, 5, 22)) is True
    assert calendar.is_working_day(dt.date(2026, 5, 23)) is False
    assert calendar.is_working_day(dt.date(2026, 5, 24)) is False


def test_quoted_dates_are_accepted(tmp_path):
    path = _calendar_file(tmp_path, "holidays: ['2026-05-25', \"2026-12-25\"]\n")

    calendar = WorkingDayCalendar.from_yaml(path)

    assert calendar.is_working_day(dt.date(2026, 5, 25)) is False
    assert calendar.is_working_day(dt.date(2026, 12, 25)) is False


def test_a_named_weekend_is_case_insensitive(tmp_path):
    path = _calendar_file(tmp_path, "weekend: [Friday, saturday]\n")

    calendar = WorkingDayCalendar.from_yaml(path)

    assert calendar.is_working_day(dt.date(2026, 5, 22)) is False  # Friday
    assert calendar.is_working_day(dt.date(2026, 5, 23)) is False  # Saturday
    assert calendar.is_working_day(dt.date(2026, 5, 24)) is True  # Sunday works


def test_an_empty_weekend_list_means_every_day_works(tmp_path):
    path = _calendar_file(tmp_path, "weekend: []\n")

    calendar = WorkingDayCalendar.from_yaml(path)

    assert calendar.is_working_day(dt.date(2026, 5, 23)) is True  # Saturday
    assert calendar.is_working_day(dt.date(2026, 5, 24)) is True  # Sunday


def test_a_seeded_holiday_shifts_the_availability_window(tmp_path):
    # The Availability/CasePool side of the same seam: "the last N working days"
    # must step over a seeded holiday, not just the weekend.
    path = _calendar_file(tmp_path, "holidays: [2026-05-25]\n")

    calendar = WorkingDayCalendar.from_yaml(path)

    assert calendar.last_n_working_days(3, dt.date(2026, 5, 26)) == [
        dt.date(2026, 5, 26),  # Tuesday
        dt.date(2026, 5, 22),  # Friday — Monday 25th is the holiday
        dt.date(2026, 5, 21),  # Thursday
    ]


@pytest.mark.parametrize(
    "text, fragment",
    [
        pytest.param("- 2026-05-25\n", "must contain a mapping", id="not-a-mapping"),
        pytest.param("", "must contain a mapping", id="empty-document"),
        pytest.param("holyday: [2026-05-25]\n", "unknown key 'holyday'", id="unknown"),
        pytest.param(
            "holidays: 2026-05-25\n",
            "holidays must be a list of YYYY-MM-DD dates",
            id="holidays-not-a-list",
        ),
        pytest.param(
            "holidays: [2026-05-25, next monday]\n",
            "holidays[1] must be a YYYY-MM-DD date, got 'next monday'",
            id="unparseable-date",
        ),
        pytest.param(
            "holidays: [2026-05-25 09:00:00]\n",
            "holidays[0] must be a YYYY-MM-DD date, got a date-time",
            id="date-time",
        ),
        pytest.param(
            "weekend: monday\n",
            "weekend must be a list of weekday names",
            id="weekend-bare-string",
        ),
        pytest.param(
            "weekend: [funday]\n",
            "unknown weekday name 'funday'; expected one of: monday",
            id="unknown-weekday",
        ),
    ],
)
def test_a_malformed_calendar_file_names_the_problem_and_the_path(
    tmp_path, text, fragment
):
    path = _calendar_file(tmp_path, text)

    with pytest.raises(ValueError, match=re.escape(fragment)) as caught:
        WorkingDayCalendar.from_yaml(path)

    assert str(path) in str(caught.value)


def test_a_missing_calendar_file_is_an_operator_error(tmp_path):
    path = tmp_path / "absent.yml"

    with pytest.raises(ValueError, match="no calendar file at") as caught:
        WorkingDayCalendar.from_yaml(path)

    assert str(path) in str(caught.value)


def test_a_directory_passed_as_a_calendar_file_is_an_operator_error(tmp_path):
    # Not a FileNotFoundError: the read fails with a different OSError, which
    # must still surface as the operator-facing ValueError, not a traceback.
    directory = tmp_path / "calendars"
    directory.mkdir()

    with pytest.raises(ValueError, match="cannot read calendar file") as caught:
        WorkingDayCalendar.from_yaml(directory)

    assert str(directory) in str(caught.value)


def test_invalid_yaml_is_reported_as_a_value_error(tmp_path):
    path = _calendar_file(tmp_path, "holidays: [2026-05-25\nweekend: ]\n")

    with pytest.raises(ValueError, match="is not valid YAML") as caught:
        WorkingDayCalendar.from_yaml(path)

    assert str(path) in str(caught.value)
