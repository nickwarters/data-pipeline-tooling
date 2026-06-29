```python
"""Tests for the ``complaints_b`` Case Type ingest.

These tests demonstrate granular, decoupled testability: by separating the
Pipeline definition into `raw_builder` and `silver_builder`, we can test the
logic purely in memory. We inject `given_rows` as the Reader and `RecordingWriter`
as the Writer. This never touches SQLite, the network, or the filesystem.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from framework.core import ValidationError
from framework.io import StoreCatalog
from framework.run import RunContext
from pipelines.complaints_b.pipeline import FEED_NAME, raw_builder, run, silver_builder
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    assert_rows_equal,
    given_rows,
    read_rows,
)
from tools.medallion import medallion


def test_bundled_sample_feed_refines_through_to_silver(tmp_path):
    landing = tmp_path / "landing_zone"
    landing.mkdir(parents=True)

    sample_dir = (
        Path(__file__).parent.parent.parent
        / "pipelines"
        / "complaints_b"
        / "sample_data"
    )
    shutil.copy(sample_dir / f"{FEED_NAME}.csv", landing / f"{FEED_NAME}.csv")

    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    med = medallion(StoreCatalog(tmp_path), FEED_NAME)

    raw = read_rows(med.raw, FEED_NAME)
    assert len(raw) == 3

    silver = read_rows(med.silver, FEED_NAME)
    assert len(silver) == 3


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

```
