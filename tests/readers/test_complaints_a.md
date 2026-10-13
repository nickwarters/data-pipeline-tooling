```python
"""Shared-reader delegation tests for the ``complaints_a`` silver subject."""

from __future__ import annotations

import sqlite3

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import Refresh
from readers.complaints_a import ComplaintsACasesReader
from tests.framework_testing import rows_of
from tools.medallion import medallion
from tools.store import StoreRegistry

ROWS = [
    {"record_id": "R001", "label": "alpha", "amount": 100},
    {"record_id": "R003", "label": "gamma", "amount": 75},
]


def _seed(base_dir, rows: list[dict]) -> None:
    silver = medallion(StoreRegistry(base_dir), "complaints_a").silver
    dataset = Dataset.from_pandas(pd.DataFrame(rows))
    silver.writer("complaints_a", Refresh()).write(dataset)


def test_reads_what_the_producer_landed_in_silver(tmp_path):
    _seed(tmp_path, ROWS)

    assert rows_of(ComplaintsACasesReader(tmp_path).read()) == ROWS


def test_describe_and_data_locations_delegate_to_the_reader_underneath(tmp_path):
    _seed(tmp_path, ROWS)
    reader = ComplaintsACasesReader(tmp_path)

    described = reader.describe()
    assert "complaints_a" in described
    assert str(tmp_path / "complaints_a" / "silver.db") in described

    assert reader.data_locations == []
    reader.read()
    silver_db = (tmp_path / "complaints_a" / "silver.db").as_posix()
    assert reader.data_locations == [
        {"namespace": f"sqlite:{silver_db}", "name": "complaints_a"}
    ]


def test_an_empty_base_dir_fails_the_way_the_underlying_reader_already_fails(tmp_path):
    reader = ComplaintsACasesReader(tmp_path)

    with pytest.raises(sqlite3.OperationalError, match="unable to open database file"):
        reader.read()

```
