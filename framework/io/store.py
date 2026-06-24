"""Subject-scoped medallion stores that mint layer Readers and Writers.

A ``Store`` maps a subject and layer to ``<subject_dir>/{raw,silver,gold}.db``.
It owns no business logic and makes no load decisions; callers choose the
strategy when minting a Writer.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from framework._internal.connection import connect
from framework.core.layers import Layer, layer_name
from framework.io.readers import Reader, SqliteReader
from framework.io.sql import quote_identifier
from framework.io.strategy import (
    AccumulateByRun,
    InsertIfAbsent,
    InsertOrIgnore,
    Refresh,
    UpsertStrategy,
)
from framework.io.writers import (
    AccumulateByRunWriter,
    QuarantineWriter,
    SqliteInsertIfAbsentWriter,
    SqliteInsertOrIgnoreWriter,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
    Writer,
)

__all__ = [
    "DirectoryStoreBackend",
    "Store",
    "StoreBackend",
    "StoreCatalog",
]


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
        self._subject_dir = Path(subject_dir)
        self._busy_timeout_ms = busy_timeout_ms

    def _db_path(self, layer: Layer | str) -> Path:
        return self._subject_dir / f"{layer_name(layer)}.db"

    def writer(
        self,
        layer: Layer | str,
        table: str,
        strategy: Refresh
        | AccumulateByRun
        | UpsertStrategy
        | InsertOrIgnore
        | InsertIfAbsent,  # noqa: E501
    ) -> Writer:
        """Mint a Writer over the subject's layer file with the given strategy."""
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
        if isinstance(strategy, InsertOrIgnore):
            return SqliteInsertOrIgnoreWriter(
                db_path, table, busy_timeout_ms=self._busy_timeout_ms
            )
        if isinstance(strategy, InsertIfAbsent):
            return SqliteInsertIfAbsentWriter(
                db_path,
                table,
                strategy.key_columns,
                surrogate_column=strategy.surrogate_column,
                busy_timeout_ms=self._busy_timeout_ms,
            )
        raise TypeError(f"unknown strategy {strategy!r}")

    def reader(self, layer: Layer | str, table: str) -> Reader:
        """Mint a Reader over the subject's layer file."""
        return SqliteReader(
            self._db_path(layer), table, busy_timeout_ms=self._busy_timeout_ms
        )

    def quarantine_writer(self, table: str) -> Writer:
        """Mint a QuarantineWriter over the subject's quarantine file."""
        return QuarantineWriter(
            self._subject_dir / "quarantine.db",
            table,
            busy_timeout_ms=self._busy_timeout_ms,
        )

    def columns_of(self, layer: Layer | str, table: str) -> "RawTableColumns":
        """Mint the prior-columns source used for schema drift checks."""
        return RawTableColumns(
            self._db_path(layer),
            table,
            layer_name(layer),
            busy_timeout_ms=self._busy_timeout_ms,
        )


class RawTableColumns:
    """A ``PriorColumns`` source backed by ``PRAGMA table_info``.

    It inspects the live table columns without materialising rows, so drift
    checks stay cheap even for a large raw table. A missing table yields
    ``None``; ``label`` names the table in the drift warning.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        layer: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
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
                f"PRAGMA table_info({quote_identifier(self._table)})"
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
