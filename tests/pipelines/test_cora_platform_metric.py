"""Tests for the ``cora_platform_metric`` Reporting pipeline.

Each reduction is exercised on a handful of rows whose answer can be checked by
hand, then one end-to-end run lands every table through the migrated write
path from a seeded Sync subject.
"""

from __future__ import annotations

import datetime as dt
import time

import pandas as pd
import pytest

from framework.core import (
    RUN_PROVENANCE_COLUMN,
    Dataset,
    SchemaValidator,
    ValidationError,
)
from framework.io import Refresh
from framework.run import FreshnessRequirement
from pipelines.cora_platform_metric import metrics
from pipelines.cora_platform_metric.metrics import (
    UNASSIGNED,
    UNKNOWN_BRAND,
    UNRESOLVED,
    UNSTATED,
)
from pipelines.cora_platform_metric.pipeline import GOLD_TABLES, UPSTREAMS, main
from pipelines.cora_platform_metric.schema import AnswerActionLoad
from pipelines.sharepoint_cases.schema import FEED_NAME as SYNC_SUBJECT
from tests.framework_testing import build_databases, given_rows, read_rows
from tools.calendar import WorkingDayCalendar
from tools.medallion import medallion
from tools.observability import timestamps
from tools.store import StoreRegistry

AS_OF = "2026-08-20T06:00:00+00:00"
KHAN = r"i:0#.w|CONTEXT\A.KHAN"
JONES = r"i:0#.w|CONTEXT\B.JONES"


# --- fixtures: rows shaped as the Sync subject lands them --------------------


def _observation(
    item: str,
    observation_id: str,
    modified: str,
    status: str,
    *,
    on_hold: int = 0,
    placed_on_hold_at: str | None = None,
    reviewer: str | None = KHAN,
    created: str | None = "2026-07-01T09:00:00+00:00",
    assigned_at: str | None = None,
    reportable_at: str | None = None,
    completed_at: str | None = None,
    voided_at: str | None = None,
    version: str = '"1"',
) -> dict[str, object]:
    return {
        "case_type": "complaints",
        "source_item_id": item,
        "source_observation_id": observation_id,
        "source_version": version,
        "source_modified_at": modified,
        "status": status,
        "assigned_reviewer_name": reviewer,
        "created": created,
        "assigned_at": assigned_at,
        "on_hold": on_hold,
        "placed_on_hold_at": placed_on_hold_at,
        "reportable_at": reportable_at,
        "completed_at": completed_at,
        "voided_at": voided_at,
    }


def _case(case_id: str, status: str, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "case_id": case_id,
        "source_item_id": case_id,
        "case_type": "complaints",
        "status": status,
        "assigned_reviewer_name": KHAN,
        "assigned_reviewer_manager_name": "M.ONE",
        "responsible_party_manager_name": "R.ONE",
        "due_date": None,
        "remediation_due_date": None,
        "completed_at": None,
        "created": "2026-07-01T09:00:00+00:00",
        "voided_at": None,
        "void_reason": None,
        "voided_by_name": None,
        "assigned_at": None,
        "reportable_at": None,
        "had_remediation": None,
        "effective_outcome": None,
        "effective_had_remediation": None,
        "outcome_overridden": None,
        "on_hold": 0,
        "responsible_party_name": None,
        "as_of_utc": AS_OF,
    }
    row.update(overrides)
    return row


HISTORY = [
    # Case 1: seen waiting, then claimed, held for three days, released, done.
    _observation("1", "o1", "2026-07-02T09:00:00+00:00", "To-allocate"),
    _observation(
        "1",
        "o2",
        "2026-07-04T09:00:00+00:00",
        "In-progress",
        assigned_at="2026-07-04T09:00:00+00:00",
    ),
    _observation(
        "1",
        "o3",
        "2026-07-06T09:00:00+00:00",
        "In-progress",
        on_hold=1,
        placed_on_hold_at="2026-07-05T09:00:00+00:00",
    ),
    _observation("1", "o4", "2026-07-08T09:00:00+00:00", "In-progress"),
    _observation("1", "o5", "2026-07-10T09:00:00+00:00", "Completed"),
    # Case 2: first seen already in progress and on hold, with no hold stamp.
    _observation(
        "2",
        "p1",
        "2026-08-01T09:00:00+00:00",
        "In-progress",
        on_hold=1,
        reviewer=JONES,
    ),
]

CURRENT = [
    _case(
        "c1",
        "Completed",
        due_date="2026-07-08T00:00:00+00:00",  # Wednesday
        completed_at="2026-07-10T09:00:00+00:00",  # Friday: 2 working days late
        remediation_due_date="2026-07-12T00:00:00+00:00",  # after completion
        assigned_at="2026-07-04T09:00:00+00:00",
        reportable_at="2026-07-08T09:00:00+00:00",  # Actions sent
        had_remediation=1,
        effective_outcome="Upheld",
        effective_had_remediation=1,
        outcome_overridden=0,
    ),
    _case("c2", "In-progress"),
    _case(
        "c3",
        "Void",
        voided_at="2026-08-03T10:00:00+00:00",
        void_reason="duplicate",
        voided_by_name="V.ONE",
    ),
    _case(
        "c4",
        "Completed",
        due_date="2026-07-10T00:00:00+00:00",  # Friday
        completed_at="2026-07-13T09:00:00+00:00",  # Monday: 1 working day late
    ),
]

ANSWERS = [
    {
        "case_id": "c1",
        "case_type": "complaints",
        "question_id": "q1",
        "remediation_required": "yes",
        "remediation_status": "complete",
    },
    {
        "case_id": "c1",
        "case_type": "complaints",
        "question_id": "q2",
        "remediation_required": "no",
        "remediation_status": None,
    },
    {
        "case_id": "c4",
        "case_type": "complaints",
        "question_id": "q1",
        "remediation_required": "yes",
        "remediation_status": "partial",
    },
]

ACTIONS = [
    {
        "case_id": "c1",
        "case_type": "complaints",
        "question_id": "q1",
        "action_id": "a1",
    },
    {
        "case_id": "c1",
        "case_type": "complaints",
        "question_id": "q1",
        "action_id": "a2",
    },
    {
        "case_id": "c4",
        "case_type": "complaints",
        "question_id": "q1",
        "action_id": "a3",
    },
]

APPEALS = [
    {
        "case_id": "c1",
        "case_type": "complaints",
        "appeal_id": "ap1",
        "raised_at": "2026-07-11T09:00:00+00:00",
        "state": "resolved",
        "resolution_verdict": "agreed",
        "resolution_at": "2026-07-13T09:00:00+00:00",
        "cited_question_ids_json": '["q1", "q2"]',
    },
    {
        "case_id": "c4",
        "case_type": "complaints",
        "appeal_id": "ap2",
        "raised_at": "2026-07-14T09:00:00+00:00",
        "state": "raised",
        "resolution_verdict": None,
        "resolution_at": None,
        "cited_question_ids_json": '["q1"]',
    },
]

MESSAGES = [
    {
        "case_id": "c1",
        "case_type": "complaints",
        "seq": 1,
        "author_login": "a.khan",
        "posted_at": "2026-07-05T09:00:00+00:00",
    },
    {
        "case_id": "c1",
        "case_type": "complaints",
        "seq": 2,
        "author_login": "a.khan",
        "posted_at": "2026-07-05T10:00:00+00:00",
    },
    {
        "case_id": "c1",
        "case_type": "complaints",
        "seq": 3,
        "author_login": "r.party",
        "posted_at": "2026-07-05T13:00:00+00:00",
    },
    {
        "case_id": "c1",
        "case_type": "complaints",
        "seq": 4,
        "author_login": "a.khan",
        "posted_at": "2026-07-06T13:00:00+00:00",
    },
]


def _rows(dataset: Dataset) -> list[dict[str, object]]:
    """Rows with NaN rendered as None, so a statistic with nothing to summarise
    compares as the NULL it lands as."""
    frame = dataset.to_pandas()
    return [
        {k: (None if pd.isna(v) else v) for k, v in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def _current(rows=CURRENT) -> Dataset:
    return given_rows(rows).read()


# --- the history metrics ----------------------------------------------------


def test_stage_dwell_closes_an_interval_at_each_observed_status_change():
    result = _rows(metrics.case_stage_dwell(given_rows(HISTORY).read(), as_of=AS_OF))

    # To-allocate: entered at ``created`` (1 Jul), not at the poll that first
    # saw it (2 Jul), and left on 4 Jul: three days. In-progress: 4 Jul to
    # 10 Jul for case 1, and still open for case 2. Completed dwells nowhere.
    assert result == [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "status": "In-progress",
            "interval_count": 1,
            "open_interval_count": 1,
            "dwell_days_mean": 6.0,
            "dwell_days_p50": 6.0,
            "dwell_days_p90": 6.0,
            "dwell_days_max": 6.0,
            "as_of_utc": AS_OF,
        },
        {
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "status": "To-allocate",
            "interval_count": 1,
            "open_interval_count": 0,
            "dwell_days_mean": 3.0,
            "dwell_days_p50": 3.0,
            "dwell_days_p90": 3.0,
            "dwell_days_max": 3.0,
            "as_of_utc": AS_OF,
        },
    ]


def test_stage_dwell_credits_a_status_only_when_a_later_poll_saw_it_change():
    # A status entered and left between two polls was never observed: the
    # known limit of a history of polls. One observation per status, ordered
    # by the source's Modified rather than by the order the rows were landed.
    history = [
        _observation("1", "b", "2026-07-03T09:00:00+00:00", "Completed"),
        _observation("1", "a", "2026-07-02T09:00:00+00:00", "In-progress"),
    ]
    [row] = _rows(metrics.case_stage_dwell(given_rows(history).read(), as_of=AS_OF))

    assert row["status"] == "In-progress"
    assert row["interval_count"] == 1
    assert row["dwell_days_max"] == 1.0
    assert row["open_interval_count"] == 0


def test_an_unassigned_case_dwells_in_to_allocate_again_as_its_own_interval():
    # Claimed 2 Jul, un-assigned back to the pot 4 Jul, claimed again 5 Jul.
    history = [
        _observation(
            "1", "a", "2026-07-01T09:00:00+00:00", "To-allocate", reviewer=None
        ),
        _observation("1", "b", "2026-07-02T09:00:00+00:00", "In-progress"),
        _observation(
            "1", "c", "2026-07-04T09:00:00+00:00", "To-allocate", reviewer=None
        ),
        _observation("1", "d", "2026-07-05T09:00:00+00:00", "In-progress"),
    ]
    result = _rows(metrics.case_stage_dwell(given_rows(history).read(), as_of=AS_OF))
    by_status = {row["status"]: row for row in result}

    assert by_status["To-allocate"]["interval_count"] == 2
    assert by_status["To-allocate"]["dwell_days_max"] == 1.0
    assert by_status["In-progress"]["interval_count"] == 1
    assert by_status["In-progress"]["dwell_days_max"] == 2.0
    assert by_status["In-progress"]["open_interval_count"] == 1


def test_stage_dwell_publishes_no_interval_for_a_terminal_status_left_by_a_reopen():
    # Completed 6 Jul, reopened 9 Jul, completed again 10 Jul: the three days
    # Completed are the gap until the reopen, not a stage.
    history = [
        _observation("1", "a", "2026-07-02T09:00:00+00:00", "In-progress"),
        _observation("1", "b", "2026-07-06T09:00:00+00:00", "Completed"),
        _observation("1", "c", "2026-07-09T09:00:00+00:00", "In-progress"),
        _observation("1", "d", "2026-07-10T09:00:00+00:00", "Completed"),
    ]
    result = _rows(metrics.case_stage_dwell(given_rows(history).read(), as_of=AS_OF))

    assert [(r["status"], r["interval_count"]) for r in result] == [("In-progress", 2)]


def test_a_same_instant_tie_is_ordered_by_the_version_as_a_number():
    # One Modified, two versions. The observation ids sort the other way, and
    # "10" sorts before "9" as text: only the parsed version puts 10 last.
    history = [
        _observation(
            "1", "z", "2026-07-02T09:00:00+00:00", "In-progress", version='"9"'
        ),
        _observation(
            "1", "a", "2026-07-02T09:00:00+00:00", "Completed", version='"10"'
        ),
    ]
    result = _rows(metrics.case_stage_dwell(given_rows(history).read(), as_of=AS_OF))

    assert [(r["status"], r["open_interval_count"]) for r in result] == [
        ("In-progress", 0)
    ]


def test_an_unparseable_modified_drops_the_observation_from_every_history_table():
    history = [
        _observation("1", "a", "2026-07-01T09:00:00+00:00", "To-allocate"),
        _observation("1", "b", "not a time", "In-progress"),
    ]
    observations = given_rows(history).read()
    backlog = metrics.case_backlog(observations, as_of="2026-07-02T18:00:00+00:00")
    [dwell] = _rows(metrics.case_stage_dwell(observations, as_of=AS_OF))

    assert _counts(backlog, "backlog_date") == {
        ("2026-07-01", "To-allocate"): 1,
        ("2026-07-02", "To-allocate"): 1,
    }
    assert (dwell["status"], dwell["open_interval_count"]) == ("To-allocate", 1)


def test_backlog_counts_an_unassigned_case_back_in_to_allocate():
    as_of = "2026-07-04T18:00:00+00:00"
    history = [
        _observation(
            "1", "a", "2026-07-01T09:00:00+00:00", "To-allocate", reviewer=None
        ),
        _observation("1", "b", "2026-07-02T09:00:00+00:00", "In-progress"),
        _observation(
            "1", "c", "2026-07-04T09:00:00+00:00", "To-allocate", reviewer=None
        ),
    ]
    result = metrics.case_backlog(given_rows(history).read(), as_of=as_of)

    assert _counts(result, "backlog_date") == {
        ("2026-07-01", "To-allocate"): 1,
        ("2026-07-02", "In-progress"): 1,
        ("2026-07-03", "In-progress"): 1,
        ("2026-07-04", "To-allocate"): 1,
    }


def test_hold_runs_from_the_source_stamp_or_the_observation_to_release_or_as_of():
    result = _rows(metrics.case_hold(given_rows(HISTORY).read(), as_of=AS_OF))

    assert result == [
        {
            # Case 1: placed_on_hold_at 5 Jul, first seen clear on 8 Jul.
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "assigned_reviewer_name": KHAN,
            "case_count": 1,
            "hold_count": 1,
            "open_hold_count": 0,
            "held_days_total": 3.0,
            "held_days_mean": 3.0,
            "as_of_utc": AS_OF,
        },
        {
            # Case 2: no stamp, so from the observation (1 Aug 09:00) to as_of
            # (20 Aug 06:00), and still open.
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "assigned_reviewer_name": JONES,
            "case_count": 1,
            "hold_count": 1,
            "open_hold_count": 1,
            "held_days_total": 18.875,
            "held_days_mean": 18.875,
            "as_of_utc": AS_OF,
        },
    ]


def test_a_hold_still_flagged_on_a_completed_case_closes_at_its_completion():
    history = [
        _observation(
            "1",
            "a",
            "2026-07-02T09:00:00+00:00",
            "In-progress",
            on_hold=1,
            placed_on_hold_at="2026-07-01T09:00:00+00:00",
        ),
        _observation("1", "b", "2026-07-04T09:00:00+00:00", "Completed", on_hold=1),
        _observation("1", "c", "2026-07-08T09:00:00+00:00", "Completed", on_hold=1),
    ]
    [row] = _rows(metrics.case_hold(given_rows(history).read(), as_of=AS_OF))

    assert (row["open_hold_count"], row["held_days_total"]) == (0, 3.0)


def _hold_counts(history) -> tuple[int, int, int, float]:
    """(case_count, hold_count, open_hold_count, held_days_total) of one row."""
    [row] = _rows(metrics.case_hold(given_rows(history).read(), as_of=AS_OF))
    return (
        row["case_count"],
        row["hold_count"],
        row["open_hold_count"],
        row["held_days_total"],
    )


HELD_THEN_COMPLETED = [
    _observation("1", "a", "2026-07-02T09:00:00+00:00", "In-progress", on_hold=1),
    _observation("1", "b", "2026-07-04T09:00:00+00:00", "Completed", on_hold=1),
]


def test_a_hold_cleared_after_completion_still_ends_at_the_completion():
    # The flag is tidied four days after the Case completed: the hold is the
    # two days to the completion, not six to the tidy-up.
    history = [
        *HELD_THEN_COMPLETED,
        _observation("1", "c", "2026-07-08T09:00:00+00:00", "Completed", on_hold=0),
    ]

    assert _hold_counts(history) == (1, 1, 0, 2.0)


def test_a_hold_does_not_count_the_spell_the_case_spent_completed():
    # Completed on 4 Jul still flagged, reopened on 10 Jul with the flag clear:
    # one hold of two days, not eight running through the Completed spell.
    history = [
        *HELD_THEN_COMPLETED,
        _observation("1", "c", "2026-07-10T09:00:00+00:00", "In-progress", on_hold=0),
    ]

    assert _hold_counts(history) == (1, 1, 0, 2.0)


def test_a_hold_flag_first_seen_on_a_terminal_case_opens_no_hold():
    history = [
        _observation("1", "a", "2026-07-02T09:00:00+00:00", "In-progress"),
        _observation("1", "b", "2026-07-04T09:00:00+00:00", "Completed"),
        _observation("1", "c", "2026-07-08T09:00:00+00:00", "Completed", on_hold=1),
        _observation("1", "d", "2026-07-09T09:00:00+00:00", "Void", on_hold=1),
    ]

    assert len(metrics.case_hold(given_rows(history).read(), as_of=AS_OF)) == 0


def test_a_flag_still_set_at_a_reopen_opens_a_new_hold_from_the_reopen():
    # The reopened observation still carries the original placed_on_hold_at
    # (2 Jul): the new hold runs from the reopen (10 Jul 09:00) to as_of
    # (20 Aug 06:00), 40.875 days, beside the closed two-day hold before it.
    stale = "2026-07-02T09:00:00+00:00"
    history = [
        _observation(
            "1", "a", stale, "In-progress", on_hold=1, placed_on_hold_at=stale
        ),
        _observation(
            "1",
            "b",
            "2026-07-04T09:00:00+00:00",
            "Completed",
            on_hold=1,
            placed_on_hold_at=stale,
        ),
        _observation(
            "1",
            "c",
            "2026-07-10T09:00:00+00:00",
            "In-progress",
            on_hold=1,
            placed_on_hold_at=stale,
        ),
    ]

    assert _hold_counts(history) == (1, 2, 1, 42.875)


def test_a_history_with_no_holds_lands_the_declared_shape_and_no_rows():
    history = [_observation("1", "o1", "2026-07-02T09:00:00+00:00", "To-allocate")]
    result = metrics.case_hold(given_rows(history).read(), as_of=AS_OF)

    assert len(result) == 0
    assert list(result.columns) == [
        "brand",
        "case_type",
        "assigned_reviewer_name",
        "case_count",
        "hold_count",
        "open_hold_count",
        "held_days_total",
        "held_days_mean",
        "as_of_utc",
    ]


# --- the current metrics ----------------------------------------------------


@pytest.mark.parametrize(
    ("due", "completed", "expected"),
    [
        (dt.date(2026, 7, 8), dt.date(2026, 7, 8), 0),  # on the day
        (dt.date(2026, 7, 8), dt.date(2026, 7, 6), 0),  # early
        (dt.date(2026, 7, 8), dt.date(2026, 7, 10), 2),  # Wed -> Fri
        (dt.date(2026, 7, 10), dt.date(2026, 7, 13), 1),  # Fri -> Mon
    ],
)
def test_working_days_late_counts_working_days_after_the_due_date(
    due, completed, expected
):
    assert metrics.working_days_late(WorkingDayCalendar(), due, completed) == expected


def test_sla_attainment_judges_each_sla_against_its_own_due_date():
    result = _rows(metrics.sla_attainment(_current(), as_of=AS_OF))

    assert result == [
        {
            # Only c1 carries a remediation due date, and completed before it.
            "sla_kind": "remediation",
            "completed_month": "2026-07",
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "assigned_reviewer_manager_name": "M.ONE",
            "case_count": 1,
            "on_time_count": 1,
            "late_count": 0,
            "no_due_date_count": 0,
            "late_working_days_mean": None,
            "late_working_days_max": None,
            "as_of_utc": AS_OF,
        },
        {
            "sla_kind": "review",
            "completed_month": "2026-07",
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "assigned_reviewer_manager_name": "M.ONE",
            "case_count": 2,
            "on_time_count": 0,
            "late_count": 2,
            "no_due_date_count": 0,
            "late_working_days_mean": 1.5,
            "late_working_days_max": 2.0,
            "as_of_utc": AS_OF,
        },
    ]


def test_sla_attainment_takes_the_calendar_it_is_given():
    # With 9 and 10 July as holidays, c1 (due Wed 8, done Fri 10) is not late.
    calendar = WorkingDayCalendar(holidays=[dt.date(2026, 7, 9), dt.date(2026, 7, 10)])
    review = [
        row
        for row in _rows(
            metrics.sla_attainment(_current(), as_of=AS_OF, calendar=calendar)
        )
        if row["sla_kind"] == "review"
    ]

    assert review[0]["on_time_count"] == 1
    assert review[0]["late_count"] == 1
    assert review[0]["late_working_days_max"] == 1.0


def test_sla_attainment_counts_a_completed_case_with_no_due_date_separately():
    [row] = _rows(
        metrics.sla_attainment(
            _current(
                [
                    _case(
                        "c9",
                        "Completed",
                        completed_at="2026-07-10T09:00:00+00:00",
                        assigned_reviewer_manager_name=None,
                    )
                ]
            ),
            as_of=AS_OF,
        )
    )

    assert row["sla_kind"] == "review"
    assert row["assigned_reviewer_manager_name"] == UNASSIGNED
    assert (row["case_count"], row["on_time_count"], row["late_count"]) == (1, 0, 0)
    assert row["no_due_date_count"] == 1


def test_void_monthly_groups_by_reason_and_actor_on_the_local_void_month(
    monkeypatch,
):
    # 31 Jul 23:30 UTC is 1 Aug at UTC+1: the month is the local one.
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    rows = [
        _case(
            "c3",
            "Void",
            voided_at="2026-07-31T23:30:00+00:00",
            created="2026-07-01T23:30:00+00:00",
        ),
    ]
    [row] = _rows(metrics.void_monthly(_current(rows), as_of=AS_OF))

    assert row["void_month"] == "2026-08"
    assert row["void_reason"] == UNSTATED
    assert row["voided_by_name"] == UNASSIGNED
    assert row["case_count"] == 1
    assert row["age_at_void_days_mean"] == 30.0


def test_answer_action_load_measures_actions_per_case_and_share_of_live_cases():
    [row] = _rows(
        metrics.answer_action_load(given_rows(ACTIONS).read(), _current(), as_of=AS_OF)
    )

    # Three live (non-void) Cases; two carry an Action on q1.
    assert row == {
        "case_type": "complaints",
        "question_id": "q1",
        "case_count": 2,
        "action_count": 3,
        "actions_per_case_mean": 1.5,
        "actions_per_case_max": 2,
        "share_of_cases": 0.6667,
        "as_of_utc": AS_OF,
    }


def test_answer_action_load_counts_only_live_cases_so_the_share_cannot_pass_one():
    # c3 is void: its Action is not on a live Case, so it is not counted either.
    actions = [*ACTIONS, _action("c3", "q1", "a9"), _action("c3", "q2", "a10")]
    result = _rows(
        metrics.answer_action_load(given_rows(actions).read(), _current(), as_of=AS_OF)
    )

    assert [
        (r["question_id"], r["case_count"], r["share_of_cases"]) for r in result
    ] == [("q1", 2, 0.6667)]


def test_a_share_of_cases_above_one_fails_the_tables_gate():
    [row] = _rows(
        metrics.answer_action_load(given_rows(ACTIONS).read(), _current(), as_of=AS_OF)
    )
    impossible = Dataset.from_pandas(pd.DataFrame([{**row, "share_of_cases": 1.5}]))

    with pytest.raises(ValidationError, match="share_of_cases"):
        SchemaValidator(AnswerActionLoad).validate(impossible)


def test_answer_remediation_by_manager_joins_each_answer_to_its_case():
    result = _rows(
        metrics.answer_remediation_by_manager(
            given_rows(ANSWERS).read(), _current(), as_of=AS_OF
        )
    )

    assert [
        (
            r["responsible_party_manager_name"],
            r["remediation_required"],
            r["remediation_status"],
            r["answer_count"],
            r["case_count"],
        )
        for r in result
    ] == [
        ("R.ONE", "no", UNRESOLVED, 1, 1),
        ("R.ONE", "yes", "complete", 1, 1),
        ("R.ONE", "yes", "partial", 1, 1),
    ]


def test_answer_remediation_by_manager_drops_an_answer_with_no_current_case():
    orphan = [{**ANSWERS[0], "case_id": "gone"}]
    result = metrics.answer_remediation_by_manager(
        given_rows(orphan).read(), _current(), as_of=AS_OF
    )

    assert len(result) == 0


def test_appeal_cycle_time_is_measured_over_the_resolved_appeals_only():
    result = _rows(metrics.appeal_cycle_time(given_rows(APPEALS).read(), as_of=AS_OF))

    assert [
        (
            r["state"],
            r["resolution_verdict"],
            r["appeal_count"],
            r["resolved_count"],
            r["cycle_days_mean"],
        )
        for r in result
    ] == [
        ("raised", UNRESOLVED, 1, 0, None),
        ("resolved", "agreed", 1, 1, 2.0),
    ]


def test_appeal_cycle_time_clamps_a_resolution_stamped_before_the_raise():
    # Raised 11 Jul, resolution stamped 10 Jul.
    appeal = {**APPEALS[0], "resolution_at": "2026-07-10T09:00:00+00:00"}
    [row] = _rows(metrics.appeal_cycle_time(given_rows([appeal]).read(), as_of=AS_OF))

    assert (row["cycle_days_mean"], row["cycle_days_max"]) == (0.0, 0.0)


def test_void_age_clamps_a_void_stamped_before_the_case_was_created():
    rows = [
        _case(
            "c3",
            "Void",
            voided_at="2026-07-01T09:00:00+00:00",
            created="2026-07-02T09:00:00+00:00",
        )
    ]
    [row] = _rows(metrics.void_monthly(_current(rows), as_of=AS_OF))

    assert (row["age_at_void_days_mean"], row["age_at_void_days_max"]) == (0.0, 0.0)


def test_appeal_question_citations_count_an_appeal_once_per_cited_question():
    result = _rows(
        metrics.appeal_question_citations(given_rows(APPEALS).read(), as_of=AS_OF)
    )

    assert [(r["question_id"], r["appeal_count"], r["case_count"]) for r in result] == [
        ("q1", 2, 2),
        ("q2", 1, 1),
    ]


@pytest.mark.parametrize("blob", [None, "", "not json", '{"a": 1}', "[1, null]"])
def test_a_citation_blob_that_is_not_a_list_of_ids_cites_nothing(blob):
    assert metrics._cited_questions(blob) in ([], ["1"])


def test_a_json_boolean_is_not_a_cited_question_id():
    assert metrics._cited_questions('["q1", true, false, 2]') == ["q1", "2"]


def test_conversation_response_time_measures_replies_across_an_author_change():
    [row] = _rows(
        metrics.conversation_response_time(
            given_rows(MESSAGES).read(), _current(), as_of=AS_OF
        )
    )

    # seq 2 is the same author as seq 1: one turn, not a reply. seq 3 replies
    # 3h after seq 2; seq 4 replies 24h after seq 3.
    assert row == {
        "brand": UNKNOWN_BRAND,
        "case_type": "complaints",
        "thread_count": 1,
        "reply_count": 2,
        "reply_hours_mean": 13.5,
        "reply_hours_p50": 13.5,
        "reply_hours_p90": 21.9,
        "reply_hours_max": 24.0,
        "as_of_utc": AS_OF,
    }


def test_conversation_response_time_counts_only_messages_on_live_cases():
    void_thread = [{**message, "case_id": "c3"} for message in MESSAGES]
    [row] = _rows(
        metrics.conversation_response_time(
            given_rows(MESSAGES + void_thread).read(), _current(), as_of=AS_OF
        )
    )

    assert (row["thread_count"], row["reply_count"]) == (1, 2)


def test_conversation_volume_counts_threads_over_the_live_cases():
    # c1 has a four-Message thread; c2 and c4 have none; c3 is void and out.
    [row] = _rows(
        metrics.conversation_volume(
            given_rows(MESSAGES).read(), _current(), as_of=AS_OF
        )
    )

    assert row == {
        "brand": UNKNOWN_BRAND,
        "case_type": "complaints",
        "case_count": 3,
        "thread_count": 1,
        "no_conversation_count": 2,
        "no_conversation_share": 0.6667,
        "message_count": 4,
        "messages_per_thread_mean": 4.0,
        "messages_per_thread_p50": 4.0,
        "messages_per_thread_p90": 4.0,
        "messages_per_thread_max": 4.0,
        "as_of_utc": AS_OF,
    }


def test_conversation_volume_drops_messages_on_a_void_or_unknown_case():
    stray = [
        {**MESSAGES[0], "case_id": "c3"},  # void
        {**MESSAGES[0], "case_id": "c9"},  # not current
    ]
    [row] = _rows(
        metrics.conversation_volume(
            given_rows(MESSAGES + stray).read(), _current(), as_of=AS_OF
        )
    )

    assert (row["thread_count"], row["message_count"]) == (1, 4)


def test_conversation_volume_with_no_messages_has_counts_but_no_statistics():
    empty = Dataset.from_pandas(pd.DataFrame(columns=metrics.CONVERSATION_COLUMNS))
    [row] = _rows(metrics.conversation_volume(empty, _current(), as_of=AS_OF))

    assert row["no_conversation_share"] == 1.0
    assert row["messages_per_thread_mean"] is None


def test_conversation_posting_pattern_is_a_dense_local_clock_grid():
    rows = _rows(
        metrics.conversation_posting_pattern(
            given_rows(MESSAGES).read(), _current(), as_of=AS_OF
        )
    )

    assert len(rows) == 7 * 24
    assert [r["weekday"] for r in rows[::24]] == list(metrics.WEEKDAY_NAMES)
    assert [r["hour_of_day"] for r in rows[:24]] == list(range(24))
    # 2026-07-05 is a Sunday: 09:00, 10:00, 13:00; the reply lands Monday 13:00.
    posted = {
        (r["weekday"], r["hour_of_day"]): r["message_count"]
        for r in rows
        if r["message_count"]
    }
    assert posted == {
        ("Sunday", 9): 1,
        ("Sunday", 10): 1,
        ("Sunday", 13): 1,
        ("Monday", 13): 1,
    }


def test_conversation_posting_pattern_files_each_message_under_its_local_hour(
    monkeypatch,
):
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=5))
    )
    rows = _rows(
        metrics.conversation_posting_pattern(
            given_rows(MESSAGES).read(), _current(), as_of=AS_OF
        )
    )

    posted = {(r["weekday"], r["hour_of_day"]) for r in rows if r["message_count"]}
    assert posted == {("Sunday", 14), ("Sunday", 15), ("Sunday", 18), ("Monday", 18)}


@pytest.fixture
def system_zone_uk(monkeypatch):
    """The *system* zone is the UK's, summer time and all; the seam is None."""
    if not hasattr(time, "tzset"):
        pytest.skip("time.tzset is POSIX-only")
    monkeypatch.setattr(timestamps, "local_timezone", lambda: None)
    monkeypatch.setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def test_conversation_posting_pattern_reads_the_system_zone_per_message(
    system_zone_uk,
):
    # Sunday 5 Jul 23:30 UTC is Monday 00:30 BST; Monday 7 Dec 23:30 UTC is
    # 23:30 GMT.
    messages = [
        {**MESSAGES[0], "posted_at": "2026-07-05T23:30:00+00:00"},
        {**MESSAGES[1], "posted_at": "2026-12-07T23:30:00+00:00"},
    ]
    rows = _rows(
        metrics.conversation_posting_pattern(
            given_rows(messages).read(), _current(), as_of=AS_OF
        )
    )

    posted = {(r["weekday"], r["hour_of_day"]) for r in rows if r["message_count"]}
    assert posted == {("Monday", 0), ("Monday", 23)}


def test_conversation_posting_pattern_with_no_messages_has_no_grid():
    empty = Dataset.from_pandas(pd.DataFrame(columns=metrics.CONVERSATION_COLUMNS))

    assert (
        _rows(metrics.conversation_posting_pattern(empty, _current(), as_of=AS_OF))
        == []
    )


# --- the Case-flow metrics --------------------------------------------------


def _counts(dataset: Dataset, date_column: str) -> dict[tuple[str, str], int]:
    """The non-zero cells of a daily count grid, keyed (day, status)."""
    return {
        (row[date_column], row["status"]): row["case_count"]
        for row in _rows(dataset)
        if row["case_count"]
    }


def test_intake_counts_each_case_on_its_local_created_date_by_status_now():
    cases = [
        _case("c1", "Completed", created="2026-07-01T09:00:00+00:00"),
        _case("c2", "In-progress", created="2026-07-01T17:00:00+00:00"),
        _case("c3", "Void", created="2026-07-02T09:00:00+00:00"),
        _case("c4", "In-progress", created=None),
    ]
    result = _rows(metrics.case_intake(_current(cases), as_of=AS_OF))

    # A voided Case arrived too; one with no ``created`` is kept, not dropped.
    assert [(r["intake_date"], r["status"], r["case_count"]) for r in result] == [
        ("(unstamped)", "In-progress", 1),
        ("2026-07-01", "Completed", 1),
        ("2026-07-01", "In-progress", 1),
        ("2026-07-02", "Void", 1),
    ]
    assert {(r["brand"], r["case_type"], r["as_of_utc"]) for r in result} == {
        (UNKNOWN_BRAND, "complaints", AS_OF)
    }


def test_intake_files_a_case_under_its_local_created_date(monkeypatch):
    # 1 Jul 23:30 UTC is 2 Jul at UTC+1.
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    cases = [_case("c1", "In-progress", created="2026-07-01T23:30:00+00:00")]
    [row] = _rows(metrics.case_intake(_current(cases), as_of=AS_OF))

    assert row["intake_date"] == "2026-07-02"


def test_backlog_counts_the_status_each_case_closed_each_day_in():
    as_of = "2026-07-05T06:00:00+00:00"
    history = [
        # Case 1: waiting on 1 Jul; claimed on 2 Jul; Completed on 3 Jul.
        _observation(
            "1",
            "a1",
            "2026-07-01T10:00:00+00:00",
            "To-allocate",
            created="2026-07-01T09:00:00+00:00",
        ),
        _observation("1", "a2", "2026-07-02T15:00:00+00:00", "In-progress"),
        _observation("1", "a3", "2026-07-03T08:00:00+00:00", "Completed"),
        # Case 2: created 2 Jul, first seen In-progress on 3 Jul: 2 Jul unobserved.
        _observation(
            "2",
            "b1",
            "2026-07-04T09:00:00+00:00",
            "In-progress",
            created="2026-07-02T09:00:00+00:00",
            assigned_at="2026-07-03T12:00:00+00:00",
        ),
        # Case 3: arrives and is claimed on 3 Jul: counted under its closing status.
        _observation(
            "3",
            "c1",
            "2026-07-03T09:30:00+00:00",
            "To-allocate",
            created="2026-07-03T09:00:00+00:00",
        ),
        _observation("3", "c2", "2026-07-03T16:00:00+00:00", "In-progress"),
    ]
    result = metrics.case_backlog(given_rows(history).read(), as_of=as_of)

    assert _counts(result, "backlog_date") == {
        ("2026-07-01", "To-allocate"): 1,
        ("2026-07-02", "In-progress"): 1,
        ("2026-07-02", metrics.UNOBSERVED): 1,
        ("2026-07-03", "In-progress"): 2,
        ("2026-07-04", "In-progress"): 2,
        ("2026-07-05", "In-progress"): 2,
    }
    # Dense grid: a quiet status is a 0, not a missing row.
    assert len(result) == 5 * 4
    assert {r["as_of_utc"] for r in _rows(result)} == {as_of}


def test_backlog_dates_a_late_first_sighting_from_the_sources_own_stamp():
    history = [
        # First seen Completed: open, status unseen, until completed_at.
        _observation(
            "1",
            "a1",
            "2026-07-04T09:00:00+00:00",
            "Completed",
            created="2026-07-01T09:00:00+00:00",
            completed_at="2026-07-03T09:00:00+00:00",
        ),
        # First seen with Actions out: in that status since reportable_at.
        _observation(
            "2",
            "b1",
            "2026-07-04T09:00:00+00:00",
            "Actions In Progress",
            created="2026-07-01T09:00:00+00:00",
            reportable_at="2026-07-02T09:00:00+00:00",
        ),
    ]
    result = metrics.case_backlog(
        given_rows(history).read(), as_of="2026-07-04T06:00:00+00:00"
    )

    assert _counts(result, "backlog_date") == {
        ("2026-07-01", metrics.UNOBSERVED): 2,
        ("2026-07-02", metrics.UNOBSERVED): 1,
        ("2026-07-02", "Actions In Progress"): 1,
        ("2026-07-03", "Actions In Progress"): 1,
        ("2026-07-04", "Actions In Progress"): 1,
    }


def test_a_history_with_nothing_open_lands_the_backlog_shape_and_no_rows():
    history = [
        _observation("1", "a1", "2026-07-02T09:00:00+00:00", "Completed", created=None)
    ]
    result = metrics.case_backlog(given_rows(history).read(), as_of=AS_OF)

    assert len(result) == 0
    assert list(result.columns) == [
        "backlog_date",
        "brand",
        "case_type",
        "status",
        "case_count",
        "as_of_utc",
    ]


LIFECYCLE_CASES = [
    # The actions path: Reportable when Actions were sent, Completed later.
    _case(
        "c1",
        "Completed",
        created="2026-07-01T09:00:00+00:00",
        assigned_at="2026-07-02T09:00:00+00:00",
        reportable_at="2026-07-06T09:00:00+00:00",
        completed_at="2026-07-10T09:00:00+00:00",
        had_remediation=1,
    ),
    # No Actions: Reportable and Completed at the same instant.
    _case(
        "c2",
        "Completed",
        created="2026-07-01T09:00:00+00:00",
        assigned_at="2026-07-03T09:00:00+00:00",
        reportable_at="2026-07-04T21:00:00+00:00",
        completed_at="2026-07-04T21:00:00+00:00",
        had_remediation=0,
    ),
    # Reassigned after Reportable, so its review leg runs backwards.
    _case(
        "c3",
        "Actions In Progress",
        assigned_reviewer_name=JONES,
        created="2026-07-01T09:00:00+00:00",
        assigned_at="2026-08-02T09:00:00+00:00",
        reportable_at="2026-07-20T09:00:00+00:00",
        had_remediation=1,
    ),
]


def test_lifecycle_duration_measures_each_leg_between_the_sources_stamps():
    result = _rows(
        metrics.case_lifecycle_duration(_current(LIFECYCLE_CASES), as_of=AS_OF)
    )
    measured = {
        (r["leg_order"], r["leg"], r["ended_month"], r["assigned_reviewer_name"]): (
            r["case_count"],
            r["out_of_order_count"],
            r["days_total"],
            r["days_mean"],
            r["days_p50"],
            r["days_p90"],
            r["days_max"],
        )
        for r in result
    }

    assert measured == {
        (1, "allocation", "2026-07", KHAN): (2, 0, 3.0, 1.5, 1.5, 1.9, 2.0),
        (1, "allocation", "2026-08", JONES): (1, 0, 32.0, 32.0, 32.0, 32.0, 32.0),
        (2, "review", "2026-07", KHAN): (2, 0, 5.5, 2.75, 2.75, 3.75, 4.0),
        # Out of order: visible, and kept out of every statistic.
        (2, "review", "2026-07", JONES): (0, 1, 0.0, None, None, None, None),
        # c1 only: c2 took no actions path, and c3 is not Completed yet.
        (3, "remediation", "2026-07", KHAN): (1, 0, 4.0, 4.0, 4.0, 4.0, 4.0),
        (4, "to_reportable", "2026-07", KHAN): (2, 0, 8.5, 4.25, 4.25, 4.85, 5.0),
        (4, "to_reportable", "2026-07", JONES): (1, 0, 19.0, 19.0, 19.0, 19.0, 19.0),
        (5, "end_to_end", "2026-07", KHAN): (2, 0, 12.5, 6.25, 6.25, 8.45, 9.0),
    }
    # Sorted into lifecycle order, not by leg name.
    assert [r["leg"] for r in result][:2] == ["allocation", "allocation"]
    assert {r["brand"] for r in result} == {UNKNOWN_BRAND}


def test_lifecycle_duration_leaves_void_cases_out():
    cases = [
        *LIFECYCLE_CASES,
        _case(
            "c4",
            "Void",
            created="2026-07-01T09:00:00+00:00",
            assigned_at="2026-07-05T09:00:00+00:00",
            voided_at="2026-07-06T09:00:00+00:00",
        ),
    ]
    result = _rows(metrics.case_lifecycle_duration(_current(cases), as_of=AS_OF))
    [allocation] = [
        r
        for r in result
        if (r["leg"], r["ended_month"], r["assigned_reviewer_name"])
        == ("allocation", "2026-07", KHAN)
    ]

    assert (allocation["case_count"], allocation["days_total"]) == (2, 3.0)


def test_lifecycle_duration_files_a_leg_under_the_month_it_ended_in(monkeypatch):
    # 31 Jul 23:30 UTC is 1 Aug at UTC+1.
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    cases = [
        _case(
            "c1",
            "In-progress",
            assigned_reviewer_name=None,
            created="2026-07-30T23:30:00+00:00",
            assigned_at="2026-07-31T23:30:00+00:00",
        )
    ]
    [row] = _rows(metrics.case_lifecycle_duration(_current(cases), as_of=AS_OF))

    assert (row["leg"], row["ended_month"]) == ("allocation", "2026-08")
    assert row["assigned_reviewer_name"] == UNASSIGNED
    assert row["days_total"] == 1.0


def test_outcome_counts_reportable_non_void_cases_by_effective_outcome():
    cases = [
        _case(
            "c1",
            "Completed",
            reportable_at="2026-07-06T09:00:00+00:00",
            effective_outcome="Upheld",
            effective_had_remediation=1,
            outcome_overridden=0,
        ),
        _case(
            "c2",
            "Actions In Progress",
            reportable_at="2026-07-20T09:00:00+00:00",
            effective_outcome="Upheld",
            effective_had_remediation=1,
            outcome_overridden=1,
        ),
        # Voided after it became Reportable: never a check, so not counted.
        _case(
            "c3",
            "Void",
            reportable_at="2026-07-10T09:00:00+00:00",
            effective_outcome="Upheld",
        ),
        # Not Reportable yet.
        _case("c4", "In-progress", effective_outcome="Upheld"),
        _case(
            "c5",
            "Completed",
            assigned_reviewer_name=JONES,
            reportable_at="2026-07-31T09:00:00+00:00",
        ),
        _case(
            "c6",
            "Completed",
            assigned_reviewer_name=None,
            reportable_at="2026-08-01T09:00:00+00:00",
            effective_outcome="Not upheld",
            effective_had_remediation=0,
            outcome_overridden=0,
        ),
    ]
    result = _rows(metrics.case_outcome(_current(cases), as_of=AS_OF))

    assert [
        (
            r["reportable_month"],
            r["assigned_reviewer_name"],
            r["effective_outcome"],
            r["case_count"],
            r["remediation_count"],
            r["overridden_count"],
        )
        for r in result
    ] == [
        ("2026-07", KHAN, "Upheld", 2, 2, 1),
        ("2026-07", JONES, UNSTATED, 1, 0, 0),
        ("2026-08", UNASSIGNED, "Not upheld", 1, 0, 0),
    ]
    assert {(r["brand"], r["case_type"]) for r in result} == {
        (UNKNOWN_BRAND, "complaints")
    }


# --- the workload and calibration metrics -----------------------------------


def test_due_profile_buckets_each_clocks_open_cases_by_local_calendar_days():
    cases = [
        # Eight days over, then seven: the edge between the two overdue buckets.
        _case("a", "In-progress", due_date="2026-08-12T00:00:00+00:00"),
        _case("b", "In-progress", due_date="2026-08-13T00:00:00+00:00", on_hold=1),
        _case("c", "In-progress", due_date="2026-08-20T23:00:00+00:00"),
        _case("d", "In-progress", due_date="2026-08-27T00:00:00+00:00"),
        _case("e", "In-progress", due_date="2026-08-28T00:00:00+00:00"),
        _case("f", "In-progress", assigned_reviewer_name=JONES),
        _case(
            "g", "Actions In Progress", remediation_due_date="2026-08-25T00:00:00+00:00"
        ),
        # On no clock: unclaimed, or no longer open.
        _case("h", "To-allocate", due_date="2026-08-01T00:00:00+00:00"),
        _case("i", "Completed", due_date="2026-08-01T00:00:00+00:00"),
    ]
    result = _rows(metrics.case_due_profile(_current(cases), as_of=AS_OF))

    assert [
        (
            r["sla_kind"],
            r["assigned_reviewer_name"],
            r["due_bucket_order"],
            r["due_bucket"],
            r["case_count"],
            r["on_hold_count"],
        )
        for r in result
    ] == [
        ("remediation", KHAN, 4, "due_1_7", 1, 0),
        ("review", KHAN, 1, "overdue_8_plus", 1, 0),
        ("review", KHAN, 2, "overdue_1_7", 1, 1),
        ("review", KHAN, 3, "due_today", 1, 0),
        ("review", KHAN, 4, "due_1_7", 1, 0),
        ("review", KHAN, 5, "due_8_plus", 1, 0),
        ("review", JONES, 6, "no_due_date", 1, 0),
    ]


def test_due_profile_judges_a_due_date_on_the_local_calendar(monkeypatch):
    # 19 Aug 23:30 UTC is 20 Aug at UTC+1: due today there, not overdue.
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    cases = [_case("a", "In-progress", due_date="2026-08-19T23:30:00+00:00")]
    [row] = _rows(metrics.case_due_profile(_current(cases), as_of=AS_OF))

    assert row["due_bucket"] == "due_today"


def _answer(case_id, question_id, required, status):
    return {
        "case_id": case_id,
        "case_type": "complaints",
        "question_id": question_id,
        "remediation_required": required,
        "remediation_status": status,
    }


def _action(case_id, question_id, action_id):
    return {
        "case_id": case_id,
        "case_type": "complaints",
        "question_id": question_id,
        "action_id": action_id,
    }


def test_remediation_overdue_counts_whats_outstanding_on_cases_past_their_date():
    def past_due(case_id, due, **overrides):
        return _case(
            case_id, "Actions In Progress", remediation_due_date=due, **overrides
        )

    cases = [
        past_due("r1", "2026-08-13T00:00:00+00:00", responsible_party_name="P.ONE"),
        past_due("r2", "2026-08-12T00:00:00+00:00", responsible_party_name="P.ONE"),
        past_due("r3", "2026-07-01T00:00:00+00:00"),
        past_due("r4", "2026-08-20T00:00:00+00:00"),  # due today: not past it
        past_due("r5", None),
        # Past the date, but not on the remediation clock.
        _case("r6", "In-progress", remediation_due_date="2026-08-01T00:00:00+00:00"),
    ]
    answers = [
        _answer("r1", "q1", "yes", None),  # outstanding
        _answer("r1", "q2", "yes", "complete"),
        _answer("r1", "q3", "no", None),
        _answer("r2", "q1", "yes", "partial"),
        _answer("r3", "q1", "yes", None),
        _answer("r4", "q1", "yes", None),
    ]
    actions = [
        _action("r1", "q1", "a1"),
        _action("r1", "q1", "a2"),
        _action("r1", "q2", "a3"),  # on a resolved Answer
        _action("r4", "q1", "a4"),
    ]
    result = _rows(
        metrics.remediation_overdue(
            _current(cases),
            given_rows(answers).read(),
            given_rows(actions).read(),
            as_of=AS_OF,
        )
    )

    assert [
        (
            r["responsible_party_name"],
            r["days_over_bucket_order"],
            r["days_over_bucket"],
            r["case_count"],
            r["outstanding_answer_count"],
            r["outstanding_action_count"],
            r["days_over_max"],
        )
        for r in result
    ] == [
        (UNASSIGNED, 4, "over_29_plus", 1, 1, 0, 50),
        ("P.ONE", 1, "over_1_7", 1, 1, 2, 7),
        # Every Answer resolved: waiting to be Completed, still past its date.
        ("P.ONE", 2, "over_8_14", 1, 0, 0, 8),
    ]
    assert {r["assigned_reviewer_name"] for r in result} == {KHAN}


def test_reviewer_workload_sets_work_in_hand_against_four_weeks_of_output():
    cases = [
        _case("w1", "In-progress", assigned_at="2026-08-10T15:00:00+00:00"),
        _case("w2", "In-progress", assigned_at="2026-08-17T09:00:00+00:00", on_hold=1),
        # Held, but not in progress: not a held in-progress Case.
        _case(
            "w3",
            "Actions In Progress",
            reportable_at="2026-08-01T09:00:00+00:00",
            on_hold=1,
        ),
        # The window's first day is in, the day before is not; Void is never output.
        _case("w4", "Completed", reportable_at="2026-07-24T09:00:00+00:00"),
        _case("w5", "Completed", reportable_at="2026-07-23T09:00:00+00:00"),
        _case("w6", "In-progress", assigned_reviewer_name=JONES),
        _case("w7", "Void", reportable_at="2026-08-15T09:00:00+00:00"),
    ]
    result = _rows(
        metrics.reviewer_workload(_current(cases), _no_history(), as_of=AS_OF)
    )

    assert result == [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "assigned_reviewer_name": KHAN,
            "in_progress_count": 2,
            "in_progress_on_hold_count": 1,
            "actions_in_progress_count": 1,
            "oldest_in_progress_days": 10.0,
            "reportable_last_28_days_count": 2,
            # Two in hand at half a Case a week.
            "weeks_of_work": 4.0,
            "as_of_utc": AS_OF,
        },
        {
            "brand": UNKNOWN_BRAND,
            "case_type": "complaints",
            "assigned_reviewer_name": JONES,
            "in_progress_count": 1,
            "in_progress_on_hold_count": 0,
            "actions_in_progress_count": 0,
            "oldest_in_progress_days": None,
            "reportable_last_28_days_count": 0,
            "weeks_of_work": None,
            "as_of_utc": AS_OF,
        },
    ]


def _no_history() -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(columns=metrics.HISTORY_COLUMNS))


def test_reviewer_workload_ages_a_reopened_case_from_its_return_to_in_progress():
    # Assigned 4 Jul, Completed 10 Jul, reopened 15 Jul, measured 20 Jul: five
    # days in progress, not sixteen. w2 has no history, so its assigned_at
    # stands (8 Jul: twelve days).
    as_of = "2026-07-20T06:00:00+00:00"
    history = [
        _observation(
            "w1",
            "a",
            "2026-07-04T10:00:00+00:00",
            "In-progress",
            assigned_at="2026-07-04T09:00:00+00:00",
        ),
        _observation("w1", "b", "2026-07-10T09:00:00+00:00", "Completed"),
        _observation("w1", "c", "2026-07-15T09:00:00+00:00", "In-progress"),
    ]
    cases = [
        _case("w1", "In-progress", assigned_at="2026-07-04T09:00:00+00:00"),
        _case("w2", "In-progress", assigned_at="2026-07-08T09:00:00+00:00"),
    ]

    def oldest(rows):
        [row] = _rows(
            metrics.reviewer_workload(
                _current(rows), given_rows(history).read(), as_of=as_of
            )
        )
        return row["oldest_in_progress_days"]

    assert oldest(cases[:1]) == 5.0
    assert oldest(cases) == 12.0


def _appeal(case_id, appeal_id, state, verdict=None):
    return {
        "case_id": case_id,
        "case_type": "complaints",
        "appeal_id": appeal_id,
        "raised_at": "2026-08-01T09:00:00+00:00",
        "state": state,
        "resolution_verdict": verdict,
        "resolution_at": None,
        "cited_question_ids_json": "[]",
    }


def test_appeal_rate_counts_appeals_onto_the_cases_reportable_month():
    cases = [
        _case("a1", "Completed", reportable_at="2026-07-06T09:00:00+00:00"),
        _case("a2", "Completed", reportable_at="2026-07-20T09:00:00+00:00"),
        _case("a3", "Actions In Progress", reportable_at="2026-08-02T09:00:00+00:00"),
        # Void: never a check, so neither it nor its Appeal is counted.
        _case("a4", "Void", reportable_at="2026-07-10T09:00:00+00:00"),
    ]
    appeals = [
        _appeal("a1", "ap1", "resolved", "agreed"),
        _appeal("a1", "ap2", "resolved", "rejected"),
        _appeal("a3", "ap3", "underReview"),  # open until resolved
        _appeal("a4", "ap4", "resolved", "agreed"),
    ]
    result = _rows(
        metrics.appeal_rate_by_reviewer(
            _current(cases), given_rows(appeals).read(), as_of=AS_OF
        )
    )

    assert [
        (
            r["reportable_month"],
            r["reportable_count"],
            r["appealed_case_count"],
            r["appeal_count"],
            r["open_appeal_count"],
            r["agreed_appeal_count"],
            r["rejected_appeal_count"],
        )
        for r in result
    ] == [
        ("2026-07", 2, 1, 2, 0, 1, 1),
        ("2026-08", 1, 1, 1, 1, 0, 0),
    ]
    assert {r["assigned_reviewer_name"] for r in result} == {KHAN}


def test_appeal_rate_with_no_appeals_still_counts_the_reportable_cases():
    cases = [_case("a1", "Completed", reportable_at="2026-07-06T09:00:00+00:00")]
    empty = Dataset.from_pandas(pd.DataFrame(columns=metrics.APPEAL_COLUMNS))
    [row] = _rows(metrics.appeal_rate_by_reviewer(_current(cases), empty, as_of=AS_OF))

    assert (row["reportable_count"], row["appeal_count"]) == (1, 0)


def test_every_metric_carries_syncs_snapshot_instant_and_refuses_an_empty_one():
    with pytest.raises(ValueError, match="case_current is empty"):
        metrics.snapshot_as_of(Dataset.from_pandas(pd.DataFrame(columns=["as_of_utc"])))

    assert metrics.snapshot_as_of(_current()) == AS_OF


# --- end to end -------------------------------------------------------------


@pytest.fixture
def base_dir(tmp_path):
    """Both subjects this pipeline touches, migrated: Sync's silver and gold
    (what it reads) and this subject's gold (what it writes)."""
    return build_databases(
        tmp_path,
        f"{SYNC_SUBJECT}/silver",
        f"{SYNC_SUBJECT}/gold",
        "cora_platform_metric/gold",
    )


# A Case past its Remediation Due Date, seeded for the end-to-end test only.
PAST_DUE_REMEDIATION = _case(
    "c5",
    "Actions In Progress",
    responsible_party_name="P.ONE",
    reportable_at="2026-07-30T09:00:00+00:00",
    remediation_due_date="2026-08-13T00:00:00+00:00",
)
PAST_DUE_ANSWER = {
    "case_id": "c5",
    "case_type": "complaints",
    "question_id": "q1",
    "remediation_required": "yes",
    "remediation_status": None,
}
PAST_DUE_ACTION = {
    "case_id": "c5",
    "case_type": "complaints",
    "question_id": "q1",
    "action_id": "a9",
}


def _seed_sync(base_dir) -> None:
    sync = medallion(StoreRegistry(base_dir), SYNC_SUBJECT)
    sync.silver.writer("case_version", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(HISTORY))
    )
    for table, rows in (
        ("case_current", [*CURRENT, PAST_DUE_REMEDIATION]),
        ("answer", [*ANSWERS, PAST_DUE_ANSWER]),
        ("answer_action", [*ACTIONS, PAST_DUE_ACTION]),
        ("appeal", APPEALS),
        ("conversation_message", MESSAGES),
    ):
        sync.gold.writer(table, Refresh()).write(
            Dataset.from_pandas(pd.DataFrame(rows))
        )


def test_main_reads_sync_and_refreshes_every_table_through_the_migrated_path(
    base_dir,
):
    _seed_sync(base_dir)

    assert main(["prog", "--base-dir", str(base_dir)]) == 0

    gold = medallion(StoreRegistry(base_dir), "cora_platform_metric").gold
    for table, contract in GOLD_TABLES:
        rows = read_rows(gold, table)
        assert rows, table
        for row in rows:
            assert row.pop(RUN_PROVENANCE_COLUMN)
            assert row["as_of_utc"] == AS_OF
            # Every column the contract declares landed, and nothing the
            # contract does not declare did.
            assert set(row) == {f for f in contract.__dataclass_fields__}, table

    [hold] = [
        r
        for r in read_rows(gold, "case_hold_current")
        if r["assigned_reviewer_name"] == JONES
    ]
    assert hold["open_hold_count"] == 1

    # A second run over a Sync snapshot with one fewer hold replaces, rather
    # than accumulates: every table is a Refresh.
    sync = medallion(StoreRegistry(base_dir), SYNC_SUBJECT)
    sync.silver.writer("case_version", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(HISTORY[:5]))
    )
    assert main(["prog", "--base-dir", str(base_dir)]) == 0
    assert [
        r["assigned_reviewer_name"] for r in read_rows(gold, "case_hold_current")
    ] == [KHAN]


def test_the_pipeline_declares_sync_as_its_freshness_upstream():
    [requirement] = UPSTREAMS
    assert isinstance(requirement, FreshnessRequirement)
    assert requirement.upstream_pipeline == "sharepoint_cases"
    assert requirement.max_age_days == 0


def test_a_source_missing_a_column_a_metric_needs_fails_that_step(tmp_path, capsys):
    # An unmigrated directory, so the narrowed table really lacks the column
    # (a migrated one would keep the declared column and land NULLs).
    _seed_sync(tmp_path)
    sync = medallion(StoreRegistry(tmp_path), SYNC_SUBJECT)
    narrowed = [{k: v for k, v in row.items() if k != "posted_at"} for row in MESSAGES]
    sync.gold.writer("conversation_message", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(narrowed))
    )

    assert main(["prog", "--base-dir", str(tmp_path)]) == 1

    assert "posted_at" in capsys.readouterr().err
    # The gate sits inside the step that uses the column, so the tables before
    # it are refreshed and the one that needed it is not.
    gold = medallion(StoreRegistry(tmp_path), "cora_platform_metric").gold
    assert gold.columns_of("case_stage_dwell_current").columns() is not None
    assert gold.columns_of("conversation_response_time_current").columns() is None
