```python
"""Tests for the Shared Reader over the ``complaints_c`` subject's silver.

A *location* indirection and nothing else: rows seeded where the producer puts
them come back, the three ports delegate to the Reader underneath, and a base
directory holding nothing fails the way that Reader already fails.
"""

from __future__ import annotations

import sqlite3

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import Refresh
from readers.complaints_c import ComplaintsCCasesReader
from tests.framework_testing import rows_of
from tools.medallion import medallion
from tools.store import StoreRegistry

ROWS = [
    {"record_id": "C1", "department": "hr", "resolution_days": 5},
    {"record_id": "C3", "department": "hr", "resolution_days": 10},
]


def _seed(base_dir, rows: list[dict]) -> None:
    silver = medallion(StoreRegistry(base_dir), "complaints_c").silver
    dataset = Dataset.from_pandas(pd.DataFrame(rows))
    silver.writer("complaints_c", Refresh()).write(dataset)


def test_reads_what_the_producer_landed_in_silver(tmp_path):
    _seed(tmp_path, ROWS)

    assert rows_of(ComplaintsCCasesReader(tmp_path).read()) == ROWS


def test_describe_and_data_locations_delegate_to_the_reader_underneath(tmp_path):
    _seed(tmp_path, ROWS)
    reader = ComplaintsCCasesReader(tmp_path)

    described = reader.describe()
    assert "complaints_c" in described
    assert str(tmp_path / "complaints_c" / "silver.db") in described

    assert reader.data_locations == []
    reader.read()
    silver_db = (tmp_path / "complaints_c" / "silver.db").as_posix()
    assert reader.data_locations == [
        {"namespace": f"sqlite:{silver_db}", "name": "complaints_c"}
    ]


def test_an_empty_base_dir_fails_the_way_the_underlying_reader_already_fails(tmp_path):
    reader = ComplaintsCCasesReader(tmp_path)

    with pytest.raises(sqlite3.OperationalError, match="unable to open database file"):
        reader.read()

```
