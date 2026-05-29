"""Writers — the component-role dual of ``Reader``.

A ``Reader`` brings a feed's data in (``read() -> DataHandle``); a ``Writer``
takes it out (``write(handle) -> None``). A Writer owns **both** its target
location *and* its load strategy (truncate+reload vs accumulate-by-run —
ADR-0006); the builder/terminus hands it the handle and makes no write
decisions of its own (ADR-0003). The concrete engine (pandas) lives behind the
DataHandle seam, never in the Protocol signature. See ADR-0002, ADR-0003.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Protocol, runtime_checkable

from framework.connection import connect
from framework.data_handle import DataHandle


@runtime_checkable
class Writer(Protocol):
    """A destination for one feed's data."""

    def write(self, handle: DataHandle) -> None:
        """Persist the handle to this Writer's target, per its load strategy."""
        ...


class SqliteTruncateReloadWriter:
    """A Writer that full-refreshes one table: truncate + reload (ADR-0006).

    Owns its target location (a single layer db file + table). Used for the raw
    and silver layers, whose contents mirror a current-state source snapshot, so
    re-runs are deterministic and never accumulate.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, handle: DataHandle) -> None:
        # Create the subject's medallion directory on first write — a new
        # subject lands its own files and migrates nothing (ADR-0001 amendment).
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            handle.to_pandas().to_sql(
                self._table, con, if_exists="replace", index=False
            )
            con.commit()
        finally:
            con.close()


class AccumulateByRunWriter:
    """A Writer that accumulates runs into one table, stamped by run (ADR-0006).

    Owns its target location (a single layer db file + table). Used for the gold
    layer (the accumulating SelectionPool / Review Outcomes), whose history must
    survive across runs. Each row is stamped ``run_id`` / ``load_date``; a
    re-driven run is idempotent via delete-by-run then insert.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        run_id: str,
        load_date: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._run_id = run_id
        self._load_date = load_date
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, handle: DataHandle) -> None:
        frame = handle.to_pandas().copy()
        frame["run_id"] = self._run_id
        frame["load_date"] = self._load_date

        # Create the subject's medallion directory on first write — a new
        # subject lands its own files and migrates nothing (ADR-0001 amendment).
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            # Idempotent re-run: clear this run's prior rows, then append, so a
            # re-driven day replaces only its own rows and never other runs'.
            try:
                con.execute(
                    f"DELETE FROM {self._table} WHERE run_id = ?", (self._run_id,)
                )
            except sqlite3.OperationalError:
                pass  # table does not exist yet — nothing to clear
            frame.to_sql(self._table, con, if_exists="append", index=False)
            con.commit()
        finally:
            con.close()
