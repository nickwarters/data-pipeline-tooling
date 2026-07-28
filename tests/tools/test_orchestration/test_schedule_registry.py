"""One declaration site per schedule.

A schedule used to be declared in three unrelated places: the class, a friendly
constructor on the base, and a string branch in the overrides parser carrying
its own bespoke key names. These tests hold the parser to a single site — a new
schedule reaches an operator's overrides file with no edit anywhere else — and
pin every key that existing overrides files already use.
"""

import datetime as dt

import pytest

from tools.calendar import WorkingDayCalendar
from tools.orchestration import (
    DayOfMonth,
    LastWorkingDayOfMonth,
    ManualOnly,
    NthWorkingDayOfMonth,
    Orchestrator,
    PipelineSet,
    Schedule,
    ScheduledPipeline,
    SpecificWeekdays,
    Weekdays,
    _schedule_from_config,
)

CALENDAR = WorkingDayCalendar()
MONDAY = dt.date(2026, 6, 22)


# ── every key an existing overrides file may already contain still parses ─────


@pytest.mark.parametrize(
    ("config", "expected"),
    [
        ("weekdays", Weekdays()),
        ("weekday", Weekdays()),
        ({"type": "weekdays"}, Weekdays()),
        # Hyphens and capitals are normalised, as they always were.
        ({"type": "Day-Of-Month", "day": 21}, DayOfMonth(21)),
        ({"type": "specific_weekdays", "weekdays": [0, 2]}, SpecificWeekdays([0, 2])),
        ({"type": "day_of_month", "day": 21}, DayOfMonth(21)),
        ({"type": "nth_working_day_of_month", "n": 2}, NthWorkingDayOfMonth(2)),
        ({"type": "last_working_day_of_month"}, LastWorkingDayOfMonth()),
        ({"type": "manual_only"}, ManualOnly()),
    ],
)
def test_existing_override_keys_still_parse(config, expected):
    assert _schedule_from_config(config) == expected


def test_unknown_override_type_still_fails_clearly():
    with pytest.raises(ValueError, match="unknown schedule override type"):
        _schedule_from_config({"type": "phase_of_the_moon"})


# ── a seventh schedule reaches YAML config from its class body alone ──────────


class EveryOtherTuesday(Schedule):
    """A throwaway seventh schedule, declared only here.

    Nothing else in the codebase mentions it: no friendly constructor, no branch
    in the overrides parser, no entry in any list. If it can be named from an
    overrides file, the parser genuinely has one declaration site per schedule.
    """

    config_key = "every_other_tuesday"

    @classmethod
    def from_config(cls, config):
        return cls(int(config["week_parity"]))

    def __init__(self, week_parity: int = 0) -> None:
        self.week_parity = week_parity

    def __eq__(self, other) -> bool:
        return (
            isinstance(other, EveryOtherTuesday)
            and other.week_parity == self.week_parity
        )

    def is_due(self, run_date: dt.date, calendar: WorkingDayCalendar) -> bool:
        return (
            run_date.weekday() == 1
            and run_date.isocalendar()[1] % 2 == self.week_parity
            and calendar.is_working_day(run_date)
        )

    def schedule_label(self) -> str:
        return "every other tuesday"


def test_a_new_schedule_is_configurable_from_its_class_body_alone():
    built = _schedule_from_config({"type": "every_other_tuesday", "week_parity": 1})

    assert built == EveryOtherTuesday(1)


def test_a_new_schedule_reaches_an_overrides_file_end_to_end(tmp_path):
    overrides = {
        "pipelines": [
            {
                "set": "cases",
                "pipeline": "ingest",
                "schedule": {"type": "every_other_tuesday", "week_parity": 1},
            }
        ]
    }
    sets = (PipelineSet("cases", (ScheduledPipeline("pipelines/ingest", Weekdays()),)),)
    orchestrator = Orchestrator(sets, CALENDAR, overrides=overrides)

    overridden = orchestrator._apply_override("cases", sets[0].pipelines[0])

    assert overridden.schedule == EveryOtherTuesday(1)


# ── a key belongs to exactly one schedule ─────────────────────────────────────


def test_a_config_key_cannot_be_claimed_twice():
    """Defining a second claimant fails at definition, not at an operator's file.

    Two classes claiming one key would otherwise resolve by definition order,
    which is invisible: an overrides file naming that key would quietly get
    whichever class happened to be defined last.
    """
    with pytest.raises(ValueError, match="already registered by"):

        class ImposterDayOfMonth(Schedule):
            config_key = "day_of_month"

    # The rejected class never entered the registry, so the real one still wins.
    assert Schedule.config_types()["day_of_month"] is DayOfMonth


def test_a_schedule_may_register_more_than_one_spelling():
    # Weekdays owns both its key and its legacy alias.
    types = Schedule.config_types()

    assert types["weekdays"] is Weekdays
    assert types["weekday"] is Weekdays


# ── each schedule explains a not-due date in its own terms ──────────────


@pytest.mark.parametrize(
    ("schedule", "expected_fragment"),
    [
        (Weekdays(), "daily is not due on monday"),
        (SpecificWeekdays([2]), "wednesday is not due on monday"),
        (DayOfMonth(21), "day 21 of month is not due on 2026-06-22"),
        (
            NthWorkingDayOfMonth(2),
            "2nd working day of month is not due on 2026-06-22",
        ),
        (
            LastWorkingDayOfMonth(),
            "last working day of month is not due on 2026-06-22",
        ),
        (ManualOnly(), "manual only is not due on 2026-06-22"),
    ],
)
def test_not_due_reason_speaks_the_schedule_s_own_language(schedule, expected_fragment):
    assert expected_fragment in schedule.not_due_reason(MONDAY)
