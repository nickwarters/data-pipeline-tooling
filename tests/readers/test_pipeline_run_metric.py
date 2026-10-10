"""Location/delegation tests for the ``pipeline_run_metric`` Shared Readers."""

from __future__ import annotations

import sqlite3

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import Refresh
from readers.pipeline_run_metric import BatchFinishReader, DurationPercentilesReader
from tests.framework_testing import rows_of
from tools.medallion import medallion
from tools.store import StoreRegistry


def _seed(base_dir, table: str, rows: list[dict]) -> None:
    """Seed rows where the producer lands them."""
    gold = medallion(StoreRegistry(base_dir), "pipeline_run_metric").gold
    gold.writer(table, Refresh()).write(Dataset.from_pandas(pd.DataFrame(rows)))


@pytest.mark.parametrize(
    "reader_class, table",
    [
        (DurationPercentilesReader, "duration_percentiles_daily"),
        (BatchFinishReader, "batch_finish_daily"),
    ],
)
def test_each_reader_reads_what_the_producer_landed_in_gold(
    tmp_path, reader_class, table
):
    rows = [{"table": table, "value": 1.5}]
    _seed(tmp_path, table, rows)

    reader = reader_class(tmp_path)
    assert rows_of(reader.read()) == rows
    assert reader.data_locations[0]["name"] == table
    assert table in reader.describe()


def test_an_empty_base_dir_fails_the_way_the_underlying_reader_already_fails(
    tmp_path,
):
    with pytest.raises(sqlite3.OperationalError, match="unable to open database file"):
        DurationPercentilesReader(tmp_path).read()
