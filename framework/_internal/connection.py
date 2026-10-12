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
from pathlib import Path
from urllib.parse import urlsplit


def _read_only_uri(file_uri: str) -> str:
    """Keep encoded paths, spelling UNC hosts as paths SQLite accepts."""
    parts = urlsplit(file_uri)
    if parts.netloc:
        file_uri = f"file:////{parts.netloc}{parts.path}"
    return f"{file_uri}?mode=ro"


def connect(
    db_path: str | os.PathLike[str],
    busy_timeout_ms: int = 5000,
    *,
    read_only: bool = False,
) -> sqlite3.Connection:
    """Open with share-tolerant settings; opt-in reads cannot create or write."""
    if read_only:
        con = sqlite3.connect(
            _read_only_uri(Path(db_path).resolve().as_uri()), uri=True
        )
    else:
        con = sqlite3.connect(db_path)
    con.execute(f"PRAGMA busy_timeout = {busy_timeout_ms}")
    return con
