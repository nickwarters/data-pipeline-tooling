"""The aggregates over the Detail Tables: answer remediation and appeal outcomes.

Both count rows of a gold Detail Table, so both are driven through the real
reduction rather than over hand-built already-reduced rows: proving the count
comes from the winning observation means driving the same semi-join the
published table is built by.
"""

from __future__ import annotations

from pipelines.sharepoint_cases.gold import (
    ANSWER_REMEDIATION_DIMENSIONS,
    UNDECIDED,
    UNRESOLVED,
    UNSTATED,
    answer_remediation,
    appeal_outcomes,
)
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    OTHER,
    aggregate,
    details,
    given_columns,
    to_gold_aggregate,
    two_observations,
    version,
    winning_reader,
)
from tests.framework_testing import RecordingWriter

# --- answer remediation ------------------------------------------------------


def answer_child(
    *,
    source_item_id: str = "101",
    case_type: str = COMPLAINTS.case_type,
    source_observation_id: str,
    question_id: str = "q1",
    remediation_required: str | None = None,
    remediation_status: str | None = None,
) -> dict:
    """One row of an ``answer`` Detail Table child history, remediation-shaped."""
    return {
        "source_item_id": source_item_id,
        "case_type": case_type,
        "source_observation_id": source_observation_id,
        "question_id": question_id,
        "remediation_required": remediation_required,
        "remediation_status": remediation_status,
    }


def gold_answer(children: list[dict], winners) -> list[dict]:
    """The gold ``answer`` Detail Table rows a child history reduces to."""
    return details(children, winners, table="answer")


def remediation(rows: list[dict]) -> list[dict]:
    return aggregate(answer_remediation, "count-by-remediation", rows)


def test_remediation_counts_come_from_the_winning_observation():
    winners = winning_reader(*two_observations())
    children = [
        answer_child(
            source_observation_id="obs-1",
            question_id="q1",
            remediation_required="yes",
            remediation_status="partial",
        ),
        answer_child(source_observation_id="obs-2", question_id="q1"),
    ]

    rows = remediation(gold_answer(children, winners))

    assert [
        (row["remediation_required"], row["remediation_status"], row["answer_count"])
        for row in rows
    ] == [(UNDECIDED, UNRESOLVED, 1)]


def test_an_undecided_remediation_is_counted_and_the_total_matches_gold_answer():
    winners = winning_reader(version(source_observation_id="obs-1"))
    children = [
        answer_child(source_observation_id="obs-1", question_id="q1"),
        answer_child(
            source_observation_id="obs-1",
            question_id="q2",
            remediation_required="yes",
            remediation_status="complete",
        ),
    ]
    answer_rows = gold_answer(children, winners)

    rows = remediation(answer_rows)

    assert (UNDECIDED, UNRESOLVED, 1) in [
        (row["remediation_required"], row["remediation_status"], row["answer_count"])
        for row in rows
    ]
    # answer_count sums to gold answer's row count, not a Case count.
    assert sum(row["answer_count"] for row in rows) == len(answer_rows)


def test_a_decided_remediation_with_no_status_counts_as_unresolved():
    winners = winning_reader(version(source_observation_id="obs-1"))
    [row] = remediation(
        gold_answer(
            [
                answer_child(
                    source_observation_id="obs-1",
                    remediation_required="yes",
                    remediation_status=None,
                )
            ],
            winners,
        )
    )

    assert (row["remediation_required"], row["remediation_status"]) == (
        "yes",
        UNRESOLVED,
    )


def test_two_case_types_do_not_share_a_question_id():
    v1 = version(source_observation_id="obs-1")
    v2 = version(
        id=101,
        source_item_id="101",
        case_type=OTHER.case_type,
        source_observation_id="obs-2",
    )
    winners = winning_reader(v1, v2)
    children = [
        answer_child(source_observation_id="obs-1", case_type=COMPLAINTS.case_type),
        answer_child(source_observation_id="obs-2", case_type=OTHER.case_type),
    ]

    rows = remediation(gold_answer(children, winners))

    # Question ids are per-Case-Type bank, so distinct case_types must not merge.
    assert {(row["case_type"], row["answer_count"]) for row in rows} == {
        (COMPLAINTS.case_type, 1),
        (OTHER.case_type, 1),
    }


def test_remediation_is_empty_when_nothing_was_answered():
    writer = RecordingWriter()
    to_gold_aggregate(
        given_columns(*ANSWER_REMEDIATION_DIMENSIONS),
        writer,
        table="table",
        reduce=answer_remediation,
        step="count-by-remediation",
    )

    frame = writer.dataset.to_pandas()
    assert set(frame.columns) == {
        *ANSWER_REMEDIATION_DIMENSIONS,
        "answer_count",
        "as_of_utc",
    }
    assert len(frame) == 0


# --- appeal outcomes ---------------------------------------------------------


def appeal_child(
    *,
    source_item_id: str = "101",
    case_type: str = COMPLAINTS.case_type,
    source_observation_id: str,
    appeal_id: str = "appeal-1",
    state: str | None = "raised",
    resolution_verdict: str | None = None,
) -> dict:
    """One row of an ``appeal`` Detail Table child history, outcome-shaped."""
    return {
        "source_item_id": source_item_id,
        "case_type": case_type,
        "source_observation_id": source_observation_id,
        "appeal_id": appeal_id,
        "state": state,
        "resolution_verdict": resolution_verdict,
    }


def gold_appeal(children: list[dict], winners) -> list[dict]:
    """The gold ``appeal`` Detail Table rows a child history reduces to."""
    return details(children, winners, table="appeal")


def outcomes(rows: list[dict]) -> list[dict]:
    return aggregate(appeal_outcomes, "count-by-outcome", rows)


def test_appeal_outcomes_come_from_the_winning_observation():
    # Must count once, as resolved/agreed -- never twice across both observations.
    winners = winning_reader(*two_observations())
    children = [
        appeal_child(
            source_observation_id="obs-1",
            appeal_id="appeal-1",
            state="raised",
            resolution_verdict=None,
        ),
        appeal_child(
            source_observation_id="obs-2",
            appeal_id="appeal-1",
            state="resolved",
            resolution_verdict="agreed",
        ),
    ]

    rows = outcomes(gold_appeal(children, winners))

    assert [
        (row["state"], row["resolution_verdict"], row["appeal_count"]) for row in rows
    ] == [("resolved", "agreed", 1)]


def test_an_unresolved_appeal_counts_under_a_literal_and_totals_to_gold_appeal():
    # Also proves a null state counts as unstated.
    winners = winning_reader(version(source_observation_id="obs-1"))
    children = [
        appeal_child(
            source_observation_id="obs-1",
            appeal_id="appeal-1",
            state=None,
            resolution_verdict=None,
        )
    ]
    appeal_rows = gold_appeal(children, winners)

    rows = outcomes(appeal_rows)

    assert [
        (row["state"], row["resolution_verdict"], row["appeal_count"]) for row in rows
    ] == [(UNSTATED, UNRESOLVED, 1)]
    assert sum(row["appeal_count"] for row in rows) == len(appeal_rows)
