"""Readers — encapsulate source IO behind ``read() -> DataHandle``.

A Reader is the only place that knows how a given source type is read; the
concrete engine (pandas) lives here and behind the DataHandle seam, never in
the Protocol signature. Readers are tested against local fixture files.
See ADR-0002, ADR-0005.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol, runtime_checkable

import pandas as pd

from framework.data_handle import DataHandle


@runtime_checkable
class Reader(Protocol):
    """A source of one feed's data."""

    def read(self) -> DataHandle:
        """Read the source and return its rows as a DataHandle."""
        ...


class CsvReader:
    """Read a CSV feed from a local file into a DataHandle."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._path = Path(path)

    def read(self) -> DataHandle:
        return DataHandle.from_pandas(pd.read_csv(self._path))
