"""The shared SQLite connection factory.

Kept in its own module so the per-subject ``Store`` can mint Writers/Readers
(importing those modules) while those modules still depend only on this factory
without a cycle. It is the single place SQLite connections are configured:
``busy_timeout`` lets read-only clients ride out the single writer's in-place
commits instead of erroring. The default rollback journal is used because WAL is
unavailable over a network share.
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
