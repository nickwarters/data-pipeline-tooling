"""Tests for the ``myfeed`` Case Type ingest.

Because each hop is its own function over a ``Reader`` and a ``Writer``, a test
drives the real hop in memory: ``given_rows`` stands in for the source and
``RecordingWriter`` captures what would be written. This never touches SQLite,
the network, or the filesystem — and because the steps are eager, the hop runs
where it is called, so a failing test stops on the line that failed.
"""

from __future__ import annotations

from dataclasses import fields

import pytest

from framework.core import ValidationError
from framework.run import RunContext
from tests.framework_testing import (
    RecordingWriter,
    build_databases,
    given_rows,
    read_rows,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

from .pipeline import FEED_NAME, raw_hop, run, silver_hop
from .schema import NAMESPACE, NATURAL_KEY, MyfeedRow


def test_case_type_declares_its_identity_contract():
    assert NAMESPACE == "myfeed"
    declared = {f.name for f in fields(MyfeedRow)}
    assert set(NATURAL_KEY) <= declared


def test_source_lands_in_raw_then_conforms_to_silver(tmp_path):
    # The feed's tables are declared by migrations/myfeed/, not created by the
    # first write, so they have to exist before the run.
    build_databases(tmp_path, FEED_NAME)
    silver = run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))
    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    raw = read_rows(med.raw, FEED_NAME)
    assert len(raw) > 0

    silver_rows = read_rows(med.silver, FEED_NAME)
    assert len(silver_rows) == len(silver)
    declared = {f.name for f in fields(MyfeedRow)}
    assert declared.issubset(silver_rows[0].keys())


def test_raw_hop_gates_source_columns():
    writer = RecordingWriter()
    # Replace with missing schema columns to test structural rejection
    reader = given_rows(
        [
            {"invalid_col": "data"},
        ]
    )

    with pytest.raises(ValidationError, match="missing required column.*"):
        raw_hop(reader, writer)

    assert len(writer.writes) == 0


@pytest.mark.skip("add value rules first")
def test_silver_hop_quarantines_value_rule_breaches():
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # R001 is a placeholder for a valid schema row
    # R002 is a placeholder for an invalid schema row that trips a value rule
    reader = given_rows(
        [
            {"record_id": "R001", "label": "alpha", "amount": 50},
            {"record_id": "R002", "label": "beta", "amount": -1},
        ]
    )

    silver_hop(reader, writer, reject_writer)

    assert len(writer.writes) == 1
    assert len(reject_writer.writes) == 1


def test_silver_hop_aborts_on_structural_breaches():
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # Missing required schema columns triggers an abort
    reader = given_rows(
        [
            {"invalid_col": "data"},
        ]
    )

    with pytest.raises(ValueError, match="(?i)column"):
        silver_hop(reader, writer, reject_writer)

    assert len(writer.writes) == 0
    assert len(reject_writer.writes) == 0
