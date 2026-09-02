"""Shared Reader over ``complaints_a``'s published silver.

Pass-through only; consumers own validation and freshness policy.
"""

from __future__ import annotations

import os

from framework.core import Dataset
from tools.medallion import medallion
from tools.store import StoreRegistry

_SUBJECT = "complaints_a"
_TABLE = "complaints_a"


class ComplaintsACasesReader:
    """Every Complaints A Case as currently ingested — one row per ``record_id``."""

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = medallion(StoreRegistry(base_dir), _SUBJECT).silver.reader(
            _TABLE
        )

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()
