"""Tests for the ``myfeed`` feed pipeline."""

from __future__ import annotations

from dataclasses import fields

from framework.core import RAW
from framework.io import StoreCatalog
from framework.run import Pipeline
from framework.testing import RecordingWriter, given_rows, read_rows, rows_of
from framework.validate import ColumnValidator

from .pipeline import FEED_NAME, run
from .schema import MyfeedRow


def test_source_rows_become_output_rows():
    # Mirror run()'s validator without touching the filesystem.
    source = [
        {"record_id": "R001", "label": "alpha", "amount": 100},
        {"record_id": "R002", "label": "beta", "amount": 250},
    ]
    writer = RecordingWriter()

    (
        Pipeline(FEED_NAME, given_rows(source))
        .with_validator(ColumnValidator([f.name for f in fields(MyfeedRow)]))
        .write_to(writer)
        .run()
    )

    assert rows_of(writer) == source


def test_bundled_sample_feed_lands_in_raw(tmp_path):
    dataset = run(tmp_path)

    store = StoreCatalog(tmp_path).store(FEED_NAME)
    landed = read_rows(store, RAW, FEED_NAME)
    assert len(landed) == len(dataset)
    assert {f.name for f in fields(MyfeedRow)}.issubset(landed[0].keys())
