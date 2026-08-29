"""The shared SQLite connection factory.

Kept separate so Store factories and I/O adapters can share connection setup
without an import cycle. It is the single place SQLite connections are
configured: ``busy_timeout`` lets clients ride out the single writer's in-place
commits, and the default rollback journal is used because WAL is unavailable
over a network share.
"""

from __future__ import annotations

import os
import sqlite3


def connect(
    db_path: str | os.PathLike[str], busy_timeout_ms: int = 5000
) -> sqlite3.Connection:
    """Open a connection with the share-tolerant settings."""
    con = sqlite3.connect(db_path)
    con.execute(f"PRAGMA busy_timeout = {busy_timeout_ms}")
    return con
