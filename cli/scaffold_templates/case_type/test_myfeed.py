"""Tests for the ``myfeed`` Case Type ingest.

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

from .case_type import CASE_TYPE
from .pipeline import FEED_NAME, raw_builder, run, silver_builder
from .schema import MyfeedRow

#: See the twin constant/helper in cli/scaffold_templates/feed/test_myfeed.py:
#: an empty-list-seeded column always infers float64 regardless of the
#: schema's declared type, so create_table needs a *typed* empty row instead.
_TYPE_DEFAULTS = {"str": "", "int": 0, "float": 0.0, "bool": False}


def _empty_migrated_frame() -> pd.DataFrame:
    row = {f.name: _TYPE_DEFAULTS.get(f.type, "") for f in fields(MyfeedRow)}
    row.update(logical_run_id="", load_date="", pipeline_run_id="")
    return pd.DataFrame([row]).iloc[:0]


def test_case_type_declares_its_identity_contract():
    assert CASE_TYPE.schema is MyfeedRow
    declared = {f.name for f in fields(MyfeedRow)}
    assert set(CASE_TYPE.natural_key) <= declared
    assert CASE_TYPE.namespace is not None


def test_source_lands_in_raw_then_conforms_to_silver(tmp_path):
    # Both raw and silver Writers require their table to already exist
    # (#324): a real scaffolded Case Type gets this from `python -m cli
    # scaffold --case-type`'s generated migrations plus `migrate`; this
    # template test drives the bundled sample in isolation, so it mints each
    # table directly, shaped for the run-stamp columns AccumulateByRun adds.
    empty = Dataset.from_pandas(_empty_migrated_frame())
    for layer in ("raw", "silver"):
        create_table(tmp_path / FEED_NAME / f"{layer}.db", FEED_NAME, empty)

    silver = run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))
    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    raw = read_rows(med.raw, FEED_NAME)
    assert len(raw) > 0

    silver_rows = read_rows(med.silver, FEED_NAME)
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


@pytest.mark.skip("add value rules first")
def test_silver_builder_quarantines_value_rule_breaches():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    reject_writer = RecordingWriter()

    # R001 is a placeholder for a valid schema row
    # R002 is a placeholder for an invalid schema row that triggers a value-rule breach
    reader = given_rows(
        [
            {"record_id": "R001", "label": "alpha", "amount": 50, "run_id": "1"},
            {"record_id": "R002", "label": "beta", "amount": "abc", "run_id": "1"},
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
