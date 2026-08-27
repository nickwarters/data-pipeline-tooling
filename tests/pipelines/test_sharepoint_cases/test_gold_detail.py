"""The Detail Table reduction: a child history semi-joined to the observation
its Case's own reduction picked.

One representative grain -- ``answer`` -- throughout: the builder is generic
over ``DETAIL_GRAIN``, and these tests exercise the composition, not a
per-table peculiarity. ``winning_reader()`` composes the real
``to_gold_case_current`` rather than hand-building the winning pairs.
"""

from __future__ import annotations

import pytest

from framework.core import ValidationError
from pipelines.sharepoint_cases.gold import (
    AS_OF_COLUMN,
    CASE_ID_COLUMN,
    DETAIL_GRAIN,
    DETAIL_TABLES,
    to_gold_detail,
)
from pipelines.sharepoint_cases.pipeline import FEED_NAME
from tests._sharepoint_cases_fixtures import (
    AS_OF,
    COMPLAINTS,
    details,
    two_observations,
    version,
    winning_reader,
)
from tests.framework_testing import RecordingWriter, given_rows

DETAIL_TABLE = "answer"


def child(
    *,
    source_item_id: str = "101",
    case_type: str = COMPLAINTS.case_type,
    source_observation_id: str,
    question_id: str = "q1",
) -> dict:
    """One row of a child history, in the shape a silver Detail Table would carry.

    ``case_type``/``source_item_id`` match ``version()``'s defaults, so the
    derived ``case_id`` lines up with the parent's for the same Case.
    """
    return {
        "source_item_id": source_item_id,
        "case_type": case_type,
        "source_observation_id": source_observation_id,
        "question_id": question_id,
        "field_value": "Not upheld",
    }


def test_a_child_stripped_from_the_winning_observation_does_not_survive():
    winners = winning_reader(*two_observations())
    children = [
        child(source_observation_id="obs-1", question_id="q1"),
        child(source_observation_id="obs-1", question_id="q2"),
        child(source_observation_id="obs-2", question_id="q1"),
        child(source_observation_id="obs-2", question_id="q3"),
    ]

    rows = details(children, winners)

    assert {row["question_id"] for row in rows} == {"q1", "q3"}
    assert {row["source_observation_id"] for row in rows} == {"obs-2"}


def test_two_cases_do_not_take_each_others_children():
    a1, a2 = two_observations("101", "a")
    b1, b2 = two_observations("102", "b")
    winners = winning_reader(a1, a2, b1, b2)
    children = [
        child(source_item_id="101", source_observation_id="a-1", question_id="stale"),
        child(source_item_id="101", source_observation_id="a-2", question_id="q1"),
        child(source_item_id="102", source_observation_id="b-1", question_id="stale"),
        child(source_item_id="102", source_observation_id="b-2", question_id="q1"),
    ]

    rows = details(children, winners)

    assert {row["source_observation_id"] for row in rows} == {"a-2", "b-2"}
    assert {row["question_id"] for row in rows} == {"q1"}
    assert len({row[CASE_ID_COLUMN] for row in rows}) == len(rows) == 2


def test_a_gold_detail_row_is_the_childs_columns_plus_case_id_and_as_of():
    # The semi-join guarantee: a Detail row carries nothing from the parent
    # beyond the two winner columns it joined on.
    winners = winning_reader(version(source_observation_id="obs-1"))
    [row] = details([child(source_observation_id="obs-1")], winners)

    assert set(row) == set(child(source_observation_id="obs-1")) | {
        CASE_ID_COLUMN,
        AS_OF_COLUMN,
    }
    assert row[AS_OF_COLUMN] == AS_OF.isoformat()


def test_a_repeated_grain_value_in_the_winning_observation_aborts_the_build():
    winners = winning_reader(version(source_observation_id="obs-1"))
    writer = RecordingWriter()
    children = [
        child(source_observation_id="obs-1", question_id="q1"),
        child(source_observation_id="obs-1", question_id="q1"),
    ]

    # The grain's own key column is what the error names.
    with pytest.raises(ValidationError, match=DETAIL_GRAIN[DETAIL_TABLE][-1]):
        to_gold_detail(
            given_rows(children),
            writer,
            grain=DETAIL_GRAIN[DETAIL_TABLE],
            observations=winners,
            as_of=AS_OF,
            name=f"{FEED_NAME}:gold:detail:{DETAIL_TABLE}",
        )

    assert writer.writes == []


def test_an_aggregate_is_never_mistaken_for_a_detail_table():
    assert set(DETAIL_TABLES) == set(DETAIL_GRAIN)
