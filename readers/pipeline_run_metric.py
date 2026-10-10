"""Shared Readers over ``pipeline_run_metric``'s published gold.

Pass-through only; consumers own presentation.
"""

from __future__ import annotations

import os

from framework.core import Dataset
from tools.medallion import medallion
from tools.store import StoreRegistry

_SUBJECT = "pipeline_run_metric"
_PERCENTILES_TABLE = "duration_percentiles_daily"
_BATCH_FINISH_TABLE = "batch_finish_daily"


def _gold_reader(base_dir, table):
    return medallion(StoreRegistry(base_dir), _SUBJECT).gold.reader(table)


class DurationPercentilesReader:
    """Rolling duration percentiles per pipeline and step, one row per date."""

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _PERCENTILES_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()


class BatchFinishReader:
    """When each run date's scheduled batch finished."""

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _BATCH_FINISH_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()
