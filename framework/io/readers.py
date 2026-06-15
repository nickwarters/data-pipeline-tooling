"""Readers encapsulate source IO behind ``read() -> Dataset``.

The concrete engine lives inside readers and behind the Dataset seam, never in
the protocol signature.
"""

from __future__ import annotations

import os
from pathlib import Path
import pandas as pd

from framework._internal.connection import connect
from framework._internal.describe import redact_url, render
from framework.core.protocols import Reader
from framework.core.dataset import Dataset
from framework.io.remote import (
    RemoteRunner,
    SharePointFetcher,
    StubbedRemoteRunner,
    StubbedSharePointFetcher,
)
from framework.io.sql import quote_identifier

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


class SasReader:
    """Read a SAS feed by running it remotely and reading the landed output."""

    def __init__(
        self,
        script: str,
        copy_glob: str,
        dest: str | os.PathLike[str],
        *,
        runner: RemoteRunner | None = None,
    ) -> None:
        self._script = script
        self._copy_glob = copy_glob
        self._dest = Path(dest)
        self._runner = runner or StubbedRemoteRunner()

    def read(self) -> Dataset:
        self._runner.run_script(self._script)
        self._runner.fetch(self._copy_glob, self._dest)
        return GlobCsvReader(self._dest, self._copy_glob).read()

    def describe(self) -> str:
        return render(
            self,
            script=self._script,
            copy_glob=self._copy_glob,
            dest=str(self._dest),
        )


class SharePointReader:
    """Read a SharePoint list into a Dataset through a swappable fetcher."""

    def __init__(
        self,
        site: str,
        list_name: str,
        auth: object = None,
        *,
        fetcher: SharePointFetcher | None = None,
    ) -> None:
        self._site = site
        self._list_name = list_name
        self._auth = auth
        self._fetcher = fetcher or StubbedSharePointFetcher()

    def read(self) -> Dataset:
        return self._fetcher.fetch(self._site, self._list_name, self._auth)

    def describe(self) -> str:
        # Render the site with any embedded credentials stripped and omit the
        # auth config entirely — the plan never surfaces secrets.
        return render(self, site=redact_url(self._site), list_name=self._list_name)
