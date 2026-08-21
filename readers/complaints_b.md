```python
"""Shared Reader over the ``complaints_b`` Case Type's published silver.

The Complaints B ingest is the only thing that writes this dataset. This module
is the one place that knows *where* it is, so a consumer such as Complaint
Selection names neither a layer nor a table and asserts nothing about the
producer's storage shape.

A pass-through: it hands back the rows as landed, with no projection, no
coercion and no column contract. It declares no freshness requirement either —
each consuming pipeline declares its own ``UPSTREAMS``.

Silver is the Case Type's most-refined layer today (it has no gold); the day it
grows one, this module is the only thing that changes.
"""

from __future__ import annotations

import os

from framework.core import Dataset
from tools.medallion import medallion
from tools.store import StoreRegistry

_SUBJECT = "complaints_b"
_TABLE = "complaints_b"


class ComplaintsBCasesReader:
    """Every Complaints B Case as currently ingested — one row per ``record_id``."""

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

```
