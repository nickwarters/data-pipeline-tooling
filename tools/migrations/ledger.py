"""The per-database ``schema_migrations`` ledger.

Each database carries its own ledger, so a database is self-describing and
migrating one is independent of the rest -- there is no cross-database index of
"what's been applied where". Opened only through
``framework._internal.connection.connect``, like every other SQLite component
in this repo.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

__all__ = [
    "LEDGER_TABLE",
    "LedgerRow",
    "ensure_ledger",
    "ledger_exists",
    "applied_migrations",
    "record_applied",
]

LEDGER_TABLE = "schema_migrations"

_CREATE_LEDGER = f"""
    CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} (
        version    TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        scope      TEXT NOT NULL,
        checksum   TEXT NOT NULL,
        applied_at TEXT NOT NULL
    )
"""


@dataclass(frozen=True)
class LedgerRow:
    """One migration this database has already applied."""

    version: str
    name: str
    scope: str
    checksum: str
    applied_at: str


def ensure_ledger(con: sqlite3.Connection) -> None:
    """Create the ledger table if this database has never been migrated."""
    con.execute(_CREATE_LEDGER)


def ledger_exists(con: sqlite3.Connection) -> bool:
    """Whether this database has a ledger yet, without creating one."""
    return bool(
        con.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (LEDGER_TABLE,),
        ).fetchone()
    )


def applied_migrations(con: sqlite3.Connection) -> dict[str, LedgerRow]:
    """Every migration this database's ledger already records, keyed by version.

    **Read-only**: a database with no ledger yet reports nothing applied rather
    than having one created for it. ``migrate --plan`` / ``--status`` promise to
    touch nothing, and creating a table is touching something -- the ledger is
    created by :func:`ensure_ledger`, inside the transaction that applies the
    first migration.
    """
    if not ledger_exists(con):
        return {}
    rows = con.execute(
        f"SELECT version, name, scope, checksum, applied_at FROM {LEDGER_TABLE}"
    ).fetchall()
    return {row[0]: LedgerRow(*row) for row in rows}


def record_applied(
    con: sqlite3.Connection,
    *,
    version: str,
    name: str,
    scope: str,
    checksum: str,
    applied_at: str,
) -> None:
    """Insert one ledger row. Caller commits -- see ``runner.apply_database``,
    which inserts this in the *same* transaction as the migration's own
    statements, so a crash mid-apply can never leave the row without the
    change it describes (or vice versa)."""
    con.execute(
        f"INSERT INTO {LEDGER_TABLE} (version, name, scope, checksum, applied_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (version, name, scope, checksum, applied_at),
    )
