"""Tests for the standard hop recipes (``tools.recipes``).

What each recipe composes, in what order, what it leaves out when an option
isn't given, and how it behaves when it runs. That the feeds actually *compose*
these rather than carrying a copy is pinned separately, in
``tests/integration/test_hop_recipes.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import pytest

from framework.core import Range, ValidationError
from tests.framework_testing import RecordingRunLog, RecordingWriter, given_rows
from tools.recipes import raw_to_silver, source_to_raw


@dataclass
class Row:
    record_id: str
    amount: Annotated[int, Range(minimum=0, maximum=100)]


def _steps(pipeline) -> list[str]:
    """The node names of a composed pipeline, in declaration order."""
    return [line.split()[1] for line in pipeline.describe().splitlines()[1:]]


def test_source_to_raw_gates_the_columns_then_lands_the_source():
    p = source_to_raw(
        given_rows([{"record_id": "R1", "amount": 5}]),
        RecordingWriter(),
        expected_columns=["record_id", "amount"],
    )

    assert _steps(p) == ["read", "columns", "write"]


def test_source_to_raw_without_expected_columns_lands_ungated():
    writer = RecordingWriter()
    p = source_to_raw(given_rows([{"anything": 1}]), writer)

    assert _steps(p) == ["read", "write"]
    p.run()
    assert len(writer.writes) == 1


def test_source_to_raw_aborts_when_a_promised_column_is_missing():
    writer = RecordingWriter()
    p = source_to_raw(
        given_rows([{"record_id": "R1"}]),
        writer,
        expected_columns=["record_id", "amount"],
    )

    with pytest.raises(ValidationError, match="missing required column.*amount"):
        p.run()
    assert writer.writes == []


def test_source_to_raw_does_not_rename_or_coerce():
    """Raw is the faithful landing zone: the source's own shape survives it."""
    writer = RecordingWriter()
    source = [{"record_id": "R1", "amount": "5", "extra": "kept"}]
    source_to_raw(given_rows(source), writer).run()

    landed = writer.writes[0].to_pandas().to_dict("records")
    assert landed == source


def test_raw_to_silver_renames_then_coerces_then_quarantines_then_validates():
    p = raw_to_silver(
        given_rows([{"Record Id": "R1", "amount": "5"}]),
        RecordingWriter(),
        schema=Row,
        rename={"Record Id": "record_id"},
        reject_writer=RecordingWriter(),
    )

    assert _steps(p) == [
        "read",
        "rename",
        "coerce",
        "quarantine",
        "post-validate",
        "write",
    ]


def test_raw_to_silver_omits_the_optional_steps_when_not_asked_for():
    p = raw_to_silver(given_rows([]), RecordingWriter(), schema=Row)

    assert _steps(p) == ["read", "coerce", "post-validate", "write"]


def test_raw_to_silver_canonicalises_the_source_names_before_the_schema_check():
    writer = RecordingWriter()
    raw_to_silver(
        given_rows([{"Record Id": "R1", "Amount": 5}]),
        writer,
        schema=Row,
        rename={"Record Id": "record_id", "Amount": "amount"},
    ).run()

    assert writer.writes[0].to_pandas().to_dict("records") == [
        {"record_id": "R1", "amount": 5}
    ]


def test_raw_to_silver_routes_value_rule_breaches_to_the_reject_writer():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    rejects = RecordingWriter()

    raw_to_silver(
        given_rows(
            [
                {"record_id": "R1", "amount": 50},
                {"record_id": "R2", "amount": 250},
            ]
        ),
        writer,
        schema=Row,
        reject_writer=rejects,
        run_log=run_log,
    ).run()

    assert [
        r["record_id"] for r in writer.writes[0].to_pandas().to_dict("records")
    ] == ["R1"]
    rejected = rejects.writes[0].to_pandas().to_dict("records")
    assert [r["record_id"] for r in rejected] == ["R2"]
    quarantine = next(r for r in run_log.records if r["step"] == "quarantine")
    assert (quarantine["rows_in"], quarantine["rows_out"]) == (2, 1)


def test_raw_to_silver_still_aborts_on_a_structural_breach():
    """Quarantine is for row-level value rules, not a missing column."""
    writer = RecordingWriter()
    rejects = RecordingWriter()

    p = raw_to_silver(
        given_rows([{"record_id": "R1"}]),
        writer,
        schema=Row,
        reject_writer=rejects,
    )

    with pytest.raises(ValidationError, match="missing column 'amount'"):
        p.run()
    assert writer.writes == []
    assert rejects.writes == []


def test_a_recipe_names_its_pipeline_for_the_run_log():
    p = source_to_raw(given_rows([]), RecordingWriter(), name="orders:raw")

    assert p.describe().splitlines()[0] == "Pipeline: orders:raw"
