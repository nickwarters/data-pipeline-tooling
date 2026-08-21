```python
"""Tests for the ``complaints_a`` Case Type ingest.

Each step is an ordinary function over a ``Reader`` and a ``Writer`` whose lines
run where they are written, so a test drives the real thing in memory:
``given_rows`` stands in for the source and ``RecordingWriter`` captures what
would be written. This never touches SQLite, the network, or the filesystem —
and a failing assertion stops on the line that failed.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from framework.core import ValidationError
from framework.run.run_context import RunContext, active_context
from pipelines.complaints_a.pipeline import FEED_NAME, run, to_raw, to_silver
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    assert_rows_equal,
    given_rows,
    read_rows,
)
from tools.medallion import medallion
from tools.store import StoreRegistry


def test_bundled_sample_feed_refines_through_to_silver(tmp_path):
    landing = tmp_path / "landing_zone"
    landing.mkdir(parents=True)

    sample_dir = (
        Path(__file__).parent.parent.parent
        / "pipelines"
        / "complaints_a"
        / "sample_data"
    )
    shutil.copy(sample_dir / f"{FEED_NAME}.csv", landing / f"{FEED_NAME}.csv")

    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    # 2 good rows + 2 quarantined rows = 4 raw rows
    raw = read_rows(med.raw, FEED_NAME)
    assert len(raw) == 4

    # 2 rows breach value rules and are quarantined, 2 rows pass
    silver = read_rows(med.silver, FEED_NAME)
    assert len(silver) == 2


def test_both_steps_record_exactly_the_steps_they_always_have():
    """Pin what each one does, step by step.

    The steps are eager, so what the feed *did* is what it recorded — and the step
    names are what the run log stores, so a change to either is a change to how
    a run is read back.
    """
    rows = [{"record_id": "R001", "label": "alpha", "amount": 50}]
    writer, rejects = RecordingWriter(), RecordingWriter()

    raw_log = RecordingRunLog()
    with active_context(RunContext(pipeline=FEED_NAME, run_log=raw_log)):
        to_raw(given_rows(rows), writer)

    silver_log = RecordingRunLog()
    with active_context(RunContext(pipeline=FEED_NAME, run_log=silver_log)):
        to_silver(given_rows(rows), writer, rejects)

    # Each step names the layer it lands in, so one run log holding both says
    # which ``read`` was which rather than ``read`` and ``read-2``.
    assert [record["step"] for record in raw_log.records] == [
        "raw:read",
        "raw:column_validator",
        "raw:write",
    ]
    # ``enforce`` is coerce -> quarantine -> validate, and each part still
    # records its own step, so the run log reads exactly as it did when the
    # three were written out by hand.
    assert [record["step"] for record in silver_log.records] == [
        "silver:read",
        "silver:coerce",
        "silver:quarantine",
        "silver:schema_validator",
        "silver:write",
    ]


def test_to_raw_gates_source_columns():
    writer = RecordingWriter()
    # Missing 'amount' column
    reader = given_rows([{"record_id": "c1", "label": "alpha"}])

    with pytest.raises(ValidationError, match="missing required column.*amount"):
        to_raw(reader, writer)

    assert len(writer.writes) == 0


def test_to_silver_quarantines_value_rule_breaches():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # R001 is valid (amount=50)
    # R002 breaches the Range(minimum=0, maximum=100) rule (amount=250)
    reader = given_rows(
        [
            {"record_id": "R001", "label": "alpha", "amount": 50, "run_id": "1"},
            {"record_id": "R002", "label": "beta", "amount": 250, "run_id": "1"},
        ]
    )

    with active_context(RunContext(pipeline=FEED_NAME, run_log=run_log)):
        to_silver(reader, writer, reject_writer)

    # The good row reaches the main writer
    assert_rows_equal(
        writer,
        [{"record_id": "R001", "label": "alpha", "amount": 50}],
        ignoring=["run_id"],
    )

    # The bad row is routed to the reject writer
    rejects = reject_writer.writes[0].to_pandas().to_dict("records")
    assert len(rejects) == 1
    assert rejects[0]["record_id"] == "R002"
    assert "value not in [0, 100]" in rejects[0]["failed_rule"]

    # The run log captured the partition statistics
    q_record = next(r for r in run_log.records if r["step"] == "silver:quarantine")
    assert q_record["rows_in"] == 2
    assert q_record["rows_out"] == 1
    assert q_record["rows_quarantined"] == 1


def test_to_silver_aborts_on_structural_breaches():
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # Missing 'amount', which violates the schema structurally.
    # Structural breaches still abort and bypass quarantine.
    reader = given_rows([{"record_id": "c1", "label": "alpha"}])

    with pytest.raises(ValidationError, match="missing column 'amount'"):
        to_silver(reader, writer, reject_writer)

    assert len(writer.writes) == 0
    assert len(reject_writer.writes) == 0

```
