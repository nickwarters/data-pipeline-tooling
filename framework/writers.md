```python
"""Writers — the component-role dual of ``Reader``.

A ``Reader`` brings a feed's data in (``read() -> Dataset``); a ``Writer``
takes it out (``write(dataset) -> None``). A Writer owns **both** its target
location *and* its load strategy (truncate+reload vs accumulate-by-run —
ADR-0006); the builder/terminus hands it the dataset and makes no write
decisions of its own (ADR-0003). The concrete engine (pandas) lives behind the
Dataset seam, never in the Protocol signature. See ADR-0002, ADR-0003.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Protocol, runtime_checkable

from framework.connection import connect
from framework.dataset import Dataset


@runtime_checkable
class Writer(Protocol):
    """A destination for one feed's data."""

    def write(self, dataset: Dataset) -> None:
        """Persist the dataset to this Writer's target, per its load strategy."""
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

    def write(self, dataset: Dataset) -> None:
        # Create the subject's medallion directory on first write — a new
        # subject lands its own files and migrates nothing (ADR-0001 amendment).
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            dataset.to_pandas().to_sql(
                self._table, con, if_exists="replace", index=False
            )
            con.commit()
        finally:
            con.close()


class QuarantineWriter:
    """A Writer for the quarantine reject table — accumulates rejects across runs.

    Owns its target location (db_path + table). The pipeline stamps ``run_id``
    and ``load_date`` on the rejected dataset before calling ``write()``, so this
    writer just does the idempotent delete-by-run_id + append that lets a re-driven
    run replace only its own prior rejects without touching other runs (ADR-0006).

    Unlike ``AccumulateByRunWriter``, this writer does NOT stamp ``run_id`` or
    ``load_date`` — those come from the dataset (added by the pipeline at quarantine
    time). The ``failed_rule`` column also arrives pre-stamped by the partitioner.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            if "run_id" in frame.columns:
                run_id = frame["run_id"].iloc[0]
                try:
                    con.execute(
                        f"DELETE FROM {self._table} WHERE run_id = ?", (run_id,)
                    )
                except sqlite3.OperationalError:
                    pass  # table does not exist yet
            frame.to_sql(self._table, con, if_exists="append", index=False)
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

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas().copy()
        frame["run_id"] = self._run_id
        frame["load_date"] = self._load_date

        # Create the subject's medallion directory on first write — a new
        # subject lands its own files and migrates nothing (ADR-0001 amendment).
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            # Delete + append commit as a single transaction (one commit at the
            # end; an error before it rolls back on close) — atomic, so a failed
            # re-run never half-wipes prior rows (ADR-0007).
            #
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

```
