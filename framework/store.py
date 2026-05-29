"""The medallion store — a dumb SQLite persistence layer.

Three SQLite databases, one per layer (raw, silver, gold), each a file under a
base directory (a network share in production). The store persists and returns
DataHandles; it holds no business logic (ADR-0001, ADR-0002). Connections come
from a single factory so cross-host read/write tolerance (busy_timeout,
rollback-journal mode) is configured in one place.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pandas as pd

from framework.data_handle import DataHandle

LAYERS = ("raw", "silver", "gold")


def connect(
    db_path: str | os.PathLike[str], busy_timeout_ms: int = 5000
) -> sqlite3.Connection:
    """Open a connection with the share-tolerant settings (ADR-0001).

    The single place SQLite connections are configured: a ``busy_timeout`` so
    read-only clients ride out the single writer's in-place commits instead of
    erroring, on the default rollback journal because WAL is unavailable over a
    network share. Readers and Writers both go through here.
    """
    con = sqlite3.connect(db_path)
    con.execute(f"PRAGMA busy_timeout = {busy_timeout_ms}")
    return con


class Store:
    """Read and write DataHandles to medallion layer databases."""

    def __init__(
        self, base_dir: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        self._base_dir = Path(base_dir)
        self._busy_timeout_ms = busy_timeout_ms

    def _db_path(self, layer: str) -> Path:
        if layer not in LAYERS:
            raise ValueError(f"unknown layer {layer!r}; expected one of {LAYERS}")
        return self._base_dir / f"{layer}.db"

    def _connect(self, layer: str) -> sqlite3.Connection:
        return connect(self._db_path(layer), self._busy_timeout_ms)

    def write(self, layer: str, table: str, handle: DataHandle) -> None:
        con = self._connect(layer)
        try:
            # Raw is a faithful snapshot of the source: truncate + reload so
            # re-runs are deterministic and never accumulate (ADR-0006).
            handle.to_pandas().to_sql(table, con, if_exists="replace", index=False)
            con.commit()
        finally:
            con.close()

    def read(self, layer: str, table: str) -> DataHandle:
        con = self._connect(layer)
        try:
            frame = pd.read_sql(f"SELECT * FROM {table}", con)
        finally:
            con.close()
        return DataHandle.from_pandas(frame)
