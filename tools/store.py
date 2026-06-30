"""Namespace-scoped stores that mint table Readers and Writers (application infra).

A ``namespace`` is an opaque **logical database** — one SQLite file holding many
related tables. A :class:`Store` binds one namespace to its file and mints
Readers/Writers over named tables; :class:`StoreRegistry` mints namespace Stores
from a shared root via a :class:`StoreBackend` **and** keeps a registry of named
Readers/Writers a pipeline can fetch by name. The store owns no business logic and
makes no load decision; callers choose the strategy when minting a Writer.

This is **application-level infrastructure**, a sibling ``tools`` utility — not
framework vocabulary. The framework knows only the ``Reader`` / ``Writer`` ports
(``framework.io``); where a feed lands (``namespace`` → file) and how named
components are wired is an application concern. The raw/silver/gold medallion is a
profile layered on top of this (``tools.medallion``), itself an application
convention (#232).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from framework._internal.connection import connect
from framework.io import (
    AccumulateByRun,
    AccumulateByRunWriter,
    InsertIfAbsent,
    InsertOrIgnore,
    QuarantineWriter,
    Reader,
    Refresh,
    SqliteInsertIfAbsentWriter,
    SqliteInsertOrIgnoreWriter,
    SqliteReader,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
    UpsertStrategy,
    Writer,
)
from framework.io.sql import quote_identifier

__all__ = [
    "DirectoryStoreBackend",
    "Store",
    "StoreBackend",
    "StoreRegistry",
]


class StoreBackend(Protocol):
    """Maps a registry root and a namespace to that namespace's database file."""

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
                strategy.logical_run_id,
                strategy.load_date,
                pipeline_run_id=strategy.pipeline_run_id,
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


class StoreRegistry:
    """Mints namespace Stores and registers named Readers/Writers for pipelines.

    Two complementary roles:

    * **Namespace factory** — :meth:`store` mints a :class:`Store` over one
      logical database from the shared root/backend (the role the former
      ``StoreCatalog`` played; ``tools.medallion`` builds on it).
    * **Named registry** — :meth:`register` records a Reader or Writer under a
      name and :meth:`reader` / :meth:`writer` fetch it back, so a pipeline can
      refer to a component by name rather than re-deriving it. The framework
      ``Pipeline`` is unchanged: it still takes the concrete Reader / Writer that
      :meth:`reader` / :meth:`writer` return.
    """

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
        self._readers: dict[str, Reader] = {}
        self._writers: dict[str, Writer] = {}

    def store(self, namespace: str | os.PathLike[str]) -> Store:
        """Mint the Store for ``namespace`` without exposing physical layout."""
        return Store(
            self._backend.db_file(self._root, namespace),
            namespace=namespace,
            busy_timeout_ms=self._busy_timeout_ms,
        )

    def register(self, name: str, component: Reader | Writer) -> Reader | Writer:
        """Register a Reader or Writer under ``name`` for later lookup.

        The kind is inferred from the component's port: a ``write`` method makes
        it a Writer, otherwise a ``read`` method makes it a Reader. Returns the
        component so a caller can register and use it in one expression. Raises
        ``TypeError`` if it is neither.
        """
        if _is_writer(component):
            self._writers[name] = component
        elif _is_reader(component):
            self._readers[name] = component
        else:
            raise TypeError(
                f"cannot register {name!r}: {component!r} is neither a Reader "
                "(read()) nor a Writer (write())"
            )
        return component

    def reader(self, name: str) -> Reader:
        """Return the Reader registered under ``name`` (raises if unknown)."""
        try:
            return self._readers[name]
        except KeyError:
            raise KeyError(
                f"no Reader registered as {name!r}; registered: {sorted(self._readers)}"
            ) from None

    def writer(self, name: str) -> Writer:
        """Return the Writer registered under ``name`` (raises if unknown)."""
        try:
            return self._writers[name]
        except KeyError:
            raise KeyError(
                f"no Writer registered as {name!r}; registered: {sorted(self._writers)}"
            ) from None


def _is_writer(component: object) -> bool:
    return callable(getattr(component, "write", None))


def _is_reader(component: object) -> bool:
    return callable(getattr(component, "read", None))
