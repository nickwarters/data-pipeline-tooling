"""Writers persist datasets to destinations they own.

A Writer owns its target location and carries the load strategy. The pipeline
hands it the dataset and makes no write decisions of its own. *How* a strategy
loads is the strategy's own knowledge (``framework.io.strategy``), not a branch
here: a file Writer asks its strategy for the frame to write, and a SQLite
Writer is minted by the strategy in the first place.

What every Writer of a kind shares lives here once, so a Writer's own body is
only what makes it that Writer: the file Writers share ``_FileWriter`` and
supply a serialise/deserialise pair, and the SQLite Writers share the
connection lifetime (``_writing_connection``), the staging/commit/cleanup shape
of a merge (``_staged_merge``), and the delete-then-append that makes a
re-driven logical run idempotent (``_replace_logical_run``). The transaction
boundary is therefore stated once rather than re-derived per Writer.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

import pandas as pd

from framework._internal.connection import connect
from framework._internal.describe import render
from framework.core.dataset import Dataset
from framework.core.protocols import ChunkWritable, Writer
from framework.io.sql import quote_identifier
from framework.io.strategy import LoadStrategy

# ``Writer``/``ChunkWritable`` are imported only to be re-exported through
# ``framework.io``; listing them in ``__all__`` marks them as intentional public
# surface so lint won't strip them.
__all__ = [
    "Writer",
    "ChunkWritable",
    "writing_chunks",
    "supports_chunk_writes",
    "CsvWriter",
    "ExcelWriter",
    "JsonWriter",
    "StdoutWriter",
    "SqliteTruncateReloadWriter",
    "QuarantineWriter",
    "SqliteUpsertWriter",
    "AccumulateByRunWriter",
    "SqliteInsertOrIgnoreWriter",
    "SqliteInsertIfAbsentWriter",
    "MissingTableError",
]


class MissingTableError(LookupError):
    """A Writer was pointed at a table nothing has created yet.

    An infrastructure precondition, not a data fault: the rows were fine, the
    landing site was never built (see :func:`_require_table`). Named — rather
    than a bare ``LookupError`` — because callers have to tell it apart from an
    unrelated lookup failure: it is the one condition an operator fixes by
    running a command, and a rollout that gates on it (per-environment) must
    catch exactly this and nothing else. It stays a ``LookupError`` subclass so
    code already catching the broad builtin is unaffected.
    """


def _frame_for_strategy(
    writer: object,
    dataset: Dataset,
    strategy: LoadStrategy,
    read_existing: Callable[[], pd.DataFrame],
) -> pd.DataFrame:
    """Ask ``strategy`` for the whole frame this file Writer should write out.

    A file Writer rewrites its target wholesale, so the strategy is handed the
    incoming frame plus a way to read what is already there and returns the
    result. A strategy that cannot express itself that way — because its merge
    is SQL-side, or needs the target's key mapping — defines no
    ``apply_to_frame``, and the mismatch is reported here naming both the
    Writer and the strategy rather than silently falling off the end.
    """
    apply_to_frame = getattr(strategy, "apply_to_frame", None)
    if apply_to_frame is None:
        raise TypeError(
            f"{type(writer).__name__} cannot use the "
            f"{type(strategy).__name__} load strategy: it defines no "
            "apply_to_frame, so it is available only to table-backed Writers."
        )
    return apply_to_frame(dataset.to_pandas(), read_existing)


def supports_chunk_writes(writer: object) -> bool:
    """Whether ``writer`` can take one source's rows as a sequence of writes.

    The wire-time predicate behind the refusal below: a graph that streams a
    source can ask this before a byte is read, so an unusable pairing is a
    wiring error rather than a target quietly left holding only the last chunk.
    """
    return callable(getattr(writer, "writing_chunks", None))


def writing_chunks(writer: object):
    """Open ``writer``'s chunk-write session, or refuse by name.

    Returns the context manager the Writer opens for a chunked load — the one
    place a caller streaming chunks goes, so it never has to know which Writers
    replace their target and which append. A Writer that offers no such session
    raises here, naming itself and why, instead of silently doing its
    whole-dataset thing once per chunk.
    """
    if not supports_chunk_writes(writer):
        raise TypeError(
            f"{type(writer).__name__} cannot take a chunked load: it offers no "
            "writing_chunks session, so each chunk would be written as if it "
            "were the whole dataset — the target would end up holding only the "
            "last chunk. Land the source with a Writer that accumulates "
            "(AccumulateByRun, InsertOrIgnore, UpsertStrategy, InsertIfAbsent)."
        )
    return writer.writing_chunks()


class _AppendingChunkWriter:
    """A Writer that appends each chunk of an open chunk-write session.

    Held by the session rather than by the Writer so the Writer itself stays
    stateless: whatever must happen once per load has already happened when the
    session opened, and everything from here is an append.
    """

    def __init__(
        self,
        db_path: Path,
        table: str,
        busy_timeout_ms: int,
        prepare: Callable[[pd.DataFrame], pd.DataFrame] | None = None,
    ) -> None:
        self._db_path = db_path
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms
        self._prepare = prepare

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        if self._prepare is not None:
            frame = self._prepare(frame)
        with _writing_connection(self._db_path, self._busy_timeout_ms) as con:
            frame.to_sql(self._table, con, if_exists="append", index=False)


# Every merge Writer names its scratch table the same way. Earlier releases used
# a per-strategy prefix instead; those names are dropped alongside the current
# one during cleanup, so a scratch table stranded by a process killed mid-write
# under an older build is swept up rather than left on the share forever.
_STAGING_PREFIX = "_stage_"
_LEGACY_STAGING_PREFIXES = ("_upsert_stage_", "_insert_or_ignore_stage_")


@contextmanager
def _writing_connection(
    db_path: Path, busy_timeout_ms: int
) -> Iterator[sqlite3.Connection]:
    """Own one write's connection lifetime: mkdir, connect, commit, close.

    The body's statements run inside the single transaction SQLite opens for
    them, and the commit happens only when the body returns normally: a raising
    body leaves the transaction uncommitted and the close discards it, so a
    failed write never lands half of itself.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = connect(db_path, busy_timeout_ms)
    try:
        yield con
        con.commit()
    finally:
        con.close()


@dataclass(frozen=True)
class _StagedMerge:
    """What a merge statement needs: the connection and its quoted operands."""

    con: sqlite3.Connection
    staging: str
    target: str
    columns: str


@contextmanager
def _staged_merge(
    db_path: Path,
    table: str,
    frame: pd.DataFrame,
    *,
    busy_timeout_ms: int,
) -> Iterator[_StagedMerge]:
    """Own a merge's whole shape: staging, target, commit boundary, teardown.

    The incoming rows are landed in a scratch staging table so the merge is one
    set-based statement rather than a row-by-row loop; the target must already
    exist (a migration's job now, not this call's -- see ``_require_table``),
    so the statement always has something real to merge into rather than a
    bare table this write minted for itself. The caller supplies only its
    merge statement — the commit boundary and the cleanup are not theirs to
    get wrong.

    Staging is dropped *after* the commit, as it was when each Writer did this
    for itself: a failed merge leaves the scratch table behind rather than
    running further statements against a connection whose transaction is being
    discarded, and the next write replaces it wholesale anyway.
    """
    with _writing_connection(db_path, busy_timeout_ms) as con:
        staging = _STAGING_PREFIX + table

        # Checked before staging is written, not after: a refusal should leave
        # no scratch table behind, and pandas commits the staging write.
        _require_table(con, db_path, table)

        # Land the incoming rows in the scratch table. This is pandas' own
        # transaction, committed by the time the merge statement runs.
        frame.to_sql(staging, con, if_exists="replace", index=False)

        yield _StagedMerge(
            con=con,
            staging=quote_identifier(staging),
            target=quote_identifier(table),
            columns=", ".join(quote_identifier(c) for c in frame.columns),
        )

        con.commit()
        for name in (staging, *(prefix + table for prefix in _LEGACY_STAGING_PREFIXES)):
            con.execute(f"DROP TABLE IF EXISTS {quote_identifier(name)}")


def _table_exists(con: sqlite3.Connection, table: str) -> bool:
    """Whether ``table`` is present, probed without materialising any rows.

    A probe rather than a caught error: catching would also absorb an
    operational failure such as a locked database, and a delete that was
    skipped because the database was busy would silently turn a replace into
    an append.
    """
    rows = con.execute(f"PRAGMA table_info({quote_identifier(table)})").fetchall()
    return bool(rows)


def _require_table(con: sqlite3.Connection, db_path: Path, table: str) -> None:
    """Refuse to write into a table nothing has migrated into existence yet.

    Since ADR 0015 a table's shape is a migration's job, not a Writer's: a
    Writer that created one implicitly -- as ``if_exists="replace"`` /
    ``"append"`` used to, for ``Refresh`` and the merge strategies
    respectively -- would let a run silently paper over a missing migration,
    and for ``Refresh`` specifically would let the very next
    ``if_exists="replace"`` recreate a bare table, dropping whatever
    index/constraint a migration had put there while the migration's ledger
    row survives claiming it still applies. This module knows nothing of what
    a migration *is* -- it only learns "this table must already exist" -- so
    the error names the fix as text, not by importing the migrations machinery.

    The message names the table two ways, because only one of them is always
    right. ``<subject>/<layer>.db`` is the layout
    ``tools.store.DirectoryStoreBackend`` lays namespaces out in, so under it
    the subject and layer come straight off ``db_path`` itself rather than
    being guessed from the table name, and ``--subject`` narrows the fix to the
    one thing that needs migrating. A database *outside* that layout (a bare
    ``--database`` path, ``quarantine.db``) has no subject to name, so the
    message also carries the full path and the ``--database``/``--scope``
    form, which is correct either way. The environment stays a ``<env>``
    placeholder: a Writer knows its file, never which environment resolved it.
    """
    if _table_exists(con, table):
        return
    subject, layer = db_path.parent.name, db_path.stem
    raise MissingTableError(
        f"no migration has created '{subject}/{layer}.{table}' ({db_path});\n"
        f"run: python -m cli migrate --env <env> --subject {subject}\n"
        f"(a database outside the <subject>/<layer>.db layout instead takes: "
        f"python -m cli migrate --database {db_path} --scope <scope>)"
    )


def _insert_rows(con: sqlite3.Connection, table: str, frame: pd.DataFrame) -> None:
    """Append ``frame``'s rows into a table already confirmed to exist.

    Kept separate from ``_require_table`` so a full-refresh write reads as two
    named steps -- clear, then insert -- inside one transaction, rather than
    one ``to_sql(if_exists="replace")`` call that silently recreated the table
    underneath both.
    """
    frame.to_sql(table, con, if_exists="append", index=False)


def _replace_logical_run(
    con: sqlite3.Connection,
    table: str,
    logical_run_id: object,
    frame: pd.DataFrame,
) -> None:
    """Clear one logical run's prior rows from ``table``, then append ``frame``.

    The idempotency step every run-stamped sink needs: a re-driven logical run
    replaces only its own rows and never another run's. Both statements run in
    the caller's single transaction, so a failing append rolls the delete back
    and a failed re-drive never half-wipes what it was replacing. The delete is
    skipped only when the table does not exist yet — the first run for a feed.
    """
    if _table_exists(con, table):
        con.execute(
            f"DELETE FROM {quote_identifier(table)} WHERE logical_run_id = ?",
            (logical_run_id,),
        )
    frame.to_sql(table, con, if_exists="append", index=False)


class _FileWriter:
    """The shared body of the file Deliverable Writers.

    Every file Writer owns a target path plus a load strategy and differs only
    in how it serialises a frame to that path and reads one back. Subclasses
    supply that pair; the strategy application, the parent-directory creation
    and the "nothing there yet means an empty frame" rule live here once.

    An implementation detail of this module, not a base class Writers outside it
    are expected to inherit: the ``Writer`` contract stays structural, so any
    object with ``write(dataset)`` remains a Writer.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: LoadStrategy,
    ) -> None:
        self._path = Path(path)
        self._strategy = strategy

    def write(self, dataset: Dataset) -> None:
        frame = _frame_for_strategy(self, dataset, self._strategy, self._read_existing)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._serialise(frame)

    def _read_existing(self) -> pd.DataFrame:
        if not self._path.exists():
            return pd.DataFrame()
        return self._deserialise()

    def _serialise(self, frame: pd.DataFrame) -> None:
        """Write ``frame`` to this Writer's target, replacing what is there."""
        raise NotImplementedError

    def _deserialise(self) -> pd.DataFrame:
        """Read back what the target already holds (it is known to exist)."""
        raise NotImplementedError

    def describe(self) -> str:
        return render(self, path=str(self._path))


class CsvWriter(_FileWriter):
    """A file Deliverable Writer for CSV.

    Owns its target file and load strategy. ``Refresh`` overwrites the file with
    the current dataset; ``AccumulateByRun`` rewrites the file after replacing
    only that logical run's stamped rows; ``InsertOrIgnore`` appends incoming
    rows to the existing file (files carry no constraints, so no rows are
    ignored — equivalent to a plain append).
    """

    def _serialise(self, frame: pd.DataFrame) -> None:
        frame.to_csv(self._path, index=False, lineterminator="\n")

    def _deserialise(self) -> pd.DataFrame:
        return pd.read_csv(self._path)


class ExcelWriter(_FileWriter):
    """A file Deliverable Writer for one Excel worksheet."""

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: LoadStrategy,
        sheet: str = "Sheet1",
    ) -> None:
        super().__init__(path, strategy)
        self._sheet = sheet

    def _serialise(self, frame: pd.DataFrame) -> None:
        with pd.ExcelWriter(self._path) as writer:
            frame.to_excel(writer, sheet_name=self._sheet, index=False)

    def _deserialise(self) -> pd.DataFrame:
        return pd.read_excel(self._path, sheet_name=self._sheet)

    def describe(self) -> str:
        return render(self, path=str(self._path), sheet=self._sheet)


class JsonWriter(_FileWriter):
    """A file Deliverable Writer for JSON record arrays."""

    def _serialise(self, frame: pd.DataFrame) -> None:
        frame.to_json(
            self._path,
            orient="records",
            date_format="iso",
            indent=2,
            force_ascii=False,
        )

    def _deserialise(self) -> pd.DataFrame:
        return pd.read_json(self._path, orient="records")


class StdoutWriter:
    """A Writer that prints the dataset to the console instead of persisting it.

    Owns neither a target location nor a load strategy — it is a terminal sink for
    *seeing* a result rather than storing one, e.g. printing a Selection
    explainer's per-Case trace while developing or driving a feed by hand. Each
    ``write`` renders the whole dataset as a plain-text table (column headers +
    rows) to the stream, which defaults to ``sys.stdout`` (resolved per call, so
    test capture and redirection both work) but can be pointed at any text stream.

    An optional ``label`` is printed above the table to caption what is being
    shown when several datasets land on the same console.
    """

    def __init__(
        self, label: str | None = None, *, stream: TextIO | None = None
    ) -> None:
        self._label = label
        self._stream = stream

    def write(self, dataset: Dataset) -> None:
        stream = self._stream if self._stream is not None else sys.stdout
        if self._label:
            print(self._label, file=stream)
        print(dataset.to_pandas().to_string(index=False), file=stream)

    def describe(self) -> str:
        return render(self, label=self._label)


class SqliteTruncateReloadWriter:
    """A Writer that full-refreshes one table: truncate + reload.

    Truncates rather than recreates: the table must already exist (a
    migration's job now — see ``_require_table``), and the delete + insert both
    run inside the one transaction ``_writing_connection`` opens, so a failed
    reload leaves the table's prior contents intact rather than dropped. Before
    #323, ``if_exists="replace"`` dropped and recreated the table on every run,
    which quietly erased any index or constraint a migration had put there
    while its ledger row still claimed it applied.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        with _writing_connection(self._db_path, self._busy_timeout_ms) as con:
            _require_table(con, self._db_path, self._table)
            con.execute(f"DELETE FROM {quote_identifier(self._table)}")
            _insert_rows(con, self._table, dataset.to_pandas())

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)


class QuarantineWriter:
    """A Writer for the quarantine reject table.

    Owns its target location (db_path + table). The pipeline stamps
    ``logical_run_id`` and ``load_date`` on the rejected dataset before calling
    ``write()``, so this writer just does the idempotent delete-by-logical-run +
    append that lets a re-driven run replace only its own prior rejects without
    touching other runs.

    Unlike ``AccumulateByRunWriter``, this writer does NOT stamp ``logical_run_id``
    or ``load_date`` — those come from the dataset (added by the pipeline at
    quarantine time). The ``failed_rule`` column also arrives pre-stamped by the
    partitioner.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        with _writing_connection(self._db_path, self._busy_timeout_ms) as con:
            if "logical_run_id" in frame.columns:
                _replace_logical_run(
                    con, self._table, frame["logical_run_id"].iloc[0], frame
                )
            else:
                # Nothing identifies the run to replace, so the rejects are
                # appended as they arrive.
                frame.to_sql(self._table, con, if_exists="append", index=False)

    @contextmanager
    def writing_chunks(self) -> Iterator[Writer]:
        """Take one source's rejects across many chunks as one logical run.

        Same hazard as the accumulating Writer: the delete-by-logical-run that
        makes a re-drive idempotent must not repeat per chunk, or the last
        chunk's rejects would be all that survive. The run to clear is named by
        the rejects themselves, which are only known once some arrive, so the
        clear happens with the first chunk that has any and every chunk after it
        appends. A run that rejects nothing writes nothing and clears nothing —
        exactly what a whole-dataset quarantine of the same run does.
        """
        yield _QuarantineChunkWriter(self)

    def _append(self, frame: pd.DataFrame) -> None:
        with _writing_connection(self._db_path, self._busy_timeout_ms) as con:
            frame.to_sql(self._table, con, if_exists="append", index=False)

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)


class _QuarantineChunkWriter:
    """Clear the logical run's prior rejects with the first chunk, then append."""

    def __init__(self, inner: "QuarantineWriter") -> None:
        self._inner = inner
        self._cleared = False

    def write(self, dataset: Dataset) -> None:
        if not self._cleared:
            self._inner.write(dataset)
            self._cleared = True
            return
        self._inner._append(dataset.to_pandas())


class SqliteUpsertWriter:
    """A Writer that merges incoming rows by a declared key set.

    Uses a SQL-native DELETE + INSERT via a scratch staging table — no full
    table read. Only the rows being replaced are touched:

    1. Incoming rows are written to a per-table scratch staging table (DDL,
       auto-committed per SQLite's default isolation).
    2. Target rows whose key appears in staging are deleted (O(incoming)).
    3. All staging rows are inserted into the target (O(incoming)).
    4. Steps 2–3 commit atomically; a failure rolls back, leaving prior state.
    5. Staging table is dropped as post-commit cleanup.

    Steps 1 and 3–5 are the shared staged-merge shape; this Writer contributes
    only the two statements in between.

    Target rows whose key does NOT appear in the incoming batch are never
    read or written.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        key_columns: tuple[str, ...],
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._key_columns = key_columns
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        missing = [c for c in self._key_columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"UpsertStrategy key column(s) not found in dataset: {missing}"
            )
        with _staged_merge(
            self._db_path,
            self._table,
            frame,
            busy_timeout_ms=self._busy_timeout_ms,
        ) as merge:
            # Delete the matching rows, then insert all incoming ones. The
            # EXISTS join handles composite keys without row-value syntax.
            key_match = " AND ".join(
                f"{merge.staging}.{quote_identifier(k)} = "
                f"{merge.target}.{quote_identifier(k)}"
                for k in self._key_columns
            )
            merge.con.execute(
                f"DELETE FROM {merge.target} WHERE EXISTS "
                f"(SELECT 1 FROM {merge.staging} WHERE {key_match})"
            )
            merge.con.execute(
                f"INSERT INTO {merge.target} ({merge.columns}) "
                f"SELECT {merge.columns} FROM {merge.staging}"
            )

    @contextmanager
    def writing_chunks(self) -> Iterator[Writer]:
        """Take a chunked load unchanged: each merge is already independent.

        A merge by key touches only the keys it was handed, so running it once
        per chunk lands the same rows a single whole-dataset merge would (two
        chunks carrying the same key resolve last-write-wins, exactly as two
        rows with that key inside one dataset would). Nothing has to happen once
        per load, so the session is the Writer itself.
        """
        yield self

    def describe(self) -> str:
        return render(
            self,
            db_path=str(self._db_path),
            table=self._table,
            key_columns=list(self._key_columns),
        )


class SqliteInsertOrIgnoreWriter:
    """A Writer that appends new rows and silently skips conflicting ones.

    Uses SQLite's ``INSERT OR IGNORE`` so any row that would violate an
    existing constraint (PRIMARY KEY, UNIQUE, NOT NULL, CHECK) on the target
    table is discarded without raising an error.  Rows that do not conflict are
    appended.  Target rows absent from the incoming batch are never touched.

    When the target table carries no constraints every incoming row is appended,
    which is equivalent to a plain append.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        with _staged_merge(
            self._db_path,
            self._table,
            frame,
            busy_timeout_ms=self._busy_timeout_ms,
        ) as merge:
            merge.con.execute(
                f"INSERT OR IGNORE INTO {merge.target} ({merge.columns}) "
                f"SELECT {merge.columns} FROM {merge.staging}"
            )

    @contextmanager
    def writing_chunks(self) -> Iterator[Writer]:
        """Take a chunked load unchanged: appending is already per-batch.

        Nothing in the target is replaced, so chunk N+1 appends beside chunk N
        and the target's own constraints resolve conflicts the same way whether
        the rows arrived in one batch or fifty. Nothing has to happen once per
        load, so the session is the Writer itself.
        """
        yield self

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)


class SqliteInsertIfAbsentWriter:
    """A Writer that inserts new keys only and mints compact integer surrogates.

    On each write:
    1. Read the existing key→surrogate mapping from the target (empty on first run).
    2. Filter incoming rows to those whose key is not already present.
    3. Deduplicate on key within the batch.
    4. Mint compact integer surrogates (max_existing_id + 1, +2, …) for new keys.
    5. Append only the new rows (with surrogates) in a single atomic commit.

    Existing rows are never modified or deleted.  Re-running the same input is a
    no-op and leaves all surrogate assignments unchanged — the reference table is
    a stable system of record across re-runs.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        key_columns: tuple[str, ...],
        surrogate_column: str = "id",
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._key_columns = key_columns
        self._surrogate_column = surrogate_column
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        missing = [c for c in self._key_columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"InsertIfAbsent key column(s) not found in dataset: {missing}"
            )

        with _writing_connection(self._db_path, self._busy_timeout_ms) as con:
            # Read the existing key→surrogate mapping. A table that is not there
            # yet (the first run for this reference set) means no mapping;
            # anything else that goes wrong reading it is a real failure and is
            # left to propagate, since treating it as "no mapping" would remint
            # surrogates that already exist.
            surr_q = quote_identifier(self._surrogate_column)
            key_cols_sql = ", ".join(quote_identifier(k) for k in self._key_columns)
            if _table_exists(con, self._table):
                existing = pd.read_sql(
                    f"SELECT {surr_q}, {key_cols_sql} "
                    f"FROM {quote_identifier(self._table)}",
                    con,
                )
            else:
                existing = pd.DataFrame(
                    columns=[self._surrogate_column, *self._key_columns]
                )

            # Identify rows whose key is not already in the target.
            if len(existing) > 0:
                existing_keys = existing[list(self._key_columns)]
                merged = frame.merge(
                    existing_keys,
                    on=list(self._key_columns),
                    how="left",
                    indicator=True,
                )
                new_rows = (
                    merged[merged["_merge"] == "left_only"]
                    .drop(columns=["_merge"])
                    .reset_index(drop=True)
                )
            else:
                new_rows = frame.copy()

            # Deduplicate on key within the batch (a key must receive exactly one id).
            new_rows = new_rows.drop_duplicates(subset=list(self._key_columns))
            new_rows = new_rows.reset_index(drop=True)

            if len(new_rows) == 0:
                return

            # Mint surrogates above the store seam, not via SQLite AUTOINCREMENT.
            max_id = (
                int(existing[self._surrogate_column].max()) if len(existing) > 0 else 0
            )
            new_rows.insert(
                0, self._surrogate_column, range(max_id + 1, max_id + 1 + len(new_rows))
            )

            new_rows.to_sql(self._table, con, if_exists="append", index=False)

    @contextmanager
    def writing_chunks(self) -> Iterator[Writer]:
        """Take a chunked load unchanged: each batch reads the live mapping.

        Every write re-reads the target's key→surrogate mapping before minting,
        so chunk N+1 sees the keys chunk N just inserted and continues the
        surrogate sequence rather than reminting from zero. Nothing has to
        happen once per load, so the session is the Writer itself.
        """
        yield self

    def describe(self) -> str:
        return render(
            self,
            db_path=str(self._db_path),
            table=self._table,
            key_columns=list(self._key_columns),
            surrogate_column=self._surrogate_column,
        )


class AccumulateByRunWriter:
    """A Writer that accumulates runs into one table, stamped by run.

    Owns its target location (a single layer db file + table). Used for the gold
    layer (the accumulating SelectionPool / Review Outcomes), whose history must
    survive across runs. Each row is stamped with the ``logical_run_id`` /
    ``load_date`` plus ``pipeline_run_id`` when the strategy was derived from a
    RunContext. A re-driven logical run is idempotent via delete-by-logical-run
    then insert.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        logical_run_id: str,
        load_date: str,
        pipeline_run_id: str | None = None,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._logical_run_id = logical_run_id
        self._load_date = load_date
        self._pipeline_run_id = pipeline_run_id
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        frame = self._stamp(dataset.to_pandas())
        with _writing_connection(self._db_path, self._busy_timeout_ms) as con:
            _replace_logical_run(con, self._table, self._logical_run_id, frame)

    @contextmanager
    def writing_chunks(self) -> Iterator[Writer]:
        """Land many chunks as one logical run: clear the run once, then append.

        The delete that makes a re-driven run idempotent belongs to the *run*,
        not to each write. Repeating it per chunk would delete the chunks this
        very run had already landed, leaving only the last one — the reason a
        chunked load has to be a session rather than a loop over ``write``. So
        the clear happens once, when the session opens, and every chunk after it
        appends. Opening the session with no chunks to follow is therefore still
        a correct re-drive of a run that now yields nothing.

        The clear commits on entry rather than sharing the chunks' transaction:
        the whole point of streaming is that the rows are never all in hand at
        once, so there is no single transaction to hold them. A stream that
        aborts part-way leaves this run partially landed, which the next drive
        of the same logical run replaces wholesale.
        """
        with _writing_connection(self._db_path, self._busy_timeout_ms) as con:
            if _table_exists(con, self._table):
                con.execute(
                    f"DELETE FROM {quote_identifier(self._table)} "
                    "WHERE logical_run_id = ?",
                    (self._logical_run_id,),
                )
        yield _AppendingChunkWriter(
            self._db_path, self._table, self._busy_timeout_ms, prepare=self._stamp
        )

    def _stamp(self, frame: pd.DataFrame) -> pd.DataFrame:
        """Stamp this run's identity onto ``frame`` in place and return it."""
        frame["logical_run_id"] = self._logical_run_id
        if self._pipeline_run_id is not None:
            frame["pipeline_run_id"] = self._pipeline_run_id
        frame["load_date"] = self._load_date
        return frame

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)
