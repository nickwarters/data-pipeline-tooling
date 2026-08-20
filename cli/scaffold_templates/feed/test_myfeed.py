"""Tests for the ``myfeed`` feed pipeline.

Because each step is its own function over a ``Reader`` and a ``Writer``, a test
drives the real thing in memory: ``given_rows`` stands in for the source and
``RecordingWriter`` captures what would be written. This never touches SQLite,
the network, or the filesystem — and because the steps are eager, it runs
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

from .pipeline import FEED_NAME, run, to_gold, to_raw, to_silver
from .schema import MyfeedRow


def test_bundled_sample_feed_refines_through_to_gold(tmp_path):
    # The feed's tables are declared by migrations/myfeed/, not created by the
    # first write, so they have to exist before the run.
    build_databases(tmp_path, FEED_NAME)
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    landed = read_rows(med.raw, FEED_NAME)
    assert len(landed) > 0
    assert {f.name for f in fields(MyfeedRow)}.issubset(landed[0].keys())

    silver = read_rows(med.silver, FEED_NAME)
    assert {f.name for f in fields(MyfeedRow)}.issubset(silver[0].keys())

    gold = read_rows(med.gold, FEED_NAME)
    assert len(gold) == len(landed)


def test_to_raw_lands_the_source_rows():
    writer = RecordingWriter()
    reader = given_rows(
        [
            {"record_id": "1", "label": "a", "amount": 1},
        ]
    )

    landed = to_raw(reader, writer)

    # Row counts are not asserted: a scaffold seeded with --from-feed-file
    # replaces these rows with the real feed's, so its contract is what
    # holds -- everything read is landed, unchanged.
    assert len(writer.writes) == 1
    assert len(writer.writes[0]) == len(landed)


def test_to_raw_gates_source_columns():
    writer = RecordingWriter()
    # Replace with missing schema columns to test structural rejection
    reader = given_rows(
        [
            {"invalid_col": "data"},
        ]
    )

    with pytest.raises(ValidationError, match="missing required column.*"):
        to_raw(reader, writer)

    assert len(writer.writes) == 0


@pytest.mark.skip("add value rules first")
def test_to_silver_quarantines_value_rule_breaches():
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # Placeholders: update these keys to match your schema once defined
    reader = given_rows(
        [
            {"record_id": "1", "label": "a", "amount": 1},
            {"record_id": "2", "label": "b", "amount": -1},
        ]
    )

    to_silver(reader, writer, reject_writer)

    assert len(writer.writes) == 1
    assert len(reject_writer.writes) == 1


def test_to_silver_aborts_on_structural_breaches():
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # Missing required schema columns triggers an abort
    reader = given_rows(
        [
            {"invalid_col": "data"},
        ]
    )

    with pytest.raises(ValueError, match="(?i)column"):
        to_silver(reader, writer, reject_writer)

    assert len(writer.writes) == 0
    assert len(reject_writer.writes) == 0


def test_to_gold_passes_silver_through():
    writer = RecordingWriter()
    reader = given_rows(
        [
            {"record_id": "1", "label": "a", "amount": 1},
        ]
    )

    to_gold(reader, writer)

    assert len(writer.writes) == 1
