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
        con = sqlite3.connect(self._db_path(layer))
        # Single writer in place on a share; readers wait out commits instead
        # of erroring. WAL is unavailable over a share, so we stay on the
        # default rollback journal (ADR-0001).
        con.execute(f"PRAGMA busy_timeout = {self._busy_timeout_ms}")
        return con

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
