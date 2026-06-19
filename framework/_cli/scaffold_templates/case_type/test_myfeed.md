```python
"""Tests for the ``myfeed`` Case Type ingest."""

from __future__ import annotations

from dataclasses import fields

from framework.core import RAW, SILVER
from framework.io import StoreCatalog
from framework.run import RunContext
from framework.testing import read_rows

from .case_type import CASE_TYPE
from .pipeline import FEED_NAME, run
from .schema import MyfeedRow


def test_case_type_declares_its_identity_contract():
    assert CASE_TYPE.schema is MyfeedRow
    declared = {f.name for f in fields(MyfeedRow)}
    assert set(CASE_TYPE.natural_key) <= declared
    assert CASE_TYPE.namespace is not None


def test_source_lands_in_raw_then_conforms_to_silver(tmp_path):
    silver = run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME))

    store = StoreCatalog(tmp_path).store(FEED_NAME)

    raw = read_rows(store, RAW, FEED_NAME)
    assert len(raw) > 0

    silver_rows = read_rows(store, SILVER, FEED_NAME)
    assert len(silver_rows) == len(silver)
    declared = {f.name for f in fields(MyfeedRow)}
    assert declared.issubset(silver_rows[0].keys())

```
