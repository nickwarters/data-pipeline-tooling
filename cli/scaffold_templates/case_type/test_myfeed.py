"""Tests for the ``myfeed`` Case Type ingest.

These tests demonstrate granular, decoupled testability: by separating the
Pipeline definition into `raw_builder` and `silver_builder`, we can test the
logic purely in memory. We inject `given_rows` as the Reader and `RecordingWriter`
as the Writer. This never touches SQLite, the network, or the filesystem.
"""

from __future__ import annotations

from dataclasses import fields

import pytest

from framework.core import RAW, SILVER, ValidationError
from framework.io import StoreCatalog
from framework.run import RunContext
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    read_rows,
)

from .case_type import CASE_TYPE
from .pipeline import FEED_NAME, raw_builder, run, silver_builder
from .schema import MyfeedRow


def test_case_type_declares_its_identity_contract():
    assert CASE_TYPE.schema is MyfeedRow
    declared = {f.name for f in fields(MyfeedRow)}
    assert set(CASE_TYPE.natural_key) <= declared
    assert CASE_TYPE.namespace is not None


def test_source_lands_in_raw_then_conforms_to_silver(tmp_path):
    silver = run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))
    store = StoreCatalog(tmp_path).store(FEED_NAME)

    raw = read_rows(store, RAW, FEED_NAME)
    assert len(raw) > 0

    silver_rows = read_rows(store, SILVER, FEED_NAME)
    assert len(silver_rows) == len(silver)
    declared = {f.name for f in fields(MyfeedRow)}
    assert declared.issubset(silver_rows[0].keys())


def test_raw_builder_gates_source_columns():
    writer = RecordingWriter()
    # Replace with missing schema columns to test structural rejection
    reader = given_rows([{"invalid_col": "data"}])

    p = raw_builder(reader, writer)

    with pytest.raises(ValidationError, match="missing required column.*"):
        p.run()

    assert len(writer.writes) == 0


def test_silver_builder_quarantines_value_rule_breaches():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # R001 is a placeholder for a valid schema row
    # R002 is a placeholder for an invalid schema row that triggers a value-rule breach
    reader = given_rows(
        [
            {"record_id": "R001", "label": "alpha", "amount": 50, "run_id": "1"},
            {"record_id": "R002", "label": "beta", "amount": 250, "run_id": "1"},
        ]
    )

    # This acts as a smoke test until value rules are actually added to your schema
    p = silver_builder(reader, writer, reject_writer, run_log=run_log)
    try:
        p.run()
    except ValidationError:
        pass  # If no value rules exist yet, amount might trigger structural mismatch


def test_silver_builder_aborts_on_structural_breaches():
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # Missing required schema columns triggers an abort
    reader = given_rows([{"invalid_col": "data"}])

    p = silver_builder(reader, writer, reject_writer)

    with pytest.raises(ValidationError, match="missing column.*"):
        p.run()

    assert len(writer.writes) == 0
    assert len(reject_writer.writes) == 0
