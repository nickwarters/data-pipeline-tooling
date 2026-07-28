"""Tests for the ``myfeed`` feed pipeline.

These tests demonstrate granular, decoupled testability: by separating the
Pipeline definition into `raw_builder` and `silver_builder`, we can test the
logic purely in memory. We inject `given_rows` as the Reader and `RecordingWriter`
as the Writer. This never touches SQLite, the network, or the filesystem.
"""

from __future__ import annotations

from dataclasses import fields

import pandas as pd
import pytest

from framework.core import ValidationError
from framework.core.dataset import Dataset
from framework.run import RunContext
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    create_table,
    given_rows,
    read_rows,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

from .pipeline import FEED_NAME, raw_builder, run, silver_builder
from .schema import MyfeedRow

#: A field-type default good enough to seed a *typed* empty row -- an empty
#: list per column (``{"amount": []}``) infers every column as float64
#: regardless of the schema's declared type, and a hand-minted table with the
#: wrong storage type would then silently downcast an inserted int to a float
#: (SQLite's column-affinity coercion), failing silver's dtype check on
#: read-back for a reason that has nothing to do with the test.
_TYPE_DEFAULTS = {"str": "", "int": 0, "float": 0.0, "bool": False}


def _empty_migrated_frame() -> pd.DataFrame:
    """One dtype-correct row, dropped immediately (``.iloc[:0]`` keeps pandas'
    per-column dtype from the row itself, unlike an empty list)."""
    row = {f.name: _TYPE_DEFAULTS.get(f.type, "") for f in fields(MyfeedRow)}
    row.update(logical_run_id="", load_date="", pipeline_run_id="")
    return pd.DataFrame([row]).iloc[:0]


def test_bundled_sample_feed_refines_through_to_gold(tmp_path):
    # Every hop's Writer requires its table to already exist (#324): a real
    # scaffolded feed gets this from `python -m cli scaffold`'s generated
    # migrations (see cli/scaffold.py's _emit_migrations) plus `migrate` --
    # this template test drives the bundled sample in isolation instead, so it
    # mints each table directly, shaped for the run-stamp columns
    # AccumulateByRun adds. (silver's quarantine table is not needed here: the
    # bundled MyfeedRow declares no value rules yet, so nothing is ever
    # rejected and QuarantineWriter.write is never called.)
    empty = Dataset.from_pandas(_empty_migrated_frame())
    for layer in ("raw", "silver", "gold"):
        create_table(tmp_path / FEED_NAME / f"{layer}.db", FEED_NAME, empty)

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
