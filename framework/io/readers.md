```python
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
    "StrictCsvReader",
    "StrictCsvParseError",
    "GlobCsvReader",
    "ExcelReader",
    "SqliteReader",
]


class StrictCsvParseError(ValueError):
    """A CSV file violated the strict RFC 4180 grammar (located message)."""


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


class StrictCsvReader:
    """Read a CSV by parsing it character by character, strictly per RFC 4180.

    The home of a hand-written CSV parser for feeds that *do* honour the CSV
    grammar yet trip pandas / the stdlib ``csv`` module: a quote character
    appearing inside a quoted field (escaped by doubling — ``""``), a record
    that spans physical lines because a quoted field contains a newline, a
    delimiter that sits inside a quoted field, and so on. It walks the source
    one character at a time through a small state machine, so the only thing
    that ends a field is an unquoted delimiter and the only thing that ends a
    record is an unquoted line break — exactly the RFC 4180 rules.

    What it guarantees:

    - Quoted fields may contain the delimiter, ``CR``/``LF`` line breaks, and
      the quote character itself. By default the quote is escaped by *doubling*
      (``""``) per RFC 4180; pass ``escapechar`` (e.g. ``"\\"``) for the dialect
      that escapes it with a preceding character instead — then the escapechar
      removes the special meaning of the character that follows it (``\\"`` is a
      literal quote, ``\\\\`` a literal backslash) and quote-doubling is off.
      Everything between the opening and closing quote is taken verbatim.
    - ``CRLF``, lone ``LF``, and lone ``CR`` each terminate a record when they
      appear outside quotes (Windows/macOS/old-Mac line endings all parse);
      inside a quoted field they are preserved verbatim as data.
    - The first record is the header. Every data record must have the same
      field count as the header, or a located :class:`StrictCsvParseError` is
      raised naming the offending record — the *strict* in the name.
    - Values are landed as **text** (no type inference): the job here is
      faithful tokenisation, leaving dtype decisions to silver coercion
      (``SchemaCoercion``) the same way the raw layer stays schema-light. An
      empty field is the empty string; a doubled-quote empty field ``""`` is
      likewise the empty string.

    A BOM is tolerated (default encoding ``utf-8-sig``). Paths are handled with
    :mod:`pathlib`, so it behaves identically on Windows and macOS. Like the
    other CSV readers it accepts ``columns=[...]`` to project to a subset of
    the header (preserving the requested order).
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        columns: list[str] | None = None,
        *,
        delimiter: str = ",",
        quotechar: str = '"',
        escapechar: str | None = None,
        encoding: str = "utf-8-sig",
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError("delimiter must be a single character")
        if len(quotechar) != 1:
            raise ValueError("quotechar must be a single character")
        if escapechar is not None and len(escapechar) != 1:
            raise ValueError("escapechar must be a single character")
        self._path = Path(path)
        self._columns = columns
        self._delimiter = delimiter
        self._quotechar = quotechar
        self._escapechar = escapechar
        self._encoding = encoding

    def read(self) -> Dataset:
        # newline="" so Python performs no universal-newline translation; the
        # parser is the sole authority on what ends a record, which is what lets
        # an embedded CRLF survive inside a quoted field.
        with self._path.open(encoding=self._encoding, newline="") as handle:
            text = handle.read()
        records = _parse_strict_csv(
            text, self._delimiter, self._quotechar, self._escapechar
        )
        if not records:
            frame = pd.DataFrame()
            return Dataset.from_pandas(frame)

        header, *rows = records
        for index, row in enumerate(rows):
            if len(row) != len(header):
                # +2: skip the 1-based header line and count from the first data row.
                raise StrictCsvParseError(
                    f"{self._path}: record {index + 2} has {len(row)} fields, "
                    f"expected {len(header)} to match the header"
                )
        frame = pd.DataFrame(rows, columns=header, dtype="object")
        if self._columns is not None:
            missing = [c for c in self._columns if c not in frame.columns]
            if missing:
                raise StrictCsvParseError(
                    f"{self._path}: requested columns not in header: {missing}"
                )
            frame = frame[self._columns]
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(
            self,
            path=str(self._path),
            columns=self._columns,
            delimiter=self._delimiter,
            quotechar=self._quotechar,
            escapechar=self._escapechar,
            encoding=self._encoding,
        )


def _parse_strict_csv(
    text: str,
    delimiter: str,
    quotechar: str,
    escapechar: str | None = None,
) -> list[list[str]]:
    """Tokenise CSV text into records of string fields, one character at a time.

    A small state walk (in/out of a quoted field): an unquoted delimiter ends a
    field, an unquoted ``CR``/``LF``/``CRLF`` ends a record, and anything inside
    quotes — including delimiters and line breaks — is data. The quote character
    inside a quoted field is escaped either by *doubling* (``""``, the RFC 4180
    default) or, when ``escapechar`` is given, by a preceding ``escapechar``
    which strips the special meaning of whatever character follows it. Raises
    :class:`StrictCsvParseError` on a quote that never closes.
    """
    records: list[list[str]] = []
    fields: list[str] = []
    field: list[str] = []
    in_quotes = False
    field_started = False  # this record has begun a field (catches a trailing ,)
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if escapechar is not None and ch == escapechar:
            # The escapechar removes any special meaning from the next character
            # (quote, delimiter, line break, or the escapechar itself); a
            # trailing escapechar with nothing after it stays a literal.
            if i + 1 < n:
                field.append(text[i + 1])
                i += 2
            else:
                field.append(ch)
                i += 1
            field_started = True
            continue
        if in_quotes:
            if ch == quotechar:
                if escapechar is None and i + 1 < n and text[i + 1] == quotechar:
                    field.append(quotechar)  # doubled quote -> one literal quote
                    i += 2
                    continue
                in_quotes = False
                i += 1
                continue
            field.append(ch)
            i += 1
            continue
        if ch == quotechar:
            in_quotes = True
            field_started = True
            i += 1
            continue
        if ch == delimiter:
            fields.append("".join(field))
            field.clear()
            field_started = True
            i += 1
            continue
        if ch == "\r" or ch == "\n":
            if ch == "\r" and i + 1 < n and text[i + 1] == "\n":
                i += 2
            else:
                i += 1
            fields.append("".join(field))
            records.append(fields)
            fields = []
            field = []
            field_started = False
            continue
        field.append(ch)
        field_started = True
        i += 1
    if in_quotes:
        raise StrictCsvParseError(
            f"unterminated quoted field at end of input (record {len(records) + 1})"
        )
    # Flush a final record that had no trailing line break; a file that ends on a
    # line break leaves nothing pending, so no spurious empty record is emitted.
    if field or fields or field_started:
        fields.append("".join(field))
        records.append(fields)
    return records


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

```
