"""The three ordering inputs on ``ScheduledPipeline``, parsed and validated.

The values arrive from hand-written schedule modules, so they are checked at
construction and stored parsed. Nothing downstream re-parses them, and nothing
downstream sees a half-valid one: a malformed time or a non-int priority fails
where it is written, naming the offending value.
"""

import datetime as dt
from dataclasses import replace

import pytest

from framework.run import FreshnessRequirement
from tools.orchestration import (
    ManualOnly,
    ScheduledPipeline,
    SpecificWeekdays,
    Weekdays,
)


def _item(**kwargs) -> ScheduledPipeline:
    return ScheduledPipeline("pipelines/ingest", Weekdays(), **kwargs)


# ── "HH:MM" parsing ───────────────────────────────────────────────────────────


def test_a_zero_padded_time_parses_into_a_time():
    item = _item(due_time="09:30", earliest_run="06:05")

    assert item.due_time == dt.time(9, 30)
    assert item.earliest_run == dt.time(6, 5)


def test_midnight_and_the_last_minute_of_the_day_are_both_valid():
    assert _item(due_time="00:00").due_time == dt.time(0, 0)
    assert _item(due_time="23:59").due_time == dt.time(23, 59)


def test_an_omitted_time_stays_none():
    item = _item()

    assert item.due_time is None
    assert item.earliest_run is None


def test_an_already_parsed_time_passes_through_unchanged():
    # dataclasses.replace re-invokes this constructor with the parsed value, so
    # a time must round-trip or every override would fail.
    moment = dt.time(9, 30)

    assert _item(due_time=moment).due_time is moment


@pytest.mark.parametrize("value", ["9:5", "24:00", "09:60", "0900", "09:30:00", ""])
def test_a_malformed_time_is_rejected_naming_the_value(value):
    with pytest.raises(ValueError, match="due_time") as caught:
        _item(due_time=value)

    assert repr(value) in str(caught.value)


def test_a_non_string_time_is_rejected_naming_the_value():
    with pytest.raises(ValueError, match="earliest_run") as caught:
        _item(earliest_run=930)

    assert "930" in str(caught.value)


# ── priority ──────────────────────────────────────────────────────────────────


def test_priority_defaults_to_zero_and_accepts_negatives():
    assert _item().priority == 0
    assert _item(priority=-5).priority == -5


@pytest.mark.parametrize("value", ["3", 3.7, None, True])
def test_a_non_int_priority_is_rejected_naming_the_value(value):
    # Not coerced: int("3") would pass silently and int(3.7) would truncate. A
    # bool is an int subclass, and True as a priority is a mistake, not the
    # number 1.
    with pytest.raises(ValueError, match="priority") as caught:
        _item(priority=value)

    assert repr(value) in str(caught.value)


# ── the `deadline` spelling ───────────────────────────────────────────────────


def test_deadline_is_normalised_into_due_time_at_the_boundary():
    item = _item(deadline="09:30")

    assert item.due_time == dt.time(9, 30)
    assert not hasattr(item, "deadline")


def test_declaring_both_spellings_is_rejected():
    with pytest.raises(ValueError, match="due_time or deadline"):
        _item(due_time="09:30", deadline="10:00")


# ── overrides preserve the ordering inputs ────────────────────────────────────


def _full_item() -> ScheduledPipeline:
    return ScheduledPipeline(
        "pipelines/reporting",
        Weekdays(),
        depends_on=(FreshnessRequirement("ingest"),),
        due_time="09:30",
        earliest_run="06:00",
        priority=4,
    )


def _assert_ordering_inputs_survived(item: ScheduledPipeline) -> None:
    assert item.due_time == dt.time(9, 30)
    assert item.earliest_run == dt.time(6, 0)
    assert item.priority == 4


def test_an_enabled_override_preserves_the_ordering_inputs():
    _assert_ordering_inputs_survived(replace(_full_item(), enabled=False))


def test_a_schedule_override_preserves_the_ordering_inputs():
    _assert_ordering_inputs_survived(replace(_full_item(), schedule=ManualOnly()))


def test_a_freshness_days_override_preserves_the_ordering_inputs():
    changed = replace(
        _full_item(),
        depends_on=tuple(
            replace(dep, max_age_days=2) for dep in _full_item().depends_on
        ),
    )

    _assert_ordering_inputs_survived(changed)


def test_the_orchestrator_applies_overrides_without_losing_the_ordering_inputs(
    tmp_path,
):
    from tools.calendar import WorkingDayCalendar
    from tools.orchestration import Orchestrator, PipelineSet

    orchestrator = Orchestrator(
        (PipelineSet("cases", (_full_item(),)),),
        WorkingDayCalendar(),
        overrides={
            "pipelines": [
                {
                    "set": "cases",
                    "pipeline": "reporting",
                    "enabled": False,
                    "schedule": {"type": "specific_weekdays", "weekdays": [4]},
                    "freshness_days": 2,
                }
            ]
        },
    )

    changed = orchestrator._apply_override("cases", _full_item())

    assert changed.enabled is False
    assert changed.schedule == SpecificWeekdays([4])
    _assert_ordering_inputs_survived(changed)
