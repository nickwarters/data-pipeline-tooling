"""Tests for the ``complaints_b`` Case Type ingest.

These tests demonstrate granular, decoupled testability: by separating the
Pipeline definition into `raw_builder` and `silver_builder`, we can test the
logic purely in memory. We inject `given_rows` as the Reader and `RecordingWriter`
as the Writer. This never touches SQLite, the network, or the filesystem.
"""

from __future__ import annotations

import pytest

from framework.core import ValidationError
from pipelines.complaints_b.pipeline import raw_builder, silver_builder
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    assert_rows_equal,
    given_rows,
)


def test_raw_builder_gates_source_columns():
    writer = RecordingWriter()
    # Missing 'priority' column
    reader = given_rows([{"record_id": "c1", "category": "sales"}])

    p = raw_builder(reader, writer)

    with pytest.raises(ValidationError, match="missing required column.*priority"):
        p.run()

    assert len(writer.writes) == 0


def test_silver_builder_quarantines_value_rule_breaches():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # R001 is valid (priority="high")
    # R002 breaches the OneOf rule (priority="urgent")
    reader = given_rows(
        [
            {
                "record_id": "R001",
                "category": "sales",
                "priority": "high",
                "run_id": "1",
            },
            {
                "record_id": "R002",
                "category": "support",
                "priority": "urgent",
                "run_id": "1",
            },
        ]
    )
    reader = given_rows(
        [
            {
                "record_id": "R001",
                "category": "sales",
                "priority": "high",
                "run_id": "1",
            },
            {
                "record_id": "R002",
                "category": "support",
                "priority": "urgent",
                "run_id": "1",
            },
        ]
    )

    p = silver_builder(reader, writer, reject_writer, run_log=run_log)
    p.run()

    # The good row reaches the main writer
    assert_rows_equal(
        writer,
        [{"record_id": "R001", "category": "sales", "priority": "high"}],
        ignoring=["run_id"],
    )

    # The bad row is routed to the reject writer
    rejects = reject_writer.writes[0].to_pandas().to_dict("records")
    assert len(rejects) == 1
    assert rejects[0]["record_id"] == "R002"
    assert (
        "outside" in rejects[0]["failed_rule"]
        or "has value(s)" in rejects[0]["failed_rule"]
    )

    # The run log captured the partition statistics
    q_record = next(r for r in run_log.records if r["step"] == "quarantine")
    assert q_record["rows_in"] == 2
    assert q_record["rows_out"] == 1
    assert q_record["rows_quarantined"] == 1


def test_silver_builder_aborts_on_structural_breaches():
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # Missing 'priority', which violates the schema structurally.
    # Structural breaches still abort and bypass quarantine.
    reader = given_rows([{"record_id": "R001", "category": "sales"}])

    p = silver_builder(reader, writer, reject_writer)

    with pytest.raises(ValidationError, match="missing column 'priority'"):
        p.run()

    assert len(writer.writes) == 0
    assert len(reject_writer.writes) == 0
