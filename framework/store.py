"""The medallion store — scoped to one subject, mints that subject's Writers
and Readers.

A ``Store`` is the mouth of one **subject**'s medallion (a Case Type or a shared
Reference Data set — ADR-0001 amendment): its three SQLite files
``<subject_dir>/{raw,silver,gold}.db``, isolated from every other subject's
files. The store holds **no** business logic and makes **no** load decisions
(ADR-0002, ADR-0003 amendment); it maps ``layer → location`` only and the
caller supplies an explicit load strategy:

- ``store.writer(layer, table, strategy)`` — mints the Writer over the
  subject's layer file, wired to the caller-supplied :class:`~framework.strategy.Refresh`
  or :class:`~framework.strategy.AccumulateByRun` strategy (ADR-0006 amendment).
- ``store.reader(layer, table)`` — a Reader over the same file.

The minted Writers/Readers each open through the shared ``connect`` factory in
``framework.connection`` — the single place connections are configured
(ADR-0001) and the seam that keeps ``store`` and ``writers`` from importing each
other in a cycle.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from framework.connection import connect
from framework.layers import GOLD, RAW, SILVER, Layer, layer_name
from framework.readers import Reader, SqliteReader
from framework.strategy import AccumulateByRun, Refresh, UpsertStrategy
from framework.writers import (
    AccumulateByRunWriter,
    SqliteUpsertWriter,
    SqliteTruncateReloadWriter,
    Writer,
)


class StoreBackend(Protocol):
    """Maps a catalog root and subject name to that subject's store directory."""

    def subject_dir(
        self, root: Path, subject: str | os.PathLike[str]
    ) -> str | os.PathLike[str]:
        """Return the concrete directory for one subject's medallion."""
        ...


class DirectoryStoreBackend:
    """Filesystem backend using ``<root>/<subject>`` medallion directories."""

    def subject_dir(
        self, root: Path, subject: str | os.PathLike[str]
    ) -> str | os.PathLike[str]:
        return root / Path(subject)


class Store:
    """One subject's medallion: maps layer→location; mints Writers/Readers."""

    def __init__(
        self, subject_dir: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._subject_dir = Path(subject_dir)
        self._busy_timeout_ms = busy_timeout_ms

    def _db_path(self, layer: Layer | str) -> Path:
        return self._subject_dir / f"{layer_name(layer)}.db"

    def writer(
        self,
        layer: Layer | str,
        table: str,
        strategy: Refresh | AccumulateByRun | UpsertStrategy,
    ) -> Writer:
        """Mint a Writer over the subject's layer file with the given strategy.

        The Store resolves only *which* ``<subject>/<layer>.db`` the Writer
        targets; the caller declares *how* data is loaded via ``strategy``
        (:class:`~framework.strategy.Refresh` for truncate+reload,
        :class:`~framework.strategy.AccumulateByRun` for accumulate-by-run,
        :class:`~framework.strategy.UpsertStrategy` for update-or-insert —
        ADR-0006 amendment). Two feeds may land in the same layer with different
        strategies.
        """
        db_path = self._db_path(layer)
        if isinstance(strategy, Refresh):
            return SqliteTruncateReloadWriter(
                db_path, table, busy_timeout_ms=self._busy_timeout_ms
            )
        if isinstance(strategy, AccumulateByRun):
            return AccumulateByRunWriter(
                db_path,
                table,
                strategy.run_id,
                strategy.load_date,
                execution_id=strategy.execution_id,
                busy_timeout_ms=self._busy_timeout_ms,
            )
        if isinstance(strategy, UpsertStrategy):
            return SqliteUpsertWriter(
                db_path,
                table,
                strategy.key_columns,
                busy_timeout_ms=self._busy_timeout_ms,
            )
        raise TypeError(f"unknown strategy {strategy!r}")

    def reader(self, layer: Layer | str, table: str) -> Reader:
        """Mint a Reader over the subject's layer file."""
        return SqliteReader(
            self._db_path(layer), table, busy_timeout_ms=self._busy_timeout_ms
        )

    def columns_of(self, layer: Layer | str, table: str) -> "RawTableColumns":
        """Mint the prior-columns source for a table — the drift seam (#51).

        Returns a ``PriorColumns`` (``framework.validators``) over the subject's
        layer file: it reports the table's currently-landed column set via
        ``PRAGMA`` so a ``SchemaDriftValidator`` can diff the next run's incoming
        columns against the prior landing (ADR-0008 amendment). Reads no rows and
        returns ``None`` when the table does not yet exist (first run).
        """
        return RawTableColumns(
            self._db_path(layer),
            table,
            layer_name(layer),
            busy_timeout_ms=self._busy_timeout_ms,
        )


class RawTableColumns:
    """A ``PriorColumns`` source: a table's landed columns via ``PRAGMA`` (#51).

    The production implementation of the seam ``SchemaDriftValidator`` reads. It
    inspects the live layer table's columns without materialising any rows —
    ``PRAGMA table_info`` over the shared ``connect`` factory (ADR-0001) — so the
    diff against the next run's incoming columns is cheap even for a large raw
    table. A missing table yields ``None`` (no prior landing); the ``label``
    (``<layer>.<table>``) names the table in the drift warning.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        layer: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms
        self.label = f"{layer}.{table}"

    def columns(self) -> tuple[str, ...] | None:
        if not self._db_path.exists():
            return None  # the subject has landed nothing yet (first run)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            rows = con.execute(
                f'PRAGMA table_info("{self._table}")'
            ).fetchall()
        finally:
            con.close()
        if not rows:
            return None  # the table does not exist yet (first run for this feed)
        # PRAGMA table_info yields (cid, name, type, ...); name is index 1.
        return tuple(row[1] for row in rows)


class StoreCatalog:
    """Mints subject-scoped Stores from shared root/configuration."""

    def __init__(
        self,
        root: str | os.PathLike[str],
        *,
        backend: StoreBackend | None = None,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._root = Path(root)
        self._backend = backend or DirectoryStoreBackend()
        self._busy_timeout_ms = busy_timeout_ms

    def store(self, subject: str | os.PathLike[str]) -> Store:
        """Mint the Store for ``subject`` without exposing physical layout."""
        return Store(
            self._backend.subject_dir(self._root, subject),
            busy_timeout_ms=self._busy_timeout_ms,
        )
