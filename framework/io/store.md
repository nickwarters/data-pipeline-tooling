```python
"""Namespace-scoped stores that mint table Readers and Writers.

A ``namespace`` is an opaque **logical database** — one SQLite file holding many
related tables. A :class:`Store` binds one namespace to its file and mints
Readers/Writers over named tables; :class:`StoreCatalog` mints namespace Stores
from a shared root via a :class:`StoreBackend`. The store owns no business logic
and makes no load decision; callers choose the strategy when minting a Writer.

The framework knows only ``namespace → file``; the raw/silver/gold medallion is
an application-level profile layered on top (``tools.medallion``), not framework
vocabulary.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from framework._internal.connection import connect
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
    """Maps a catalog root and a namespace to that namespace's database file."""

    def db_file(
        self, root: Path, namespace: str | os.PathLike[str]
    ) -> str | os.PathLike[str]:
        """Return the concrete file for one namespace's logical database."""
        ...


class DirectoryStoreBackend:
    """Filesystem backend mapping a namespace to ``<root>/<namespace>.db``.

    A namespace may nest with ``/`` (e.g. ``cases/silver``), which maps to
    ``<root>/cases/silver.db`` — the layout the medallion profile uses to keep a
    subject's layer files together and isolated (ADR-0001).
    """

    def db_file(
        self, root: Path, namespace: str | os.PathLike[str]
    ) -> str | os.PathLike[str]:
        ns = Path(namespace)
        return root / ns.parent / f"{ns.name}.db"


class Store:
    """One namespace (a logical database): mints Writers/Readers over its tables.

    ``Store`` binds a single database file and mints components over named tables
    in it. It makes no load decision (ADR-0003); the caller chooses the strategy
    when minting a Writer.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        *,
        namespace: str | os.PathLike[str] | None = None,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._namespace = (
            str(namespace) if namespace is not None else self._db_path.stem
        )
        self._busy_timeout_ms = busy_timeout_ms

    def writer(
        self,
        table: str,
        strategy: Refresh
        | AccumulateByRun
        | UpsertStrategy
        | InsertOrIgnore
        | InsertIfAbsent,
    ) -> Writer:
        """Mint a Writer over a table in this namespace with the given strategy."""
        db_path = self._db_path
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

    def reader(self, table: str) -> Reader:
        """Mint a Reader over a table in this namespace."""
        return SqliteReader(self._db_path, table, busy_timeout_ms=self._busy_timeout_ms)

    def quarantine_writer(self, table: str) -> Writer:
        """Mint a QuarantineWriter over this namespace's quarantine file."""
        return QuarantineWriter(
            self._db_path.parent / "quarantine.db",
            table,
            busy_timeout_ms=self._busy_timeout_ms,
        )

    def columns_of(self, table: str) -> "TableColumns":
        """Mint the prior-columns source used for schema drift checks."""
        return TableColumns(
            self._db_path,
            table,
            self._namespace,
            busy_timeout_ms=self._busy_timeout_ms,
        )


class TableColumns:
    """A ``PriorColumns`` source backed by ``PRAGMA table_info``.

    It inspects the live table columns without materialising rows, so drift
    checks stay cheap even for a large table. A missing table yields ``None``;
    ``label`` names the namespace + table in the drift warning.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        namespace: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms
        self.label = f"{namespace}.{table}"

    def columns(self) -> tuple[str, ...] | None:
        if not self._db_path.exists():
            return None  # the namespace has landed nothing yet (first run)
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
    """Mints namespace-scoped Stores from a shared root/configuration."""

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

    def store(self, namespace: str | os.PathLike[str]) -> Store:
        """Mint the Store for ``namespace`` without exposing physical layout."""
        return Store(
            self._backend.db_file(self._root, namespace),
            namespace=namespace,
            busy_timeout_ms=self._busy_timeout_ms,
        )

```
