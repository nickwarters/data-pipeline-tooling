"""Location/delegation tests for the ``sharepoint_cases`` Shared Readers."""

from __future__ import annotations

import sqlite3

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import Refresh
from readers.sharepoint_cases import (
    AnswerActionsReader,
    AnswersReader,
    AppealsReader,
    CaseObservationHistoryReader,
    ConversationMessagesReader,
    CurrentCasesReader,
)
from tests.framework_testing import rows_of
from tools.medallion import medallion
from tools.store import StoreRegistry

CASES = [
    {"case_id": "c-1", "status": "Open", "assigned_reviewer_name": "a.khan"},
    {"case_id": "c-2", "status": "Completed", "assigned_reviewer_name": "b.okafor"},
]
MESSAGES = [
    {"case_id": "c-1", "seq": 1, "author_login": "a.khan", "body": "first"},
    {"case_id": "c-1", "seq": 2, "author_login": "e.novak", "body": "second"},
]


def _seed(base_dir, table: str, rows: list[dict], *, layer: str = "gold") -> None:
    """Seed rows where the producer lands them."""
    store = getattr(medallion(StoreRegistry(base_dir), "sharepoint_cases"), layer)
    store.writer(table, Refresh()).write(Dataset.from_pandas(pd.DataFrame(rows)))


def test_current_cases_reads_what_the_producer_landed_in_gold(tmp_path):
    _seed(tmp_path, "case_current", CASES)

    assert rows_of(CurrentCasesReader(tmp_path).read()) == CASES


def test_conversation_messages_reads_what_the_producer_landed_in_gold(tmp_path):
    _seed(tmp_path, "conversation_message", MESSAGES)

    assert rows_of(ConversationMessagesReader(tmp_path).read()) == MESSAGES


@pytest.mark.parametrize(
    "reader_class, table",
    [
        (AnswersReader, "answer"),
        (AnswerActionsReader, "answer_action"),
        (AppealsReader, "appeal"),
    ],
)
def test_each_detail_table_reader_reads_what_the_producer_landed_in_gold(
    tmp_path, reader_class, table
):
    rows = [{"case_id": "c-1", "question_id": "q1", "table": table}]
    _seed(tmp_path, table, rows)

    assert rows_of(reader_class(tmp_path).read()) == rows


def test_case_observation_history_reads_the_producers_silver_not_its_gold(tmp_path):
    # The history is the one reader below gold: the accumulated observations,
    # one per poll per Case, that gold has already reduced to one row each. A
    # contradicting gold table proves which layer the reader answers from.
    history = [
        {"source_item_id": "1", "source_observation_id": "o1", "status": "To-allocate"},
        {"source_item_id": "1", "source_observation_id": "o2", "status": "In-progress"},
    ]
    _seed(tmp_path, "case_version", history, layer="silver")
    _seed(tmp_path, "case_current", [{"source_item_id": "1", "status": "Completed"}])

    assert rows_of(CaseObservationHistoryReader(tmp_path).read()) == history


def test_each_reader_sees_only_its_own_table(tmp_path):
    # Two readers over one subject share a database file, so a wrapper that
    # bound the wrong table would still read *something*. Seed both and check
    # each answers its own question.
    _seed(tmp_path, "case_current", CASES)
    _seed(tmp_path, "conversation_message", MESSAGES)

    assert [row["case_id"] for row in rows_of(CurrentCasesReader(tmp_path).read())] == [
        "c-1",
        "c-2",
    ]
    assert [
        row["seq"] for row in rows_of(ConversationMessagesReader(tmp_path).read())
    ] == [
        1,
        2,
    ]


def test_the_read_is_a_pass_through(tmp_path):
    # No projection, no coercion, no re-shaping. Every landed column comes
    # back, including one no consumer has asked for.
    _seed(tmp_path, "case_current", [{**CASES[0], "unexpected_column": "kept"}])

    landed = CurrentCasesReader(tmp_path).read()
    assert set(landed.columns) == {
        "case_id",
        "status",
        "assigned_reviewer_name",
        "unexpected_column",
    }


@pytest.mark.parametrize(
    "reader_class, table",
    [
        (CurrentCasesReader, "case_current"),
        (ConversationMessagesReader, "conversation_message"),
    ],
)
def test_describe_and_data_locations_delegate_to_the_reader_underneath(
    tmp_path, reader_class, table
):
    _seed(tmp_path, table, CASES if table == "case_current" else MESSAGES)
    reader = reader_class(tmp_path)

    # describe() is available before a read, for the plan preview.
    described = reader.describe()
    assert table in described
    assert str(tmp_path / "sharepoint_cases" / "gold.db") in described

    # data_locations is empty until the read happens, then names what was
    # touched — the underlying Reader's behaviour, reached through a property so
    # the wrapper does not freeze the pre-read value.
    assert reader.data_locations == []
    reader.read()
    # The location the underlying Reader records, unchanged: the subject's gold
    # file, POSIX-rendered so a record written on Windows compares with one
    # written on macOS.
    gold_db = (tmp_path / "sharepoint_cases" / "gold.db").as_posix()
    assert reader.data_locations == [{"namespace": f"sqlite:{gold_db}", "name": table}]


@pytest.mark.parametrize(
    "reader_class",
    [
        CurrentCasesReader,
        ConversationMessagesReader,
        AnswersReader,
        AnswerActionsReader,
        AppealsReader,
        CaseObservationHistoryReader,
    ],
)
def test_an_empty_base_dir_fails_the_way_the_underlying_reader_already_fails(
    tmp_path, reader_class
):
    # Constructing resolves a location and touches nothing, so it succeeds even
    # with no database there — the same as minting a Reader from the store.
    reader = reader_class(tmp_path)

    # And the read raises SQLite's own error, unwrapped. The wrapper adds no
    # failure mode of its own, so an operator diagnoses a missing Sync database
    # from the same message they would have seen before.
    with pytest.raises(sqlite3.OperationalError, match="unable to open database file"):
        reader.read()
