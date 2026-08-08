"""The run-order derivation, on its own: no clock, no store, no orchestrator.

``order_run_candidates`` is a pure function of the candidates and the wall-clock
time of day, so every case below states the time explicitly. Whether an item is
*allowed* to run is not asked here at all — that stays the freshness rule's
question; this only decides the sequence.
"""

import datetime as dt

from framework.run import FreshnessRequirement
from tools.orchestration import (
    RunCandidate,
    ScheduledPipeline,
    Weekdays,
    order_run_candidates,
)


def _candidate(
    name: str,
    *,
    due_today: bool = True,
    enabled: bool = True,
    ran_today: bool = False,
    depends_on: tuple[str, ...] = (),
    **item_kwargs,
) -> RunCandidate:
    return RunCandidate(
        set_name="cases",
        item=ScheduledPipeline(
            f"pipelines/{name}",
            Weekdays(),
            depends_on=tuple(FreshnessRequirement(up) for up in depends_on),
            enabled=enabled,
            **item_kwargs,
        ),
        enabled=enabled,
        due_today=due_today,
        ran_today=ran_today,
    )


def _order(*candidates, now: str) -> list[str]:
    hour, minute = (int(part) for part in now.split(":"))
    ordered = order_run_candidates(candidates, now=dt.time(hour, minute))
    return [item.candidate.item.name for item in ordered]


# ── deadline pressure ─────────────────────────────────────────────────────────


def test_the_earlier_deadline_runs_first():
    assert _order(
        _candidate("late", due_time="16:00"),
        _candidate("early", due_time="09:00"),
        now="07:00",
    ) == ["early", "late"]


def test_every_overdue_item_sorts_ahead_of_every_non_overdue_one():
    # The overdue one has the *later* clock deadline; lateness wins regardless.
    assert _order(
        _candidate("soon", due_time="09:00"),
        _candidate("overdue", due_time="08:30"),
        now="08:45",
    ) == ["overdue", "soon"]


def test_the_most_overdue_item_runs_first():
    assert _order(
        _candidate("an_hour_late", due_time="08:00"),
        _candidate("three_hours_late", due_time="06:00"),
        now="09:00",
    ) == ["three_hours_late", "an_hour_late"]


def test_a_passed_deadline_stops_pressing_once_the_item_has_run_today():
    # Already succeeded today, so its overdue-ness is spent: it falls back to
    # the no-live-deadline group behind the item still waiting.
    assert _order(
        _candidate("done", due_time="06:00", ran_today=True),
        _candidate("waiting", due_time="16:00"),
        now="09:00",
    ) == ["waiting", "done"]


def test_items_without_a_deadline_follow_those_with_one_in_declared_order():
    assert _order(
        _candidate("no_deadline_a"),
        _candidate("no_deadline_b"),
        _candidate("with_deadline", due_time="16:00"),
        now="09:00",
    ) == ["with_deadline", "no_deadline_a", "no_deadline_b"]


# ── priority and declared order ───────────────────────────────────────────────


def test_priority_breaks_an_exact_deadline_tie():
    assert _order(
        _candidate("low", due_time="09:00"),
        _candidate("high", due_time="09:00", priority=5),
        now="07:00",
    ) == ["high", "low"]


def test_declared_order_is_the_final_tiebreaker():
    assert _order(
        _candidate("first", due_time="09:00", priority=5),
        _candidate("second", due_time="09:00", priority=5),
        now="07:00",
    ) == ["first", "second"]


def test_with_none_of_the_fields_set_the_order_is_the_declared_one():
    names = ["c", "a", "b", "d"]

    assert _order(*(_candidate(name) for name in names), now="09:00") == names


def test_priority_does_not_reorder_items_that_are_not_going_to_run():
    # Reordering work that will not run would only shuffle the plan's rows.
    assert _order(
        _candidate("not_due", due_today=False),
        _candidate("disabled", due_today=False, enabled=False, priority=9),
        now="09:00",
    ) == ["not_due", "disabled"]


def test_work_that_is_not_due_is_seated_after_work_that_is():
    assert _order(
        _candidate("not_due", due_today=False),
        _candidate("due"),
        now="09:00",
    ) == ["due", "not_due"]


# ── deadline inheritance ──────────────────────────────────────────────────────


def _inheritance(*candidates, now: str) -> dict[str, tuple[dt.time | None, str | None]]:
    hour, minute = (int(part) for part in now.split(":"))
    return {
        item.candidate.item.name: (item.due_time, item.inherited_from)
        for item in order_run_candidates(candidates, now=dt.time(hour, minute))
    }


def test_an_upstream_inherits_its_dependents_deadline():
    resolved = _inheritance(
        _candidate("ingest"),
        _candidate("reporting", due_time="09:00", depends_on=("ingest",)),
        now="07:00",
    )

    assert resolved["ingest"] == (dt.time(9, 0), "reporting")
    assert resolved["reporting"] == (dt.time(9, 0), None)


def test_a_deadline_inherits_transitively_up_the_chain():
    resolved = _inheritance(
        _candidate("extract"),
        _candidate("ingest", depends_on=("extract",)),
        _candidate("reporting", due_time="09:00", depends_on=("ingest",)),
        now="07:00",
    )

    assert resolved["extract"] == (dt.time(9, 0), "ingest")


def test_the_tightest_dependent_deadline_wins():
    resolved = _inheritance(
        _candidate("ingest"),
        _candidate("slow_report", due_time="16:00", depends_on=("ingest",)),
        _candidate("fast_report", due_time="09:00", depends_on=("ingest",)),
        now="07:00",
    )

    assert resolved["ingest"] == (dt.time(9, 0), "fast_report")


def test_a_dependent_that_is_not_due_does_not_press_its_deadline_upstream():
    resolved = _inheritance(
        _candidate("ingest"),
        _candidate(
            "reporting", due_time="09:00", due_today=False, depends_on=("ingest",)
        ),
        now="07:00",
    )

    assert resolved["ingest"] == (None, None)


def test_a_dependency_cycle_terminates_rather_than_recursing():
    # depends_on is not cycle-checked anywhere; ordering must not be where a
    # mistake in one turns into a hang.
    names = _order(
        _candidate("a", depends_on=("b",)),
        _candidate("b", due_time="09:00", depends_on=("a",)),
        now="07:00",
    )

    assert sorted(names) == ["a", "b"]


# ── dependency order dominates ────────────────────────────────────────────────


def test_a_tighter_deadline_and_higher_priority_cannot_outrank_an_upstream():
    # Both land in the same pressure group via inheritance, and the dependent's
    # priority would otherwise put it first — where it would come back blocked.
    assert _order(
        _candidate("ingest"),
        _candidate("reporting", due_time="09:00", priority=5, depends_on=("ingest",)),
        now="07:00",
    ) == ["ingest", "reporting"]


def test_a_dependent_declared_before_its_upstream_is_reseated_behind_it():
    assert _order(
        _candidate("reporting", depends_on=("ingest",)),
        _candidate("ingest"),
        now="09:00",
    ) == ["ingest", "reporting"]


def test_an_upstream_that_is_not_due_does_not_hold_back_its_dependent():
    assert _order(
        _candidate("monthly_extract", due_today=False),
        _candidate("reporting", depends_on=("monthly_extract",)),
        now="09:00",
    ) == ["reporting", "monthly_extract"]


# ── the earliest_run gate ─────────────────────────────────────────────────────


def _eligibility(*candidates, now: str) -> dict[str, bool]:
    hour, minute = (int(part) for part in now.split(":"))
    return {
        item.candidate.item.name: item.eligible
        for item in order_run_candidates(candidates, now=dt.time(hour, minute))
    }


def test_an_item_is_eligible_from_exactly_its_earliest_run():
    assert _eligibility(_candidate("ingest", earliest_run="09:00"), now="09:00") == {
        "ingest": True
    }


def test_an_item_before_its_earliest_run_is_not_eligible_this_pass():
    assert _eligibility(_candidate("ingest", earliest_run="09:00"), now="08:59") == {
        "ingest": False
    }


def test_a_gate_keeps_its_position_rather_than_leaving_the_ordering():
    # Gating is not removal: the item stays where the deadlines put it, so plan
    # and pass report it identically.
    assert _order(
        _candidate("gated", due_time="09:00", earliest_run="10:00"),
        _candidate("open", due_time="16:00"),
        now="08:00",
    ) == ["gated", "open"]


def test_a_gate_is_not_inherited_by_an_upstream():
    ordered = order_run_candidates(
        (
            _candidate("ingest"),
            _candidate("reporting", earliest_run="10:00", depends_on=("ingest",)),
        ),
        now=dt.time(8, 0),
    )

    assert [item.eligible for item in ordered] == [True, False]


def test_an_earliest_run_later_than_the_deadline_is_overdue_and_gated_at_once():
    # Permanently overdue and permanently ineligible for any pass inside the
    # window. Allowed, not validated against: it is a declaration mistake the
    # plan makes visible rather than one the constructor guesses at.
    ordered = order_run_candidates(
        (_candidate("ingest", due_time="09:00", earliest_run="10:00"),),
        now=dt.time(9, 30),
    )

    assert ordered[0].overdue is True
    assert ordered[0].eligible is False
