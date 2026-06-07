```python
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
from framework.remote import (
    RemoteRunner,
    SharePointFetcher,
    StubbedRemoteRunner,
    StubbedSharePointFetcher,
)


@runtime_checkable
class Reader(Protocol):
    """A source of one feed's data."""

    def read(self) -> Dataset:
        """Read the source and return its rows as a Dataset."""
        ...


class DatasetReader:
    """Adapt an already-in-memory ``Dataset`` to the ``Reader`` shape.

    The bridge that lets the deferred :class:`~framework.builder.Pipeline` read a
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
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._path = Path(path)
        self._columns = columns

    def read(self) -> Dataset:
        kwargs: dict = {}
        if self._columns is not None:
            kwargs["usecols"] = self._columns
        return Dataset.from_pandas(pd.read_csv(self._path, **kwargs))


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
        columns: list[str] | None = None,
    ) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms
        self._columns = columns

    def read(self) -> Dataset:
        if self._columns is not None:
            col_list = ", ".join(self._columns)
            query = f"SELECT {col_list} FROM {self._table}"
        else:
            query = f"SELECT * FROM {self._table}"
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            frame = pd.read_sql(query, con)
        finally:
            con.close()
        return Dataset.from_pandas(frame)


class SasReader:
    """Read a SAS feed by running it remotely and reading the landed output.

    SAS never runs on the framework host, so a ``SasReader`` is configured with
    three knobs — ``script`` (run on the remote box), ``copy_glob`` (which output
    files to copy back), ``dest`` (the local landing directory) — and on
    ``read()``: (1) runs the script, (2) fetches the matching files into ``dest``,
    (3) reads the landed files via the ordinary file read path. Steps (1) and (2)
    are delegated to a swappable :class:`~framework.remote.RemoteRunner`; the
    default is the no-op stub, so the feed is testable against landed fixtures
    with no SSH/SAS/network (ADR-0004, ADR-0005).
    """

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
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._dest = Path(dest)
        self._runner = runner or StubbedRemoteRunner()

    def read(self) -> Dataset:
        self._runner.run_script(self._script)
        self._runner.fetch(self._copy_glob, self._dest)
        # The ordinary local file read path: the same CSV engine the CsvReader
        # uses, behind the Dataset seam. Files are read in sorted order so a
        # multi-file glob lands deterministically.
        paths = sorted(self._dest.glob(self._copy_glob))
        if not paths:
            raise FileNotFoundError(
                f"No files match {self._copy_glob!r} in landing directory {self._dest}"
            )
        frame = pd.concat(
            [pd.read_csv(path) for path in paths], ignore_index=True
        )
        return Dataset.from_pandas(frame)


class SharePointReader:
    """Read a SharePoint list into a Dataset.

    Configured with the SharePoint ``site``, ``list_name``, and ``auth`` config;
    the fetch is delegated to a swappable
    :class:`~framework.remote.SharePointFetcher`. The default fetcher defers the
    real client (auth/tenant out of scope — ADR-0004) and raises on ``read()``;
    pass a :class:`~framework.remote.LocalCsvFetcher` to read a local fixture, or
    a real client later, without changing this Reader (ADR-0005).
    """

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

```
