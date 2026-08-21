```python
"""Readers encapsulate source IO behind ``read() -> Dataset``.

The concrete engine lives inside readers and behind the Dataset seam, never in
the protocol signature.
"""

from __future__ import annotations

import math
import os
import re
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path

import pandas as pd

from framework._internal.connection import connect
from framework._internal.describe import component_summary, render
from framework._internal.locations import file_location, table_location
from framework.core.dataset import Dataset
from framework.core.protocols import DEFAULT_CHUNK_SIZE, ChunkReader, Reader
from framework.io.sql import quote_identifier

# ``Reader``/``ChunkReader`` are imported only to be re-exported through
# ``framework.io``; listing them in ``__all__`` marks them as intentional public
# surface so lint won't strip them.
__all__ = [
    "Reader",
    "ChunkReader",
    "DEFAULT_CHUNK_SIZE",
    "DatasetReader",
    "CsvReader",
    "StrictCsvReader",
    "StrictCsvParseError",
    "GlobCsvReader",
    "ChunkedCsvReader",
    "SasFileReader",
    "ExcelReader",
    "SqliteReader",
    "ChunkFilter",
    "PredicateChunkReader",
    "KeyFilterChunkReader",
]

# A per-chunk row filter: takes one bounded chunk and returns the rows to keep
# (a new, possibly-empty :class:`Dataset`). Applied *before* anything downstream
# accumulates, so both memory and the landed table stay bounded.
ChunkFilter = Callable[[Dataset], Dataset]


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
    """Read a CSV feed from a local file into a Dataset.

    ``dtype=str`` lands *every* column as text — the shared rule for the
    pandas-backed CSV readers here. Read-time inference is a guess made over the
    first rows of one file, and it is lossy in ways coercion cannot undo
    afterwards: a digits-only reference read as ``int64`` has already lost its
    leading zeros by the time anything downstream sees it. What a value *is* is
    the declared schema's answer, given at silver by ``SchemaCoercion``.

    ``keep_default_na``/``na_values`` stay at their defaults, so a blank field is
    still a **gap** (NaN) rather than the empty string — whether a gap is allowed
    is ``NonNull()``'s question, not the reader's.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        columns: list[str] | None = None,
    ) -> None:
        self._path = Path(path)
        self._columns = columns
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        self.data_locations = [file_location(self._path)]
        kwargs: dict = {}
        if self._columns is not None:
            kwargs["usecols"] = self._columns
        return Dataset.from_pandas(pd.read_csv(self._path, dtype=str, **kwargs))

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
    - Values are landed as **text**, as they are from the pandas-backed CSV
      readers: the job here is faithful tokenisation, leaving dtype decisions to
      silver coercion (``SchemaCoercion``). Where this reader *does* still
      differ is the blank: an empty field is the empty string ``""`` (a
      doubled-quote empty field ``""`` likewise), because the grammar says a
      field was present and empty, where the pandas readers land it as a gap.

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
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        self.data_locations = [file_location(self._path)]
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


class ChunkedCsvReader:
    """Stream a local CSV file as a sequence of bounded Datasets.

    The streaming counterpart of :class:`CsvReader` for a source too large to
    hold whole: ``chunks(size)`` yields a lazy iterator of bounded
    :class:`Dataset`s (pandas ``read_csv(chunksize=…)`` behind the seam), so the
    in-memory contract holds *per chunk* and memory never tracks the whole file.
    Pass ``columns=[...]`` to project each chunk to just the columns the caller
    needs (pandas ``usecols``), kept in the requested order. A source with no
    data rows (including a header-only file) streams as **zero** chunks.

    Like :class:`CsvReader` every column lands as text, which matters more here
    than anywhere: inference is per chunk, so a column whose first blank or
    non-numeric value appears late would otherwise land as ``int64`` in one
    chunk and text in the next — and the chunks are written separately.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        columns: list[str] | None = None,
        *,
        encoding: str | None = None,
    ) -> None:
        self._path = Path(path)
        self._columns = columns
        self._encoding = encoding
        self.data_locations: list[dict[str, str]] = []

    def chunks(self, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Dataset]:
        if size < 1:
            raise ValueError("chunk size must be a positive integer")
        # The generator body runs on the first next(), so this is set before any
        # chunk reaches the node that drains it — and before an empty file bails.
        self.data_locations = [file_location(self._path)]
        kwargs: dict = {"chunksize": size}
        if self._columns is not None:
            kwargs["usecols"] = self._columns
        if self._encoding is not None:
            kwargs["encoding"] = self._encoding
        try:
            reader = pd.read_csv(self._path, dtype=str, **kwargs)
        except pd.errors.EmptyDataError:
            return  # a wholly empty file streams as zero chunks
        with reader:
            for frame in reader:
                if len(frame) == 0:
                    continue  # header-only/exhausted boundary -> no chunk
                if self._columns is not None:
                    frame = frame[self._columns]  # restore requested order
                yield Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(
            self,
            path=str(self._path),
            columns=self._columns,
            encoding=self._encoding,
        )


# Compression suffixes pandas decompresses transparently; stripped before
# inferring the SAS format so a real feed landed as ``extract.sas7bdat.gz`` is
# recognised as sas7bdat (pandas reads the gzip on the fly).
_COMPRESSION_SUFFIXES = {".gz", ".bz2", ".zip", ".xz", ".zst"}


def _infer_sas_format(path: Path) -> str:
    """Infer the SAS on-disk format (``"sas7bdat"`` or ``"xport"``) from a path.

    Any trailing compression suffix is ignored and the SAS extension beneath it
    decides the format, so ``extract.sas7bdat.gz`` infers ``"sas7bdat"`` and
    ``extract.xpt.gz`` infers ``"xport"``. Raises :class:`ValueError` naming the
    file when the extension is neither, so the caller passes ``format=`` instead.
    """
    suffixes = [s.lower() for s in path.suffixes]
    if suffixes and suffixes[-1] in _COMPRESSION_SUFFIXES:
        suffixes = suffixes[:-1]
    ext = suffixes[-1] if suffixes else ""
    if ext == ".sas7bdat":
        return "sas7bdat"
    if ext in (".xpt", ".xport"):
        return "xport"
    raise ValueError(
        f"cannot infer SAS format from {path.name!r}; "
        "pass format='sas7bdat' or format='xport'"
    )


class SasFileReader:
    """Stream an already-landed SAS-format file as bounded Datasets.

    Reads a ``.sas7bdat`` / xport file that is **already sitting on local disk**
    via pandas ``read_sas(chunksize=…)``, yielding a lazy iterator of bounded
    :class:`Dataset`s. Gzip-compressed extracts (``extract.sas7bdat.gz``) are
    read on the fly — pandas infers the compression from the extension.

    This is deliberately **not** the ``SasReader``: it runs no SAS
    script, does no remote execution, and copies no file — it only *reads* a
    landed file. The two are complementary (``SasReader`` lands a file from a
    remote SAS host; this streams one once it is there) and the distinct name
    keeps them from being confused.

    The format (sas7bdat vs xport) is inferred from the extension — ignoring any
    trailing ``.gz``/compression suffix — unless ``format=`` is passed. Reading
    sas7bdat/xport needs no extra dependency (pandas' SAS reader is pure-Python),
    so it is first-class on Windows and macOS alike. Pass ``columns=[...]`` to
    keep each chunk narrow; the projection is applied per chunk (``read_sas``
    has no ``usecols``) so memory still stays bounded. A source with no rows
    streams as **zero** chunks.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        columns: list[str] | None = None,
        *,
        format: str | None = None,
        encoding: str | None = None,
    ) -> None:
        self._path = Path(path)
        self._columns = columns
        self._format = format if format is not None else _infer_sas_format(self._path)
        self._encoding = encoding
        self.data_locations: list[dict[str, str]] = []

    def chunks(self, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Dataset]:
        if size < 1:
            raise ValueError("chunk size must be a positive integer")
        self.data_locations = [file_location(self._path)]
        kwargs: dict = {"format": self._format, "chunksize": size}
        if self._encoding is not None:
            kwargs["encoding"] = self._encoding
        # compression="infer" (pandas default) reads a gzipped extract on the fly.
        with pd.read_sas(self._path, **kwargs) as reader:
            for frame in reader:
                if len(frame) == 0:
                    continue  # exhausted boundary -> no chunk
                if self._columns is not None:
                    missing = [c for c in self._columns if c not in frame.columns]
                    if missing:
                        raise ValueError(
                            f"{self._path}: requested columns not in source: {missing}"
                        )
                    frame = frame[self._columns]
                yield Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(
            self,
            path=str(self._path),
            format=self._format,
            columns=self._columns,
            encoding=self._encoding,
        )


# The spellings a source plausibly uses for one numeric id: optional sign,
# ASCII digits, optional fractional part -- so a trailing ``123.`` and a signed
# ``+123`` read as the integer too. ``1e3``, ``1_000``, ``nan`` and non-ASCII
# digits merely look numeric to ``int()``/``float()`` and are compared as the
# text they are. The digit bound is CPython's own limit on int/str conversion:
# beyond it ``int()`` raises, and no real id is that long.
_NUMERIC_TEXT = re.compile(r"[+-]?[0-9]{1,4300}(?:\.[0-9]*)?")


def _normalize_key(value: object) -> str | None:
    """Coerce one key to a canonical string so membership is type-agnostic.

    The same logical id reaches us as different Python types depending on the
    source: a SAS numeric id streams in as a float (``3.0``) while the same id in
    our allow-list is often an ``int`` (``3``); a SAS character id streams in as
    space-padded ``bytes`` (``b'A   '``) while the allow-list holds a ``str``
    (``"A"``); a CSV id arrives as the text the file holds (``"00123"``,
    ``"123.0"``) while the allow-list holds an ``int`` (``123``). Both the
    allow-list and every chunk's key column run through here before comparison,
    so ``3.0`` matches ``3``, ``b'A  '`` matches ``"A"`` and ``"00123"`` matches
    ``123`` rather than the mismatch silently dropping every row. A missing key
    (``None``/``NaN``) normalises to ``None`` and never matches.

    Numeric-looking *text* is read as the number it denotes for the same reason
    a float is: this decides membership only, never what a chunk lands, so an id
    is compared by what it means rather than by how its source spelled it. Note
    the asymmetry that buys: ``"00123"`` matches an allow-list ``123``, the
    opposite of the rule the readers hold everywhere else, where a leading zero
    is part of the reference and is preserved. It is the right way round here
    because the allow-list is *typed* Python values while the chunk is whatever
    its source spelled, and only the comparison is at stake — no landed value is
    rewritten.
    """
    if value is None:
        return None
    if isinstance(value, bytes):
        # SAS character columns arrive as fixed-width, space-padded bytes.
        value = value.decode("utf-8", errors="replace")
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return _normalize_number(value)
    if isinstance(value, int):
        return str(value)
    text = str(value).strip()
    if not _NUMERIC_TEXT.fullmatch(text):
        return text
    whole, _, fraction = text.partition(".")
    # Exact integer arithmetic for the whole part: float64 would collide two
    # 19-digit references that differ in their last digit. A genuine fraction
    # still goes through float64 and keeps that limit -- an id with one is a
    # measurement, not a reference.
    if fraction.strip("0"):
        return _normalize_number(float(text))
    return str(int(whole))


def _normalize_number(value: float) -> str | None:
    """Canonicalise one numeric key: ``NaN`` is missing, ``3.0`` is ``"3"``.

    This repeats the float arm of ``framework._internal.identity.canonical_text``
    deliberately. That one is a frozen on-disk encoding; sharing the code would
    mean a change to how an identity is written silently re-keys which rows a
    filter keeps.
    """
    if math.isnan(value):
        return None
    # An integral float is the same id as the int: 3.0 -> "3", not "3.0".
    if value.is_integer():
        return str(int(value))
    return repr(value)


class PredicateChunkReader:
    """Wrap any :class:`ChunkReader`, applying a row filter to each chunk.

    The composable filtering seam for the ``ChunkReader`` family: it streams the
    ``inner`` reader and hands each bounded chunk to ``predicate``, yielding only
    the rows the predicate keeps. Because the filter runs **per chunk, before
    anything downstream concatenates**, a source far too large to materialise
    whole can be narrowed to the rows of interest with memory still bounded by a
    single chunk — and the landed table bounded by the result, not the source.

    A chunk the predicate empties is skipped, consistent with the zero-row-chunk
    behaviour of the underlying readers, so a fully-filtered chunk yields nothing
    rather than an empty Dataset. ``rows_scanned`` / ``rows_kept`` tally the
    filter's effect for the most recent ``chunks()`` pass, so a run can report
    how much of the source it actually needed. The wrapper holds the readers
    single-purpose and composes with ``ChunkedCsvReader`` / ``SasFileReader`` /
    any future chunk reader; :class:`KeyFilterChunkReader` is the common
    id-allow-list case built on top of it.
    """

    def __init__(self, inner: ChunkReader, predicate: ChunkFilter) -> None:
        self._inner = inner
        self._predicate = predicate
        self._rows_scanned = 0
        self._rows_kept = 0

    def chunks(self, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Dataset]:
        # Fresh tallies per pass: each chunks() call is one streaming read.
        self._rows_scanned = 0
        self._rows_kept = 0
        for chunk in self._inner.chunks(size):
            self._rows_scanned += len(chunk)
            kept = self._predicate(chunk)
            if len(kept) == 0:
                continue  # nothing matched in this chunk -> no chunk
            self._rows_kept += len(kept)
            yield kept

    @property
    def rows_scanned(self) -> int:
        """Rows read from the source across the most recent ``chunks()`` pass."""
        return self._rows_scanned

    @property
    def rows_kept(self) -> int:
        """Rows the filter kept across the most recent ``chunks()`` pass."""
        return self._rows_kept

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return getattr(self._inner, "data_locations", [])

    def describe(self) -> str:
        return render(self, inner=component_summary(self._inner))


class KeyFilterChunkReader:
    """Keep only the chunk rows whose key is in a known allow-list (semi-join).

    The headline filter for the "100M-row source, <100K rows we actually want"
    case: ``allowed_keys`` is the set of ids-of-interest (e.g. the natural keys /
    CasePool we already track), capped at ~100K so it fits trivially in memory as
    a set for a per-chunk membership test. Each chunk is narrowed to the rows
    whose ``key_column`` is in that set **before accumulation**, so a 100M-row
    source with a 100K allow-list lands ~100K rows with memory bounded by a
    single chunk.

    The allow-list may grow run-over-run but stays an in-memory set bounded by
    that ~100K cap; pass the current set in at construction each run. Keys are
    normalised on both sides (see :func:`_normalize_key`) so a SAS numeric id
    (``3.0``) matches an ``int`` allow-list entry (``3``) and a space-padded
    ``bytes`` id matches a ``str`` entry, instead of a type mismatch silently
    dropping every row. ``rows_scanned`` / ``rows_kept`` expose the filter's
    effect for the most recent pass.

    Built on :class:`PredicateChunkReader`, so it composes over any
    ``ChunkReader`` (``ChunkedCsvReader`` / ``SasFileReader`` / future readers).
    """

    def __init__(
        self,
        inner: ChunkReader,
        key_column: str,
        allowed_keys: Iterable[object],
    ) -> None:
        self._inner = inner
        self._key_column = key_column
        # Normalise once at construction; drop missing keys (they never match).
        self._allowed = frozenset(
            key for key in map(_normalize_key, allowed_keys) if key is not None
        )
        self._filter = PredicateChunkReader(inner, self._keep)

    def _keep(self, chunk: Dataset) -> Dataset:
        frame = chunk.to_pandas(copy=False)
        if self._key_column not in frame.columns:
            raise ValueError(
                f"key column {self._key_column!r} not in chunk columns: "
                f"{list(frame.columns)}"
            )
        # Normalise the key column the same way the allow-list was normalised so
        # the membership test is type-agnostic. The map is the unavoidable
        # per-row scan cost; the *output* stays bounded by the allow-list.
        keys = frame[self._key_column].map(_normalize_key)
        return Dataset.from_pandas(frame[keys.isin(self._allowed)])

    def chunks(self, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Dataset]:
        return self._filter.chunks(size)

    @property
    def rows_scanned(self) -> int:
        """Rows read from the source across the most recent ``chunks()`` pass."""
        return self._filter.rows_scanned

    @property
    def rows_kept(self) -> int:
        """Rows kept (allow-list hits) across the most recent ``chunks()`` pass."""
        return self._filter.rows_kept

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._filter.data_locations

    def describe(self) -> str:
        return render(
            self,
            inner=component_summary(self._inner),
            key_column=self._key_column,
            allowed_keys=len(self._allowed),
        )


class GlobCsvReader:
    """Read many local CSV files that together form one logical feed snapshot.

    Every column lands as text, so the parts agree by construction: two files
    inferred independently could otherwise contribute an ``int64`` column and a
    text one to the same concatenation.
    """

    def __init__(
        self,
        directory: str | os.PathLike[str],
        pattern: str,
        columns: list[str] | None = None,
    ) -> None:
        self._directory = Path(directory)
        self._pattern = pattern
        self._columns = columns
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        paths = sorted(self._directory.glob(self._pattern))
        if not paths:
            raise FileNotFoundError(
                f"No files match {self._pattern!r} in directory {self._directory}"
            )
        self.data_locations = [file_location(path) for path in paths]
        kwargs: dict = {}
        if self._columns is not None:
            kwargs["usecols"] = self._columns
        frame = pd.concat(
            [pd.read_csv(path, dtype=str, **kwargs) for path in paths],
            ignore_index=True,
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
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        # The file is the location; the sheet is a projection within it, the
        # same way a column projection is not recorded.
        self.data_locations = [file_location(self._path)]
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
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        self.data_locations = [table_location(self._db_path, self._table)]
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
