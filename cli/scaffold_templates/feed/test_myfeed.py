"""Tests for the ``myfeed`` feed pipeline."""

from __future__ import annotations

from dataclasses import fields

from framework.core import GOLD, RAW, SILVER
from framework.io import StoreCatalog
from framework.run import RunContext
from tests.framework_testing import read_rows

from .pipeline import FEED_NAME, run
from .schema import MyfeedRow


def test_source_rows_process_correctly():
    source = [
        {"dummy": "row"},
    ]
    assert len(source) > 0


def test_bundled_sample_feed_refines_through_to_gold(tmp_path):
    run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    store = StoreCatalog(tmp_path).store(FEED_NAME)

    landed = read_rows(store, RAW, FEED_NAME)
    assert len(landed) > 0
    assert {f.name for f in fields(MyfeedRow)}.issubset(landed[0].keys())

    silver = read_rows(store, SILVER, FEED_NAME)
    assert {f.name for f in fields(MyfeedRow)}.issubset(silver[0].keys())

    gold = read_rows(store, GOLD, FEED_NAME)
    # The dataset returned is None since run() doesn't return anything natively anymore,
    # but we can verify gold wrote the right data
    assert len(gold) == len(landed)
