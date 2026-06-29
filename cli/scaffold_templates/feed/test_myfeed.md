```python
"""Tests for the ``myfeed`` feed pipeline.

These tests demonstrate granular, decoupled testability: by separating the
Pipeline definition into `raw_builder` and `silver_builder`, we can test the
logic purely in memory. We inject `given_rows` as the Reader and `RecordingWriter`
as the Writer. This never touches SQLite, the network, or the filesystem.
"""

from __future__ import annotations

from dataclasses import fields

import pytest

from framework.core import ValidationError
from framework.run import RunContext
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    read_rows,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

from .pipeline import FEED_NAME, raw_builder, run, silver_builder
from .schema import MyfeedRow


def test_bundled_sample_feed_refines_through_to_gold(tmp_path):
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    landed = read_rows(med.raw, FEED_NAME)
    assert len(landed) > 0
    assert {f.name for f in fields(MyfeedRow)}.issubset(landed[0].keys())

    silver = read_rows(med.silver, FEED_NAME)
    assert {f.name for f in fields(MyfeedRow)}.issubset(silver[0].keys())

    gold = read_rows(med.gold, FEED_NAME)
    assert len(gold) == len(landed)


def test_raw_builder_gates_source_columns():
    writer = RecordingWriter()
    # Replace with missing schema columns to test structural rejection
    reader = given_rows([{"invalid_col": "data"}])

    p = raw_builder(reader, writer)

    with pytest.raises(ValidationError, match="missing required column.*"):
        p.run()

    assert len(writer.writes) == 0


@pytest.mark.skip("add value rules first")
def test_silver_builder_quarantines_value_rule_breaches():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # Placeholders: update these keys to match your schema once defined
    reader = given_rows(
        [
            {"id": "1", "run_id": "1"},
            {"id": "invalid", "run_id": "1"},
        ]
    )

    p = silver_builder(reader, writer, reject_writer, run_log=run_log)
    p.run()

    assert len(writer.writes) == 1
    assert len(reject_writer.writes) == 1


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

```
