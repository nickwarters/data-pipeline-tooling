"""Readers — encapsulate source IO behind ``read() -> Dataset``.

A Reader is the only place that knows how a given source type is read; the
concrete engine (pandas) lives here and behind the Dataset seam, never in
the Protocol signature. Readers are tested against local fixture files.
See ADR-0002, ADR-0005.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol, runtime_checkable

import pandas as pd

from framework.connection import connect
from framework.dataset import Dataset


@runtime_checkable
class Reader(Protocol):
    """A source of one feed's data."""

    def read(self) -> Dataset:
        """Read the source and return its rows as a Dataset."""
        ...


class CsvReader:
    """Read a CSV feed from a local file into a Dataset."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._path = Path(path)

    def read(self) -> Dataset:
        return Dataset.from_pandas(pd.read_csv(self._path))


class ExcelReader:
    """Read one sheet of an Excel workbook into a Dataset.

    ``sheet`` selects the worksheet by name or zero-based index (default the
    first sheet). The concrete engine (pandas + openpyxl for ``.xlsx``) lives
    here behind the Dataset seam, never in the Protocol (ADR-0002). Tested
    against a local fixture workbook — no external system (ADR-0005).
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        sheet: str | int = 0,
    ) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._path = Path(path)
        self._sheet = sheet

    def read(self) -> Dataset:
        frame = pd.read_excel(self._path, sheet_name=self._sheet)
        return Dataset.from_pandas(frame)


class SqliteReader:
    """Read one table from a SQLite layer database into a Dataset.

    The read-side dual of the Sqlite Writers: where a Writer owns its target
    location, a ``SqliteReader`` owns its source location (a single layer db
    file + table). Opens through the shared ``connect`` factory so it inherits
    the share-tolerant settings (ADR-0001). Used to read a subject's own layer
    or another subject's Reference Data medallion (joined in Python — ADR-0002).
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms

    def read(self) -> Dataset:
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            frame = pd.read_sql(f"SELECT * FROM {self._table}", con)
        finally:
            con.close()
        return Dataset.from_pandas(frame)
