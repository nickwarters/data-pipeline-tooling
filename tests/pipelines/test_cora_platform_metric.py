"""Tests for the ``cora_platform_metric`` Reporting pipeline.

Each reduction is exercised on a handful of rows whose answer can be checked by
hand, then one end-to-end run lands every table through the migrated write
path from a seeded Sync subject.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from framework.core import (
    RUN_PROVENANCE_COLUMN,
    Dataset,
    SchemaValidator,
    ValidationError,
)
from framework.io import Refresh
from framework.run import FreshnessRequirement, run_pipeline
from pipelines.cora_platform_metric import metrics
from pipelines.cora_platform_metric.metrics import (
    UNASSIGNED,
    UNKNOWN_BRAND,
    UNRESOLVED,
    UNSTATED,
)
from pipelines.cora_platform_metric.pipeline import (
    ACCUMULATED_TABLES,
    GOLD_TABLES,
    PIPELINE_NAME,
    UPSTREAMS,
    main,
    run,
)
from pipelines.cora_platform_metric.schema import (
    AnswerActionLoad,
    CaseDurationPercentilesDaily,
)
from pipelines.sharepoint_cases.schema import FEED_NAME as SYNC_SUBJECT
from tests.framework_testing import (
    build_databases,
    given_rows,
    read_rows,
    read_run_log,
)
from tools.calendar import WorkingDayCalendar
from tools.medallion import medallion
from tools.observability import timestamps
from tools.observability.run_store import RunStore
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


def _case(key: str, status: str, **overrides: object) -> dict[str, object]:
    # No ``case_id``: it lives on ``case_current`` alone and the metrics never
    # read it, so a stray use of it fails here rather than passing. A Case is its
    # ``(case_type, source_item_id)``.
    row: dict[str, object] = {
        "source_item_id": key,
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
        "amended_outcome_id": None,
        "amended_at": None,
        "has_open_appeal": None,
        "appeal_raised_at": None,
        "awaiting_responsible_party": None,
        "awaiting_since": None,
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
        "source_item_id": "c1",
        "case_type": "complaints",
        "question_id": "q1",
        "remediation_required": "yes",
        "remediation_status": "complete",
    },
    {
        "source_item_id": "c1",
        "case_type": "complaints",
        "question_id": "q2",
        "remediation_required": "no",
        "remediation_status": None,
    },
    {
        "source_item_id": "c4",
        "case_type": "complaints",
        "question_id": "q1",
        "remediation_required": "yes",
        "remediation_status": "partial",
    },
]

ACTIONS = [
    {
        "source_item_id": "c1",
        "case_type": "complaints",
        "question_id": "q1",
        "action_id": "a1",
    },
    {
        "source_item_id": "c1",
        "case_type": "complaints",
        "question_id": "q1",
        "action_id": "a2",
    },
    {
        "source_item_id": "c4",
        "case_type": "complaints",
        "question_id": "q1",
        "action_id": "a3",
    },
]

APPEALS = [
    {
        "source_item_id": "c1",
        "case_type": "complaints",
        "appeal_id": "ap1",
        "raised_at": "2026-07-11T09:00:00+00:00",
        "state": "resolved",
        "resolution_verdict": "agreed",
        "resolution_at": "2026-07-13T09:00:00+00:00",
        "cited_question_ids_json": '["q1", "q2"]',
    },
    {
        "source_item_id": "c4",
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
        "source_item_id": "c1",
        "case_type": "complaints",
        "seq": 1,
        "author_login": "a.khan",
        "posted_at": "2026-07-05T09:00:00+00:00",
    },
    {
        "source_item_id": "c1",
        "case_type": "complaints",
        "seq": 2,
        "author_login": "a.khan",
        "posted_at": "2026-07-05T10:00:00+00:00",
    },
    {
        "source_item_id": "c1",
        "case_type": "complaints",
        "seq": 3,
        "author_login": "r.party",
        "posted_at": "2026-07-05T13:00:00+00:00",
    },
    {
        "source_item_id": "c1",
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


def _history(rows) -> Dataset:
    """Observations as the history reductions take them: ordered once."""
    return metrics.ordered_history(given_rows(rows).read())


# --- the history metrics ----------------------------------------------------


def test_stage_dwell_closes_an_interval_at_each_observed_status_change():
    result = _rows(metrics.case_stage_dwell(_history(HISTORY), as_of=AS_OF))

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
    [row] = _rows(metrics.case_stage_dwell(_history(history), as_of=AS_OF))

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
    result = _rows(metrics.case_stage_dwell(_history(history), as_of=AS_OF))
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
    result = _rows(metrics.case_stage_dwell(_history(history), as_of=AS_OF))

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
    result = _rows(metrics.case_stage_dwell(_history(history), as_of=AS_OF))

    assert [(r["status"], r["open_interval_count"]) for r in result] == [
        ("In-progress", 0)
    ]


def test_an_unparseable_modified_drops_the_observation_from_every_history_table():
    history = [
        _observation("1", "a", "2026-07-01T09:00:00+00:00", "To-allocate"),
        _observation("1", "b", "not a time", "In-progress"),
    ]
    observations = _history(history)
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
    result = metrics.case_backlog(_history(history), as_of=as_of)

    assert _counts(result, "backlog_date") == {
        ("2026-07-01", "To-allocate"): 1,
        ("2026-07-02", "In-progress"): 1,
        ("2026-07-03", "In-progress"): 1,
        ("2026-07-04", "To-allocate"): 1,
    }


def test_hold_runs_from_the_source_stamp_or_the_observation_to_release_or_as_of():
    result = _rows(metrics.case_hold(_history(HISTORY), as_of=AS_OF))

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
    [row] = _rows(metrics.case_hold(_history(history), as_of=AS_OF))

    assert (row["open_hold_count"], row["held_days_total"]) == (0, 3.0)


def _hold_counts(history) -> tuple[int, int, int, float]:
    """(case_count, hold_count, open_hold_count, held_days_total) of one row."""
    [row] = _rows(metrics.case_hold(_history(history), as_of=AS_OF))
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

    assert len(metrics.case_hold(_history(history), as_of=AS_OF)) == 0


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


def test_a_nullable_boolean_hold_flag_reads_as_the_flag_it_carries():
    # SchemaCoercion lands a bool column as pandas' nullable "boolean"; NA
    # reads as not set, as NULL does.
    assert metrics._flagged(
        pd.Series([True, False, pd.NA], dtype="boolean")
    ).tolist() == [True, False, False]
    frame = _history(HISTORY).to_pandas()
    flags = frame.assign(on_hold=frame["on_hold"].astype(bool).astype("boolean"))

    assert _rows(metrics.case_hold(Dataset.from_pandas(flags), as_of=AS_OF)) == _rows(
        metrics.case_hold(_history(HISTORY), as_of=AS_OF)
    )


@pytest.mark.parametrize(
    "reduce",
    [
        lambda history: metrics.case_stage_dwell(history, as_of=AS_OF),
        lambda history: metrics.case_hold(history, as_of=AS_OF),
        lambda history: metrics.case_backlog(history, as_of=AS_OF),
        lambda history: metrics.reviewer_workload(_current(), history, as_of=AS_OF),
    ],
    ids=["stage_dwell", "hold", "backlog", "reviewer_workload"],
)
def test_a_history_reduction_names_ordered_history_when_handed_an_unordered_one(
    reduce,
):
    with pytest.raises(ValueError, match=r"ordered_history\(\)"):
        reduce(given_rows(HISTORY).read())


def test_a_history_with_no_holds_lands_the_declared_shape_and_no_rows():
    history = [_observation("1", "o1", "2026-07-02T09:00:00+00:00", "To-allocate")]
    result = metrics.case_hold(_history(history), as_of=AS_OF)

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


def _in_claims(rows):
    """The rows as another Case Type's, which numbers its items from the same
    start: ``claims`` rather than ``complaints``, the same ``source_item_id``."""
    return [{**row, "case_type": "claims"} for row in rows]


def test_the_same_item_id_in_another_case_type_is_not_merged_in_the_history():
    # Item 7 of complaints is waiting then claimed (and still in progress); item
    # 7 of claims is claimed then completed. Told apart: complaints' In-progress
    # stay is open, claims' closed. Merged on the item id alone, one Case's
    # Completed would end the other's stay.
    history = [
        _observation("7", "a", "2026-07-02T09:00:00+00:00", "To-allocate"),
        _observation("7", "c", "2026-07-04T09:00:00+00:00", "In-progress"),
        *_in_claims(
            [
                _observation("7", "b", "2026-07-03T09:00:00+00:00", "In-progress"),
                _observation("7", "d", "2026-07-05T09:00:00+00:00", "Completed"),
            ]
        ),
    ]
    result = _rows(metrics.case_stage_dwell(_history(history), as_of=AS_OF))

    assert [
        (r["case_type"], r["status"], r["interval_count"], r["open_interval_count"])
        for r in result
    ] == [
        ("claims", "In-progress", 1, 0),
        ("complaints", "In-progress", 0, 1),
        ("complaints", "To-allocate", 1, 0),
    ]


def test_the_same_item_id_in_another_case_type_is_held_separately():
    # Overlapping two-day holds on item 7 of two Case Types: two Cases, each held
    # once. Merged on the item id alone they would read as one Case.
    history = [
        _observation("7", "a", "2026-07-02T09:00:00+00:00", "In-progress", on_hold=1),
        _observation("7", "c", "2026-07-04T09:00:00+00:00", "In-progress"),
        *_in_claims(
            [
                _observation(
                    "7", "b", "2026-07-03T09:00:00+00:00", "In-progress", on_hold=1
                ),
                _observation("7", "d", "2026-07-05T09:00:00+00:00", "In-progress"),
            ]
        ),
    ]
    result = _rows(metrics.case_hold(_history(history), as_of=AS_OF))

    assert [
        (r["case_type"], r["case_count"], r["hold_count"], r["held_days_total"])
        for r in result
    ] == [("claims", 1, 1, 2.0), ("complaints", 1, 1, 2.0)]


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


@pytest.mark.parametrize(
    "calendar",
    [
        WorkingDayCalendar(),
        WorkingDayCalendar(holidays=[dt.date(2026, 7, 9), dt.date(2026, 7, 13)]),
        WorkingDayCalendar(holidays=["2026-07-09", dt.datetime(2026, 7, 13, 9)]),
        WorkingDayCalendar(weekend=[4]),
        WorkingDayCalendar(weekend=range(7)),
    ],
)
def test_the_column_form_of_working_days_late_agrees_with_the_day_walk(calendar):
    days = [dt.date(2026, 7, 1) + dt.timedelta(days=n) for n in range(16)]
    pairs = [(due, done) for due in days for done in days]
    late = metrics._working_days_late(
        calendar,
        pd.Series([pd.Timestamp(due) for due, _ in pairs] + [pd.NaT]),
        pd.Series([pd.Timestamp(done) for _, done in pairs] + [pd.Timestamp(days[0])]),
    )

    assert late.iloc[:-1].tolist() == [
        metrics.working_days_late(calendar, due, done) for due, done in pairs
    ]
    assert pd.isna(late.iloc[-1])

    # Signed, an early completion counts back: minus the day walk run from the
    # completion to the due date.
    signed = metrics._working_days_after(
        calendar,
        pd.Series([pd.Timestamp(due) for due, _ in pairs]),
        pd.Series([pd.Timestamp(done) for _, done in pairs]),
    )
    assert signed.tolist() == [
        metrics.working_days_late(calendar, due, done)
        - metrics.working_days_late(calendar, done, due)
        for due, done in pairs
    ]


def test_a_holiday_given_as_text_is_honoured_by_both_forms_of_lateness():
    # Due Wed 8 Jul, completed Fri 10 Jul, Thu 9 Jul a holiday given as text:
    # one working day late by the day walk and by the column form alike.
    calendar = WorkingDayCalendar(holidays=["2026-07-09"])
    due, done = dt.date(2026, 7, 8), dt.date(2026, 7, 10)

    assert metrics.working_days_late(calendar, due, done) == 1
    assert metrics._working_days_late(
        calendar, pd.Series([pd.Timestamp(due)]), pd.Series([pd.Timestamp(done)])
    ).tolist() == [1.0]


def test_grouped_statistics_match_each_groups_own_series_bit_for_bit():
    # The published rounding depends on the last bit of a sum or a quantile,
    # so the vectorised summaries must be the per-group Series figures exactly.
    rng = np.random.default_rng(1)
    frame = pd.DataFrame(
        {
            "a": rng.choice(["x", "y", None], 3000),
            "b": rng.integers(0, 40, 3000),
            "v": np.where(rng.random(3000) < 0.1, np.nan, rng.exponential(3, 3000)),
        }
    )
    stats = metrics._summaries(frame, ["a", "b"], "v")

    for (a, b), group in frame.groupby(["a", "b"], sort=True):
        values = group["v"].dropna()
        row = stats.loc[(a, b)]
        assert (row["rows"], row["count"]) == (len(group), len(values))
        assert row["total"] == values.sum()
        for statistic, expected in (
            ("mean", values.mean()),
            ("p50", values.quantile(0.5)),
            ("p90", values.quantile(0.9)),
            ("max", values.max()),
        ):
            assert row[statistic] == expected or (
                pd.isna(expected) and pd.isna(row[statistic])
            )


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
            "on_time_rate": 1.0,
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
            "on_time_rate": 0.0,
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
    assert review[0]["on_time_rate"] == 0.5


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
    # Judged neither way, so there is no rate to give.
    assert row["on_time_rate"] is None


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
    orphan = [{**ANSWERS[0], "source_item_id": "gone"}]
    result = metrics.answer_remediation_by_manager(
        given_rows(orphan).read(), _current(), as_of=AS_OF
    )

    assert len(result) == 0


def test_an_answer_joins_the_case_of_its_own_case_type():
    # Item 7 of both Case Types; only complaints' has an Answer, so only its
    # manager is credited with it.
    cases = [
        _case("7", "In-progress", responsible_party_manager_name="R.ONE"),
        *_in_claims(
            [_case("7", "In-progress", responsible_party_manager_name="R.TWO")]
        ),
    ]
    answers = [_answer("7", "q1", "yes", "complete")]
    result = _rows(
        metrics.answer_remediation_by_manager(
            given_rows(answers).read(), _current(cases), as_of=AS_OF
        )
    )

    assert [
        (r["responsible_party_manager_name"], r["answer_count"]) for r in result
    ] == [("R.ONE", 1)]


def test_an_action_is_not_credited_to_a_live_case_of_another_case_type():
    # Item 7 of claims is void; item 7 of complaints is live. The claims Actions
    # are not on a live Case, so they add nothing; complaints' own does.
    cases = [
        _case("7", "In-progress"),
        *_in_claims([_case("7", "Void", voided_at=AS_OF)]),
    ]
    actions = [
        _action("7", "q1", "a1"),
        *_in_claims([_action("7", "q1", "a2"), _action("7", "q2", "a3")]),
    ]
    result = _rows(
        metrics.answer_action_load(
            given_rows(actions).read(), _current(cases), as_of=AS_OF
        )
    )

    assert [
        (r["case_type"], r["question_id"], r["case_count"], r["action_count"])
        for r in result
    ] == [("complaints", "q1", 1, 1)]


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
    void_thread = [{**message, "source_item_id": "c3"} for message in MESSAGES]
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
        {**MESSAGES[0], "source_item_id": "c3"},  # void
        {**MESSAGES[0], "source_item_id": "c9"},  # not current
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
def default_zone(monkeypatch):
    """The seam on its default (None), as in production: UK time."""
    monkeypatch.setattr(timestamps, "local_timezone", lambda: None)


def test_conversation_posting_pattern_reads_uk_time_per_message(default_zone):
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
    result = metrics.case_backlog(_history(history), as_of=as_of)

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
    result = metrics.case_backlog(_history(history), as_of="2026-07-04T06:00:00+00:00")

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
    result = metrics.case_backlog(_history(history), as_of=AS_OF)

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


def _answer(key, question_id, required, status):
    return {
        "source_item_id": key,
        "case_type": "complaints",
        "question_id": question_id,
        "remediation_required": required,
        "remediation_status": status,
    }


def _action(key, question_id, action_id):
    return {
        "source_item_id": key,
        "case_type": "complaints",
        "question_id": question_id,
        "action_id": action_id,
    }


def test_remediation_overdue_counts_whats_outstanding_on_cases_past_their_date():
    def past_due(key, due, **overrides):
        return _case(key, "Actions In Progress", remediation_due_date=due, **overrides)

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


def test_outstanding_remediation_is_counted_on_the_case_of_its_own_case_type():
    # Item 7 of both Case Types is past its date; only complaints' has an
    # outstanding Answer and Action.
    past_due = _case(
        "7", "Actions In Progress", remediation_due_date="2026-08-13T00:00:00+00:00"
    )
    answers = [_answer("7", "q1", "yes", None)]
    actions = [_action("7", "q1", "a1")]
    result = _rows(
        metrics.remediation_overdue(
            _current([past_due, *_in_claims([past_due])]),
            given_rows(answers).read(),
            given_rows(actions).read(),
            as_of=AS_OF,
        )
    )

    assert {
        r["case_type"]: (
            r["case_count"],
            r["outstanding_answer_count"],
            r["outstanding_action_count"],
        )
        for r in result
    } == {"complaints": (1, 1, 1), "claims": (1, 0, 0)}


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
    return metrics.ordered_history(
        Dataset.from_pandas(pd.DataFrame(columns=metrics.HISTORY_COLUMNS))
    )


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
            metrics.reviewer_workload(_current(rows), _history(history), as_of=as_of)
        )
        return row["oldest_in_progress_days"]

    assert oldest(cases[:1]) == 5.0
    assert oldest(cases) == 12.0


def test_a_reopened_case_does_not_lend_its_age_to_another_case_types_item():
    # Complaints' item 7 was reopened on 15 Jul (five days in progress by 20
    # Jul); claims' item 7 has no history, so it keeps its own assigned_at (8
    # Jul: twelve days), not the reopen.
    as_of = "2026-07-20T06:00:00+00:00"
    history = [
        _observation("7", "a", "2026-07-04T10:00:00+00:00", "In-progress"),
        _observation("7", "b", "2026-07-10T09:00:00+00:00", "Completed"),
        _observation("7", "c", "2026-07-15T09:00:00+00:00", "In-progress"),
    ]
    cases = [
        _case("7", "In-progress", assigned_at="2026-07-04T09:00:00+00:00"),
        *_in_claims(
            [_case("7", "In-progress", assigned_at="2026-07-08T09:00:00+00:00")]
        ),
    ]
    result = _rows(
        metrics.reviewer_workload(_current(cases), _history(history), as_of=as_of)
    )

    assert {r["case_type"]: r["oldest_in_progress_days"] for r in result} == {
        "complaints": 5.0,
        "claims": 12.0,
    }


def _appeal(key, appeal_id, state, verdict=None):
    return {
        "source_item_id": key,
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


# --- distributions and trends -------------------------------------------------


def _ago(days: float, before: str = AS_OF) -> str:
    """The instant ``days`` before ``before``, as Sync stamps it."""
    return (dt.datetime.fromisoformat(before) - dt.timedelta(days=days)).isoformat()


def _distribution(dataset: Dataset, **keys: object) -> dict[tuple, tuple]:
    """(case_type, measure) -> (n, p50, p90, p95, max) of the rows matching
    ``keys``."""
    return {
        (r["case_type"], r["measure"]): (r["n"], r["p50"], r["p90"], r["p95"], r["max"])
        for r in _rows(dataset)
        if all(r[k] == v for k, v in keys.items())
    }


def test_duration_percentiles_take_each_window_over_the_days_measurements_end():
    cases = [
        # Created 1 Jul 09:00: 9 days, ending 10 Jul; 40 days, ending 10 Aug.
        _case("a", "Completed", completed_at="2026-07-10T09:00:00+00:00"),
        _case("b", "Completed", completed_at="2026-08-10T09:00:00+00:00"),
        # Assigned 4 Jul, before anything had completed.
        _case("w", "In-progress", assigned_at="2026-07-04T09:00:00+00:00"),
    ]
    rows = _rows(metrics.case_duration_percentiles(_current(cases), as_of=AS_OF))
    end_to_end = {
        (r["as_of_date"], r["window_days"]): (r["n"], r["p50"], r["max"])
        for r in rows
        if r["case_type"] == "complaints" and r["measure"] == "end_to_end"
    }

    # From the first completion to the snapshot's own date; what ended before
    # the first completion is in the windows that reach back to it.
    assert min(r["as_of_date"] for r in rows) == "2026-07-10"
    assert max(r["as_of_date"] for r in rows) == "2026-08-20"
    assert [
        (r["n"], r["max"])
        for r in rows
        if (r["as_of_date"], r["window_days"], r["case_type"], r["measure"])
        == ("2026-07-10", 28, "complaints", "allocation_wait")
    ] == [(1, 3.0)]
    assert end_to_end[("2026-07-10", 28)] == (1, 9.0, 9.0)
    # (9 Jul, 6 Aug] still holds 10 Jul; (10 Jul, 7 Aug] does not.
    assert end_to_end[("2026-08-06", 28)] == (1, 9.0, 9.0)
    assert ("2026-08-07", 28) not in end_to_end
    assert end_to_end[("2026-08-07", 90)] == (1, 9.0, 9.0)
    assert end_to_end[("2026-08-10", 90)] == (2, 24.5, 40.0)


def test_duration_percentiles_measure_each_leg_and_add_an_all_row():
    cases = [
        *CURRENT,
        _case("k1", "Completed", case_type="claims", completed_at=_ago(42)),
    ]
    result = metrics.case_duration_percentiles(_current(cases), as_of=AS_OF)

    # On 13 Jul: c1 (created 1 Jul, assigned 4, Reportable 8, done Fri 10 Jul
    # against Wed 8: 2 working days over) and c4 (done Mon 13 against Fri 10:
    # 1 over). Only c1 took the Actions path. k1, a claim, ended 9 Jul.
    assert _distribution(result, as_of_date="2026-07-13", window_days=28) == {
        ("complaints", "allocation_wait"): (1, 3.0, None, None, 3.0),
        ("complaints", "end_to_end"): (2, 10.5, None, None, 12.0),
        ("complaints", "remediation"): (1, 2.0, None, None, 2.0),
        ("complaints", "review"): (1, 4.0, None, None, 4.0),
        ("complaints", "sla_margin_review"): (2, 1.5, None, None, 2.0),
        ("complaints", "to_reportable"): (1, 7.0, None, None, 7.0),
        ("claims", "end_to_end"): (1, 7.875, None, None, 7.875),
        ("(all)", "allocation_wait"): (1, 3.0, None, None, 3.0),
        ("(all)", "end_to_end"): (3, 9.0, None, None, 12.0),
        ("(all)", "remediation"): (1, 2.0, None, None, 2.0),
        ("(all)", "review"): (1, 4.0, None, None, 4.0),
        ("(all)", "sla_margin_review"): (2, 1.5, None, None, 2.0),
        ("(all)", "to_reportable"): (1, 7.0, None, None, 7.0),
    }


def test_duration_percentiles_skip_void_and_backward_legs_but_sign_the_margin():
    cases = [
        _case("v", "Void", completed_at="2026-07-10T09:00:00+00:00"),
        # Assigned after it was Reportable: its review leg runs backwards.
        _case(
            "r",
            "Actions In Progress",
            assigned_at="2026-07-09T09:00:00+00:00",
            reportable_at="2026-07-08T09:00:00+00:00",
        ),
        # Done Wed 8 Jul against Fri 10 Jul: Thursday and Friday to spare.
        _case(
            "e",
            "Completed",
            due_date="2026-07-10T00:00:00+00:00",
            completed_at="2026-07-08T09:00:00+00:00",
        ),
    ]
    result = metrics.case_duration_percentiles(_current(cases), as_of=AS_OF)

    assert _distribution(
        result, as_of_date="2026-07-10", window_days=28, case_type="complaints"
    ) == {
        ("complaints", "allocation_wait"): (1, 8.0, None, None, 8.0),
        ("complaints", "end_to_end"): (1, 7.0, None, None, 7.0),
        ("complaints", "sla_margin_review"): (1, -2.0, None, None, -2.0),
        ("complaints", "to_reportable"): (1, 7.0, None, None, 7.0),
    }


@pytest.mark.parametrize(
    ("n", "p90", "p95"),
    [(9, None, None), (10, 9.1, None), (19, 17.2, None), (20, 18.1, 19.05)],
)
def test_duration_percentiles_publish_a_tail_only_over_enough_cases(n, p90, p95):
    # End to end of 1, 2, ... n days, every one ending 2 Aug.
    done = "2026-08-02T09:00:00+00:00"
    cases = [
        _case(f"k{days}", "Completed", created=_ago(days, done), completed_at=done)
        for days in range(1, n + 1)
    ]
    result = metrics.case_duration_percentiles(_current(cases), as_of=AS_OF)

    [row] = [
        stats
        for (case_type, measure), stats in _distribution(
            result, as_of_date="2026-08-02", window_days=28
        ).items()
        if (case_type, measure) == ("complaints", "end_to_end")
    ]
    assert row == (n, (n + 1) / 2, p90, p95, float(n))


def test_duration_percentiles_file_a_measurement_under_its_local_end_day(
    monkeypatch,
):
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    # 23:30 UTC on 10 Jul is 00:30 on 11 Jul, an hour east.
    cases = [_case("a", "Completed", completed_at="2026-07-10T23:30:00+00:00")]
    rows = _rows(metrics.case_duration_percentiles(_current(cases), as_of=AS_OF))

    assert min(r["as_of_date"] for r in rows) == "2026-07-11"


def test_duration_percentiles_with_nothing_measured_land_the_declared_shape():
    result = metrics.case_duration_percentiles(
        _current([_case("c2", "In-progress")]), as_of=AS_OF
    )

    assert _rows(result) == []
    assert list(result.to_pandas().columns) == list(
        CaseDurationPercentilesDaily.__dataclass_fields__
    )


def test_open_age_measures_what_is_open_at_the_snapshot():
    cases = [
        _case("t", "To-allocate", created=_ago(10)),
        _case("p", "In-progress", created=_ago(4.5)),
        _case(
            "a",
            "Actions In Progress",
            created=_ago(30),
            awaiting_responsible_party=1,
            awaiting_since=_ago(1),
            has_open_appeal=1,
            appeal_raised_at=_ago(2),
        ),
        # A Completed Case's open Appeal counts; the Case itself is not open.
        _case("c", "Completed", has_open_appeal=1, appeal_raised_at=_ago(7)),
        _case("v", "Void", has_open_appeal=1, appeal_raised_at=_ago(7)),
        _case("k", "In-progress", case_type="claims", created=_ago(2)),
    ]
    result = metrics.case_open_age(_current(cases), as_of=AS_OF)

    assert {row["as_of_date"] for row in _rows(result)} == {"2026-08-20"}
    assert _distribution(result) == {
        ("complaints", "open_age_to_allocate"): (1, 10.0, None, None, 10.0),
        ("complaints", "open_age_in_progress"): (1, 4.5, None, None, 4.5),
        ("complaints", "open_age_actions_in_progress"): (1, 30.0, None, None, 30.0),
        ("complaints", "awaiting_responsible_party"): (1, 1.0, None, None, 1.0),
        ("complaints", "open_appeal_age"): (2, 4.5, None, None, 7.0),
        ("claims", "open_age_in_progress"): (1, 2.0, None, None, 2.0),
        ("(all)", "open_age_to_allocate"): (1, 10.0, None, None, 10.0),
        ("(all)", "open_age_in_progress"): (2, 3.25, None, None, 4.5),
        ("(all)", "open_age_actions_in_progress"): (1, 30.0, None, None, 30.0),
        ("(all)", "awaiting_responsible_party"): (1, 1.0, None, None, 1.0),
        ("(all)", "open_appeal_age"): (2, 4.5, None, None, 7.0),
    }


@pytest.mark.parametrize(
    ("n", "p90", "p95"), [(9, None, None), (10, 9.1, None), (20, 18.1, 19.05)]
)
def test_open_age_publishes_a_tail_only_over_enough_cases(n, p90, p95):
    cases = [
        _case(f"p{days}", "In-progress", created=_ago(days)) for days in range(1, n + 1)
    ]
    result = metrics.case_open_age(_current(cases), as_of=AS_OF)

    assert _distribution(result)[("complaints", "open_age_in_progress")] == (
        n,
        (n + 1) / 2,
        p90,
        p95,
        float(n),
    )


def test_first_time_right_excludes_appealed_amended_and_overridden_cases():
    cases = [
        _case("r1", "Completed", reportable_at="2026-07-08T09:00:00+00:00"),
        # Appealed, even though the Appeal was rejected.
        _case("r2", "Completed", reportable_at="2026-07-09T09:00:00+00:00"),
        _case(
            "r3",
            "Actions In Progress",
            reportable_at="2026-07-10T09:00:00+00:00",
            amended_outcome_id="o2",
        ),
        _case(
            "r4",
            "Completed",
            reportable_at="2026-07-11T09:00:00+00:00",
            outcome_overridden=1,
        ),
        _case(
            "r5",
            "Completed",
            reportable_at="2026-07-12T09:00:00+00:00",
            outcome_overridden=0,
        ),
        _case("r6", "Void", reportable_at="2026-07-12T09:00:00+00:00"),
        _case(
            "r7",
            "Completed",
            reportable_at="2026-08-03T09:00:00+00:00",
            assigned_reviewer_name=JONES,
        ),
    ]
    appeals = given_rows([_appeal("r2", "ap1", "resolved", "rejected")]).read()
    result = _rows(metrics.first_time_right(_current(cases), appeals, as_of=AS_OF))

    assert [
        (
            r["reportable_month"],
            r["assigned_reviewer_name"],
            r["reportable_count"],
            r["first_time_right_count"],
            r["first_time_right_rate"],
        )
        for r in result
    ] == [("2026-07", KHAN, 5, 2, 0.4), ("2026-08", JONES, 1, 1, 1.0)]
    assert {r["brand"] for r in result} == {UNKNOWN_BRAND}


def test_an_appeal_spoils_only_the_case_of_its_own_case_type():
    # Item 7 of complaints and of claims, Reportable the same month; only
    # complaints' was appealed.
    case = _case("7", "Completed", reportable_at="2026-07-08T09:00:00+00:00")
    appeals = given_rows([_appeal("7", "ap1", "resolved", "rejected")]).read()
    result = _rows(
        metrics.first_time_right(
            _current([case, *_in_claims([case])]), appeals, as_of=AS_OF
        )
    )

    assert {
        r["case_type"]: (r["reportable_count"], r["first_time_right_count"])
        for r in result
    } == {"complaints": (1, 0), "claims": (1, 1)}


def test_reviewer_throughput_spreads_a_weeks_reportable_cases_over_reviewers():
    # 6-12 Jul is ISO week 28. Khan makes three complaints Reportable, Jones a
    # complaint and a claim; one complaint names no Reviewer.
    monday = "2026-07-06T09:00:00+00:00"
    cases = [
        *(_case(f"k{i}", "Completed", reportable_at=monday) for i in range(3)),
        _case("j1", "Completed", reportable_at=monday, assigned_reviewer_name=JONES),
        _case(
            "j2",
            "Completed",
            case_type="claims",
            reportable_at=monday,
            assigned_reviewer_name=JONES,
        ),
        _case("u", "Completed", reportable_at=monday, assigned_reviewer_name=None),
        _case("v", "Void", reportable_at=monday),
    ]
    result = _rows(metrics.reviewer_throughput(_current(cases), as_of=AS_OF))

    assert [
        (
            r["iso_week"],
            r["case_type"],
            r["active_reviewer_count"],
            r["completions_total"],
            r["completions_per_reviewer_p50"],
            r["completions_per_reviewer_p90"],
            r["completions_per_reviewer_max"],
        )
        for r in result
    ] == [
        ("2026-W28", "(all)", 2, 6, 2.5, None, 3.0),
        ("2026-W28", "claims", 1, 1, 1.0, None, 1.0),
        ("2026-W28", "complaints", 2, 5, 2.0, None, 3.0),
    ]


@pytest.mark.parametrize(("reviewers", "p90"), [(9, None), (10, 1.0)])
def test_reviewer_throughput_publishes_a_p90_only_over_enough_reviewers(reviewers, p90):
    cases = [
        _case(
            f"c{i}",
            "Completed",
            reportable_at="2026-07-06T09:00:00+00:00",
            assigned_reviewer_name=f"R{i}",
        )
        for i in range(reviewers)
    ]
    [everything, complaints] = _rows(
        metrics.reviewer_throughput(_current(cases), as_of=AS_OF)
    )

    assert complaints["completions_per_reviewer_p90"] == p90
    assert everything["completions_per_reviewer_p90"] == p90


def test_reviewer_throughput_weeks_run_on_the_local_calendar(monkeypatch):
    monkeypatch.setattr(
        timestamps, "local_timezone", lambda: dt.timezone(dt.timedelta(hours=1))
    )
    # Sunday 12 Jul 23:30 UTC is Monday 13 Jul, week 29, an hour east.
    cases = [_case("c", "Completed", reportable_at="2026-07-12T23:30:00+00:00")]

    assert {
        r["iso_week"]
        for r in _rows(metrics.reviewer_throughput(_current(cases), as_of=AS_OF))
    } == {"2026-W29"}


def test_reviewer_workload_daily_is_the_current_workload_under_its_date():
    workload = metrics.reviewer_workload(_current(), _no_history(), as_of=AS_OF)

    assert _rows(metrics.reviewer_workload_daily(workload, as_of=AS_OF)) == [
        {"as_of_date": "2026-08-20", **row} for row in _rows(workload)
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


# A Case past its Remediation Due Date, seeded for the end-to-end test only.
PAST_DUE_REMEDIATION = _case(
    "c5",
    "Actions In Progress",
    responsible_party_name="P.ONE",
    reportable_at="2026-07-30T09:00:00+00:00",
    remediation_due_date="2026-08-13T00:00:00+00:00",
)
PAST_DUE_ANSWER = {
    "source_item_id": "c5",
    "case_type": "complaints",
    "question_id": "q1",
    "remediation_required": "yes",
    "remediation_status": None,
}
PAST_DUE_ACTION = {
    "source_item_id": "c5",
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
            if table in ACCUMULATED_TABLES:
                assert row.pop("logical_run_id")
                assert row.pop("load_date")
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
    accumulated = {table: len(read_rows(gold, table)) for table in ACCUMULATED_TABLES}
    assert main(["prog", "--base-dir", str(base_dir)]) == 0
    assert [
        r["assigned_reviewer_name"] for r in read_rows(gold, "case_hold_current")
    ] == [KHAN]
    # The day-at-a-time tables replace a re-driven day rather than repeat it.
    assert {
        table: len(read_rows(gold, table)) for table in ACCUMULATED_TABLES
    } == accumulated


def test_a_re_drive_under_another_run_date_replaces_the_snapshots_day(base_dir):
    # An operator re-drives yesterday's run after today's Sync published: both
    # runs read the one snapshot (as_of 20 Aug), so the day-at-a-time tables
    # must hold one row set for 20 Aug, keyed on that day, not one per run date.
    _seed_sync(base_dir)
    gold = medallion(StoreRegistry(base_dir), "cora_platform_metric").gold

    landed = {}
    for run_date in (dt.date(2026, 10, 8), dt.date(2026, 10, 9)):
        run_pipeline(
            run,
            PIPELINE_NAME,
            base_dir=base_dir,
            upstreams=UPSTREAMS,
            run_date=run_date,
        )
        landed[run_date] = {
            table: read_rows(gold, table) for table in ACCUMULATED_TABLES
        }

    first, second = landed.values()
    for table in ACCUMULATED_TABLES:
        assert len(second[table]) == len(first[table]) > 0, table
        assert {
            (row["as_of_date"], row["logical_run_id"], row["load_date"])
            for row in second[table]
        } == {("2026-08-20", "cora_platform_metric:2026-08-20", "2026-08-20")}, table


def test_the_pipeline_declares_sync_as_its_freshness_upstream():
    [requirement] = UPSTREAMS
    assert isinstance(requirement, FreshnessRequirement)
    assert requirement.upstream_pipeline == "sharepoint_cases"
    assert requirement.max_age_days == 0


def test_a_source_missing_a_column_a_metric_needs_fails_the_read(tmp_path, capsys):
    # An unmigrated directory, so the narrowed table really lacks the column
    # (a migrated one would keep the declared column and land NULLs).
    _seed_sync(tmp_path)
    sync = medallion(StoreRegistry(tmp_path), SYNC_SUBJECT)
    narrowed = [{k: v for k, v in row.items() if k != "posted_at"} for row in MESSAGES]
    sync.gold.writer("conversation_message", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(narrowed))
    )

    assert main(["prog", "--base-dir", str(tmp_path)]) == 1

    missing = "conversation_message is missing required column(s): posted_at"
    err = capsys.readouterr().err
    assert "[ValidationError, data]" in err
    assert missing in err
    # Each source is read narrowed to what its steps need, so the run's own
    # record shows the read failing on the column, and no step writing.
    records = read_run_log(RunStore(tmp_path).log_path_for(PIPELINE_NAME))
    [failed] = [r for r in records if r["status"] == "error" and r["step"] != "run"]
    assert (failed["step"], failed["errors"], failed["error_category"]) == (
        "messages:read",
        [missing],
        "data",
    )
    assert [r["step"] for r in records if r["step"].endswith(":write")] == []


def test_a_sync_table_missing_the_item_id_fails_the_read_naming_it(tmp_path, capsys):
    # A Case is its ``(case_type, source_item_id)`` in every Sync table, so a
    # table without ``source_item_id`` must stop the run naming it rather than
    # join on nothing.
    _seed_sync(tmp_path)
    sync = medallion(StoreRegistry(tmp_path), SYNC_SUBJECT)
    narrowed = [
        {k: v for k, v in row.items() if k != "source_item_id"} for row in MESSAGES
    ]
    sync.gold.writer("conversation_message", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame(narrowed))
    )

    assert main(["prog", "--base-dir", str(tmp_path)]) == 1

    missing = "conversation_message is missing required column(s): source_item_id"
    assert missing in capsys.readouterr().err
    # Read narrowed to what its steps need, so the run's own record shows the
    # read failing on the column.
    records = read_run_log(RunStore(tmp_path).log_path_for(PIPELINE_NAME))
    [failed] = [r for r in records if r["status"] == "error" and r["step"] != "run"]
    assert (failed["step"], failed["errors"]) == ("messages:read", [missing])
