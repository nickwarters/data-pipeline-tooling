"""Readers encapsulate source IO behind ``read() -> Dataset``.

The concrete engine lives inside readers and behind the Dataset seam, never in
the protocol signature.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

from framework._internal.connection import connect
from framework._internal.describe import render
from framework.core.dataset import Dataset
from framework.core.protocols import Reader
from framework.io.sql import quote_identifier

# ``Reader`` is imported only to be re-exported through ``framework.io``; listing
# it in ``__all__`` marks it as intentional public surface so lint won't strip it.
__all__ = [
    "Reader",
    "DatasetReader",
    "CsvReader",
    "GlobCsvReader",
    "ExcelReader",
    "SqliteReader",
]


class DatasetReader:
    """Adapt an already-in-memory ``Dataset`` to the ``Reader`` shape.

    The bridge that lets the deferred :class:`~framework.run.builder.Pipeline` read a
    dataset the caller already holds, so a pipeline can reuse the same
    read→process→write builder without a SQL round-trip. Holds no engine and
    touches no file; it simply hands back the dataset it was given.
    """

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def read(self) -> Dataset:
        return self._dataset


class CsvReader:
    """Read a CSV feed from a local file into a Dataset."""

    def __init__(
        self,
        path: str | os.PathLike[str],
        columns: list[str] | None = None,
    ) -> None:
        self._path = Path(path)
        self._columns = columns

    def read(self) -> Dataset:
        kwargs: dict = {}
        if self._columns is not None:
            kwargs["usecols"] = self._columns
        return Dataset.from_pandas(pd.read_csv(self._path, **kwargs))

    def describe(self) -> str:
        return render(self, path=str(self._path), columns=self._columns)


class GlobCsvReader:
    """Read many local CSV files that together form one logical feed snapshot."""

    def __init__(
        self,
        directory: str | os.PathLike[str],
        pattern: str,
        columns: list[str] | None = None,
    ) -> None:
        self._directory = Path(directory)
        self._pattern = pattern
        self._columns = columns

    def read(self) -> Dataset:
        paths = sorted(self._directory.glob(self._pattern))
        if not paths:
            raise FileNotFoundError(
                f"No files match {self._pattern!r} in directory {self._directory}"
            )
        kwargs: dict = {}
        if self._columns is not None:
            kwargs["usecols"] = self._columns
        frame = pd.concat(
            [pd.read_csv(path, **kwargs) for path in paths], ignore_index=True
        )
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(
            self,
            directory=str(self._directory),
            pattern=self._pattern,
            columns=self._columns,
        )


class ExcelReader:
    """Read one sheet of an Excel workbook into a Dataset."""

    def __init__(
        self,
        path: str | os.PathLike[str],
        sheet: str | int = 0,
    ) -> None:
        self._path = Path(path)
        self._sheet = sheet

    def read(self) -> Dataset:
        frame = pd.read_excel(self._path, sheet_name=self._sheet)
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(self, path=str(self._path), sheet=self._sheet)


class SqliteReader:
    """Read one table from a SQLite layer database into a Dataset."""

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        busy_timeout_ms: int = 5000,
        columns: list[str] | None = None,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms
        self._columns = columns

    def read(self) -> Dataset:
        table = quote_identifier(self._table)
        if self._columns is not None:
            col_list = ", ".join(quote_identifier(c) for c in self._columns)
            query = f"SELECT {col_list} FROM {table}"
        else:
            query = f"SELECT * FROM {table}"
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            frame = pd.read_sql(query, con)
        finally:
            con.close()
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(
            self,
            db_path=str(self._db_path),
            table=self._table,
            columns=self._columns,
        )
