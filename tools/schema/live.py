"""Read a live table's shape and diff it against a :class:`Table` declaration.

Reads through the same connection seam every other SQLite component uses
(``framework._internal.connection.connect``) and the same namespace -> file
mapping ``tools.store`` uses (``DirectoryStoreBackend``), so a declared
namespace resolves to exactly the file a real pipeline run would have written.
Read-only: ``PRAGMA table_info`` never materialises a row, so diffing is cheap
even against a large table and safe to run against prod. The diff is
column-level only -- a declaration's ``primary_key`` / ``indexes`` are not read
back (nothing creates them yet, so every table would report the same drift);
see the "not yet diffed" note in ``docs/schema-declaration.md``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from framework._internal.connection import connect
from tools.schema.declaration import Column, Table
from tools.store import DirectoryStoreBackend

__all__ = ["LiveTable", "TableDiff", "diff_tables", "read_live_table"]

_DEFAULT_BACKEND = DirectoryStoreBackend()


@dataclass(frozen=True)
class LiveTable:
    """One table's shape as a real database reports it, via ``PRAGMA``."""

    namespace: str
    name: str
    columns: tuple[Column, ...]


def read_live_table(
    base_dir: str | os.PathLike[str],
    namespace: str,
    table: str,
    *,
    busy_timeout_ms: int = 5000,
) -> LiveTable | None:
    """Read ``table``'s live shape from ``namespace``'s database under ``base_dir``.

    Returns ``None`` when the namespace's file doesn't exist yet, or exists but
    has never landed this table -- both first-run states, not drift (see
    :func:`diff_tables`).
    """
    db_path = Path(_DEFAULT_BACKEND.db_file(Path(base_dir), namespace))
    if not db_path.exists():
        return None
    con = connect(db_path, busy_timeout_ms)
    try:
        rows = con.execute(f'PRAGMA table_info("{table}")').fetchall()
    finally:
        con.close()
    if not rows:
        return None
    # PRAGMA table_info yields (cid, name, type, notnull, dflt_value, pk).
    columns = tuple(
        Column(row[1], row[2] or "TEXT", nullable=not bool(row[3])) for row in rows
    )
    return LiveTable(namespace=namespace, name=table, columns=columns)


@dataclass(frozen=True)
class TableDiff:
    """The column-level differences between a declared and a live table.

    ``live is None`` means the table has never landed (no database file, or no
    such table in one that exists) -- reported separately from drift, since a
    freshly built environment that has simply never run yet is not "drifted".
    """

    table: Table
    live: LiveTable | None
    changed: tuple[str, ...] = ()
    added: tuple[str, ...] = ()
    removed: tuple[str, ...] = ()

    @property
    def landed(self) -> bool:
        return self.live is not None

    @property
    def drifted(self) -> bool:
        """Whether a *landed* table's shape disagrees with its declaration."""
        return self.landed and bool(self.changed or self.added or self.removed)

    @property
    def missing_column_names(self) -> tuple[str, ...]:
        """Declared columns the live table lacks, in declared order.

        The structured form of what :attr:`removed` renders for a human --
        ``tools.schema.emit`` needs the names themselves to emit an
        ``ADD COLUMN``, and reading them back out of a display string would
        make the rendering format load-bearing for generated SQL.
        """
        if self.live is None:
            return ()
        live_names = {column.name for column in self.live.columns}
        return tuple(
            column.name
            for column in self.table.columns
            if column.name not in live_names
        )

    def render(self) -> list[str]:
        """One line per difference, in the ``schema diff`` command's format."""
        if not self.landed:
            return [f"  {self.table.name}  (not yet landed)"]
        lines = list(self.changed) + list(self.added) + list(self.removed)
        return [f"  {line}" for line in lines] if lines else []


def diff_tables(table: Table, live: LiveTable | None) -> TableDiff:
    """Diff a declaration against what a live database actually contains.

    Three kinds of column disagreement, each rendered the way the ``schema
    diff`` output shows it:

    - ``~ name   declared X, live Y`` -- present on both sides, a type mismatch.
    - ``+ name   live only (undeclared)`` -- landed, but never declared.
    - ``- name   declared, missing`` -- declared, but absent from the live table.
    """
    if live is None:
        return TableDiff(table=table, live=None)

    declared_by_name = {column.name: column for column in table.columns}
    live_by_name = {column.name: column for column in live.columns}

    changed = tuple(
        f"~ {name}   declared {declared_by_name[name].sql_type}, "
        f"live {live_by_name[name].sql_type}"
        for name in declared_by_name
        if name in live_by_name
        and declared_by_name[name].sql_type != live_by_name[name].sql_type
    )
    added = tuple(
        f"+ {name}   live only (undeclared)"
        for name in live_by_name
        if name not in declared_by_name
    )
    removed = tuple(
        f"- {name}   declared, missing"
        for name in declared_by_name
        if name not in live_by_name
    )
    return TableDiff(
        table=table, live=live, changed=changed, added=added, removed=removed
    )
