"""The shared SQLite connection factory — the seam Readers, Writers, and the
Store all open connections through.

Kept in its own module so the per-subject ``Store`` can mint Writers/Readers
(importing those modules) while those modules still depend only on this factory
— no ``store`` ↔ ``writers`` import cycle (ADR-0001). It is the single place
SQLite connections are configured: a ``busy_timeout`` so read-only clients ride
out the single writer's in-place commits instead of erroring, on the default
rollback journal because WAL is unavailable over a network share.
"""

from __future__ import annotations

import os
import sqlite3

# The three medallion layers a subject owns, one SQLite file each.
LAYERS = ("raw", "silver", "gold")


def connect(
    db_path: str | os.PathLike[str], busy_timeout_ms: int = 5000
) -> sqlite3.Connection:
    """Open a connection with the share-tolerant settings (ADR-0001)."""
    con = sqlite3.connect(db_path)
    con.execute(f"PRAGMA busy_timeout = {busy_timeout_ms}")
    return con
