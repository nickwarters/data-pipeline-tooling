"""Tests for the ``cora_platform_metric`` Reporting pipeline.

Each reduction is exercised on a handful of rows whose answer can be checked by
hand, then one end-to-end run lands every table through the migrated write
path from a seeded Sync subject.
"""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd
import pytest

from case_review.pass_rules import STANDARD, STRICT, PassRule
from framework.core import RUN_PROVENANCE_COLUMN, Dataset
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
from pipelines.sharepoint_cases.schema import FEED_NAME as SYNC_SUBJECT
from readers.question_banks import QuestionBankStore
from tests.framework_testing import build_databases, given_rows, read_rows, rows_of
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
) -> dict[str, object]:
    return {
        "case_type": "complaints",
        "source_item_id": item,
        "source_observation_id": observation_id,
        "source_version": '"1"',
        "source_modified_at": modified,
        "status": status,
        "assigned_reviewer_name": reviewer,
        "created": created,
        "assigned_at": assigned_at,
        "on_hold": on_hold,
        "placed_on_hold_at": placed_on_hold_at,
    }


def _case(case_id: str, status: str, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "case_id": case_id,
        "case_type": "complaints",
        "status": status,
        "assigned_reviewer_manager_name": "M.ONE",
        "responsible_party_manager_name": "R.ONE",
        "due_date": None,
        "remediation_due_date": None,
        "completed_at": None,
        "created": "2026-07-01T09:00:00+00:00",
        "voided_at": None,
        "void_reason": None,
        "voided_by_name": None,
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

# Answers on questions the bundled complaints bank really carries, so the
# end-to-end run judges them against the current bank as published.
ANSWERS = [
    {
        "case_id": "c1",
        "case_type": "complaints",
        "question_id": "q-cmp-0001",
        "value_json": "Poor",
        "remediation_required": "yes",
        "remediation_status": "complete",
    },
    {
        "case_id": "c1",
        "case_type": "complaints",
        "question_id": "q-cmp-0002",
        "value_json": "Good",
        "remediation_required": "no",
        "remediation_status": None,
    },
    {
        "case_id": "c4",
        "case_type": "complaints",
        "question_id": "q-cmp-0001",
        "value_json": "Good with process enhancement",
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


def test_conversation_response_time_measures_replies_across_an_author_change():
    [row] = _rows(
        metrics.conversation_response_time(given_rows(MESSAGES).read(), as_of=AS_OF)
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


def test_conversation_posting_pattern_with_no_messages_has_no_grid():
    empty = Dataset.from_pandas(pd.DataFrame(columns=metrics.CONVERSATION_COLUMNS))

    assert (
        _rows(metrics.conversation_posting_pattern(empty, _current(), as_of=AS_OF))
        == []
    )


def test_every_metric_carries_syncs_snapshot_instant_and_refuses_an_empty_one():
    with pytest.raises(ValueError, match="case_current is empty"):
        metrics.snapshot_as_of(Dataset.from_pandas(pd.DataFrame(columns=["as_of_utc"])))

    assert metrics.snapshot_as_of(_current()) == AS_OF


# --- pass rate against the Question Bank ------------------------------------


def _question(question_id: str, option_outcomes, **overrides) -> dict[str, object]:
    """A bank row as ``readers.question_banks`` lands it."""
    row: dict[str, object] = {
        "slug": "complaints",
        "id": question_id,
        "question_group": "Intake",
        "deprecated": False,
        "option_outcomes": None
        if option_outcomes is None
        else json.dumps(option_outcomes),
    }
    row.update(overrides)
    return row


OUTCOME_OPTIONS = {
    "Good": "good",
    "Good with process enhancement": "good-with-process-enhancement",
    "Poor": "poor",
    "Poor with harm": "poor-with-harm",
}

BANK = [
    _question("q-a", OUTCOME_OPTIONS),
    # A multi-choice whose NA maps to an outcome no rule has to classify.
    _question(
        "q-b",
        {"Process": "good", "Training": "poor", "NA": "not-applicable"},
        question_group=None,
    ),
    # Informational: no outcomes, so nothing it is answered with can fail.
    _question("q-c", None, deprecated=True),
]


def _answer(case_id: str, question_id: str, value_json) -> dict[str, object]:
    return {
        "case_id": case_id,
        "case_type": "complaints",
        "question_id": question_id,
        "value_json": value_json,
        "remediation_required": None,
        "remediation_status": None,
    }


PASS_RATE_ANSWERS = [
    _answer("c1", "q-a", "Good"),
    _answer("c2", "q-a", "Good with process enhancement"),
    _answer("c4", "q-a", "Poor"),
    _answer("c3", "q-a", "Poor with harm"),  # void Case: not counted
    _answer("c1", "q-b", '["Process", "Training"]'),  # one fail, not two
    _answer("c2", "q-b", '["NA"]'),
    _answer("c4", "q-b", ""),
    _answer("c1", "q-c", "Whatever"),
    _answer("c2", "q-c", "NA"),
    _answer("c4", "q-c", "[]"),
]


def _answers(rows) -> Dataset:
    """An answer dataset that keeps its columns even when it has no rows."""
    return Dataset.from_pandas(pd.DataFrame(rows, columns=metrics.ANSWER_COLUMNS))


def _pass_rate(answers=PASS_RATE_ANSWERS, bank=BANK, **kwargs) -> list[dict]:
    return _rows(
        metrics.answer_pass_rate(
            _answers(answers),
            given_rows(bank).read(),
            _current(),
            as_of=AS_OF,
            **kwargs,
        )
    )


def _pass_rate_row(**fields) -> dict[str, object]:
    row = {"brand": UNKNOWN_BRAND, "case_type": "complaints", "as_of_utc": AS_OF}
    row.update(fields)
    return row


def test_answer_pass_rate_judges_each_answer_under_each_rule():
    result = _pass_rate()

    multi = dict(
        question_id="q-b",
        question_group=UNSTATED,
        deprecated=False,
        can_fail=True,
        answer_count=3,
        unanswered_count=1,
        na_count=1,
        pass_count=0,
        fail_count=1,
        pass_rate=0.0,
    )
    informational = dict(
        question_id="q-c",
        question_group="Intake",
        deprecated=True,
        can_fail=False,
        answer_count=3,
        unanswered_count=1,
        na_count=1,
        pass_count=1,
        fail_count=0,
        pass_rate=1.0,
    )
    assert result == [
        # standard: Good and Good with process enhancement pass; Poor fails.
        _pass_rate_row(
            pass_rule="standard",
            question_id="q-a",
            question_group="Intake",
            deprecated=False,
            can_fail=True,
            answer_count=3,
            unanswered_count=0,
            na_count=0,
            pass_count=2,
            fail_count=1,
            pass_rate=0.6667,
        ),
        _pass_rate_row(pass_rule="standard", **multi),
        _pass_rate_row(pass_rule="standard", **informational),
        # strict: only Good passes.
        _pass_rate_row(
            pass_rule="strict",
            question_id="q-a",
            question_group="Intake",
            deprecated=False,
            can_fail=True,
            answer_count=3,
            unanswered_count=0,
            na_count=0,
            pass_count=1,
            fail_count=2,
            pass_rate=0.3333,
        ),
        _pass_rate_row(pass_rule="strict", **multi),
        _pass_rate_row(pass_rule="strict", **informational),
    ]
    for row in result:
        assert row["answer_count"] == (
            row["unanswered_count"]
            + row["na_count"]
            + row["pass_count"]
            + row["fail_count"]
        )


def test_answer_pass_rate_takes_the_rules_it_is_given():
    lenient = PassRule(
        name="lenient",
        passing={"complaints": tuple(OUTCOME_OPTIONS.values())},
        failing={"complaints": ()},
    )
    result = _pass_rate(rules=(lenient,))

    assert [r["pass_rule"] for r in result] == ["lenient"] * 3
    assert [(r["question_id"], r["can_fail"], r["fail_count"]) for r in result] == [
        ("q-a", False, 0),
        ("q-b", False, 0),
        ("q-c", False, 0),
    ]


@pytest.mark.parametrize(
    ("value_json", "expected"),
    [
        (None, []),
        (float("nan"), []),
        ("", []),
        ("[]", []),
        ('["", null]', []),
        ("Good", ["Good"]),
        ("NA", ["NA"]),
        ('["Process", "Training"]', ["Process", "Training"]),
        ("[not json", ["[not json"]),
    ],
)
def test_selected_reads_value_json_as_the_lossless_copy(value_json, expected):
    assert metrics._selected(value_json) == expected


@pytest.mark.parametrize(
    ("passing", "failing", "problem", "ids"),
    [
        # Leaves a bank outcome unclassified.
        (
            ("good", "good-with-process-enhancement"),
            ("poor",),
            "declared by the bank but unclassified",
            "['poor-with-harm']",
        ),
        # Names an outcome the bank lacks.
        (
            ("good", "good-with-process-enhancement", "excellent"),
            ("poor", "poor-with-harm"),
            "classified but not in the bank",
            "['excellent']",
        ),
        # Lists one in both sets.
        (
            ("good", "good-with-process-enhancement", "poor"),
            ("poor", "poor-with-harm"),
            "classified as both pass and fail",
            "['poor']",
        ),
    ],
)
def test_a_rule_that_disagrees_with_the_bank_fails_the_run_naming_the_ids(
    passing, failing, problem, ids
):
    rule = PassRule(
        name="drifted", passing={"complaints": passing}, failing={"complaints": failing}
    )

    with pytest.raises(ValueError, match="pass rule 'drifted'") as error:
        _pass_rate(rules=(rule,))

    message = str(error.value)
    assert "'complaints'" in message
    assert problem in message
    assert ids in message


def test_a_rule_is_checked_against_the_bank_even_with_nothing_to_judge():
    with pytest.raises(ValueError, match="not in the bank"):
        _pass_rate(answers=[], bank=[_question("q-a", {"Good": "good"})])


def test_answers_on_a_case_type_no_rule_covers_fail_the_run_naming_it():
    stray = _answer("c1", "q-x", "Good") | {"case_type": "claims"}
    bank = BANK + [_question("q-x", OUTCOME_OPTIONS, slug="claims")]

    with pytest.raises(ValueError, match=r"no PassRule covers: \['claims'\]"):
        _pass_rate(answers=PASS_RATE_ANSWERS + [stray], bank=bank)


def test_an_answer_on_a_question_absent_from_the_bank_fails_the_run_naming_it():
    stray = _answer("c1", "q-gone", "Good")

    with pytest.raises(ValueError, match=r"absent from the current Question Bank"):
        _pass_rate(answers=PASS_RATE_ANSWERS + [stray])

    with pytest.raises(ValueError, match=r"\('complaints', 'q-gone'\)"):
        _pass_rate(answers=PASS_RATE_ANSWERS + [stray])


def test_answers_on_void_cases_are_not_judged():
    only_void = [_answer("c3", "q-a", "Poor with harm")]

    assert _pass_rate(answers=only_void) == []


def test_answer_pass_rate_with_no_answers_lands_the_declared_shape():
    result = metrics.answer_pass_rate(
        _answers([]), given_rows(BANK).read(), _current(), as_of=AS_OF
    )

    assert len(result) == 0
    assert list(result.columns) == [
        "pass_rule",
        "brand",
        "case_type",
        "question_id",
        "question_group",
        "deprecated",
        "can_fail",
        "answer_count",
        "unanswered_count",
        "na_count",
        "pass_count",
        "fail_count",
        "pass_rate",
        "as_of_utc",
    ]


def test_the_declared_rules_are_complete_against_the_bundled_complaints_bank():
    # The real bank, as the pipeline reads it: every outcome it declares is
    # classified by every declared rule, so a bank edit surfaces here first.
    bank = rows_of(QuestionBankStore().qb_reader("complaints").read())
    answers = [_answer("c1", bank[0]["id"], "Good")]

    result = _pass_rate(answers=answers, bank=bank, rules=(STANDARD, STRICT))

    assert [(r["pass_rule"], r["pass_count"]) for r in result] == [
        ("standard", 1),
        ("strict", 1),
    ]


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


def _seed_sync(base_dir) -> None:
    sync = medallion(StoreRegistry(base_dir), SYNC_SUBJECT)
    sync.silver.writer("case_version", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(HISTORY))
    )
    for table, rows in (
        ("case_current", CURRENT),
        ("answer", ANSWERS),
        ("answer_action", ACTIONS),
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

    # Judged against the bundled complaints bank: c1 answered Poor and c4
    # Good with process enhancement on q-cmp-0001, c1 Good on q-cmp-0002.
    pass_rate = read_rows(gold, "answer_pass_rate_current")
    assert [
        (
            r["pass_rule"],
            r["question_id"],
            r["pass_count"],
            r["fail_count"],
            r["pass_rate"],
        )
        for r in pass_rate
    ] == [
        ("standard", "q-cmp-0001", 1, 1, 0.5),
        ("standard", "q-cmp-0002", 1, 0, 1.0),
        ("strict", "q-cmp-0001", 0, 2, 0.0),
        ("strict", "q-cmp-0002", 1, 0, 1.0),
    ]
    for row in pass_rate:
        assert row["can_fail"] == 1 and row["deprecated"] == 0
        assert row["answer_count"] == (
            row["unanswered_count"]
            + row["na_count"]
            + row["pass_count"]
            + row["fail_count"]
        )

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
