```python
"""Tests for the ``myfeed`` feed pipeline."""

from __future__ import annotations

from dataclasses import fields

from framework.core import GOLD, RAW, SILVER
from framework.io import StoreCatalog
from framework.run import RunContext
from framework.testing import RecordingWriter, given_rows, read_rows, rows_of

from .pipeline import FEED_NAME, raw_builder, run
from .schema import MyfeedRow


def test_source_rows_become_output_rows():
    # Drive the *actual* raw hop (raw_builder) with sample rows and a recording
    # writer -- no filesystem, no rebuild of the composition under test.
    source = [
        {"record_id": "R001", "label": "alpha", "amount": 100},
        {"record_id": "R002", "label": "beta", "amount": 250},
    ]
    writer = RecordingWriter()

    raw_builder(given_rows(source), writer).run()

    assert rows_of(writer) == source


def test_bundled_sample_feed_refines_through_to_gold(tmp_path):
    dataset = run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    store = StoreCatalog(tmp_path).store(FEED_NAME)

    landed = read_rows(store, RAW, FEED_NAME)
    assert len(landed) > 0
    assert {f.name for f in fields(MyfeedRow)}.issubset(landed[0].keys())

    silver = read_rows(store, SILVER, FEED_NAME)
    assert {f.name for f in fields(MyfeedRow)}.issubset(silver[0].keys())

    gold = read_rows(store, GOLD, FEED_NAME)
    assert len(gold) == len(dataset)

```
