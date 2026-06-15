"""Writers persist datasets to destinations they own.

A Writer owns both its target location and load strategy. The pipeline hands it
the dataset and makes no write decisions of its own.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Protocol, runtime_checkable

import pandas as pd

from framework._internal.connection import connect
from framework._internal.describe import redact_url, render
from framework.io.dataset import Dataset
from framework.io.remote import SharePointPusher, StubbedSharePointPusher
from framework.io.sql import quote_identifier
from framework.io.strategy import AccumulateByRun, Refresh, UpsertStrategy


@runtime_checkable
class Writer(Protocol):
    """A destination for one feed's data."""

    def write(self, dataset: Dataset) -> None:
        """Persist the dataset to this Writer's target, per its load strategy."""
        ...


def _frame_for_strategy(
    dataset: Dataset,
    strategy: Refresh | AccumulateByRun | UpsertStrategy,
    read_existing: Callable[[], pd.DataFrame],
) -> pd.DataFrame:
    frame = dataset.to_pandas()
    if isinstance(strategy, Refresh):
        return frame
    if isinstance(strategy, AccumulateByRun):
        frame = _stamp_accumulate_frame(frame, strategy)

        existing = read_existing()
        if len(existing) > 0 and "run_id" in existing.columns:
            existing = existing[existing["run_id"] != strategy.run_id]
        return pd.concat([existing, frame], ignore_index=True)
    raise TypeError(f"Unsupported load strategy: {type(strategy).__name__}")


def _stamp_accumulate_frame(
    frame: pd.DataFrame, strategy: AccumulateByRun
) -> pd.DataFrame:
    frame["run_id"] = strategy.run_id
    frame["logical_run_id"] = strategy.run_id
    if strategy.execution_id is not None:
        frame["execution_id"] = strategy.execution_id
    frame["load_date"] = strategy.load_date
    return frame


class CsvWriter:
    """A file Deliverable Writer for CSV.

    Owns its target file and load strategy. ``Refresh`` overwrites the file with
    the current dataset; ``AccumulateByRun`` rewrites the file after replacing
    only that logical run's stamped rows.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: Refresh | AccumulateByRun,
    ) -> None:
        self._path = Path(path)
        self._strategy = strategy

    def write(self, dataset: Dataset) -> None:
        frame = _frame_for_strategy(dataset, self._strategy, self._read_existing)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(self._path, index=False, lineterminator="\n")

    def _read_existing(self) -> pd.DataFrame:
        if not self._path.exists():
            return pd.DataFrame()
        return pd.read_csv(self._path)

    def describe(self) -> str:
        return render(self, path=str(self._path))


class ExcelWriter:
    """A file Deliverable Writer for one Excel worksheet."""

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: Refresh | AccumulateByRun,
        sheet: str = "Sheet1",
    ) -> None:
        self._path = Path(path)
        self._strategy = strategy
        self._sheet = sheet

    def write(self, dataset: Dataset) -> None:
        frame = _frame_for_strategy(dataset, self._strategy, self._read_existing)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with pd.ExcelWriter(self._path) as writer:
            frame.to_excel(writer, sheet_name=self._sheet, index=False)

    def _read_existing(self) -> pd.DataFrame:
        if not self._path.exists():
            return pd.DataFrame()
        return pd.read_excel(self._path, sheet_name=self._sheet)

    def describe(self) -> str:
        return render(self, path=str(self._path), sheet=self._sheet)


class JsonWriter:
    """A file Deliverable Writer for JSON record arrays."""

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: Refresh | AccumulateByRun,
    ) -> None:
        self._path = Path(path)
        self._strategy = strategy

    def write(self, dataset: Dataset) -> None:
        frame = _frame_for_strategy(dataset, self._strategy, self._read_existing)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_json(
            self._path,
            orient="records",
            date_format="iso",
            indent=2,
            force_ascii=False,
        )

    def _read_existing(self) -> pd.DataFrame:
        if not self._path.exists():
            return pd.DataFrame()
        return pd.read_json(self._path, orient="records")

    def describe(self) -> str:
        return render(self, path=str(self._path))


class SharePointWriter:
    """Emit a Dataset to a SharePoint list through a swappable pusher."""

    def __init__(
        self,
        site: str,
        list_name: str,
        auth: object = None,
        strategy: Refresh | AccumulateByRun = Refresh(),
        *,
        pusher: SharePointPusher | None = None,
    ) -> None:
        self._site = site
        self._list_name = list_name
        self._auth = auth
        self._strategy = strategy
        self._pusher = pusher or StubbedSharePointPusher()

    def write(self, dataset: Dataset) -> None:
        if isinstance(self._strategy, AccumulateByRun):
            dataset = Dataset.from_pandas(
                _stamp_accumulate_frame(dataset.to_pandas(), self._strategy)
            )
        self._pusher.push(
            self._site,
            self._list_name,
            self._auth,
            dataset,
            self._strategy,
        )

    def describe(self) -> str:
        # Strip any credentials embedded in the site URL and omit auth config
        # entirely — the plan never surfaces secrets.
        return render(self, site=redact_url(self._site), list_name=self._list_name)


class SqliteTruncateReloadWriter:
    """A Writer that full-refreshes one table: truncate + reload."""

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
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            dataset.to_pandas().to_sql(
                self._table, con, if_exists="replace", index=False
            )
            con.commit()
        finally:
            con.close()

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)


class QuarantineWriter:
    """A Writer for the quarantine reject table.

    Owns its target location (db_path + table). The pipeline stamps logical
    ``run_id`` and ``load_date`` on the rejected dataset before calling
    ``write()``, so this writer just does the idempotent delete-by-run_id +
    append that lets a re-driven run replace only its own prior rejects without
    touching other runs.

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
                        f"DELETE FROM {quote_identifier(self._table)} WHERE run_id = ?",
                        (run_id,),
                    )
                except sqlite3.OperationalError:
                    pass  # table does not exist yet
            frame.to_sql(self._table, con, if_exists="append", index=False)
            con.commit()
        finally:
            con.close()

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)


class SqliteUpsertWriter:
    """A Writer that merges incoming rows by a declared key set.

    Uses a SQL-native DELETE + INSERT via a scratch staging table — no full
    table read. Only the rows being replaced are touched:

    1. Incoming rows are written to a per-table scratch staging table (DDL,
       auto-committed per SQLite's default isolation).
    2. Target rows whose key appears in staging are deleted (O(incoming)).
    3. All staging rows are inserted into the target (O(incoming)).
    4. Steps 2–3 commit atomically; a failure rolls back, leaving prior state.
    5. Staging table is dropped as post-commit cleanup.

    Target rows whose key does NOT appear in the incoming batch are never
    read or written.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        key_columns: tuple[str, ...],
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._key_columns = key_columns
        self._busy_timeout_ms = busy_timeout_ms
        # Staging name is table-scoped to avoid collision when multiple
        # UpsertWriters target different tables in the same layer db.
        self._staging = f"_upsert_stage_{table}"

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        missing = [c for c in self._key_columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"UpsertStrategy key column(s) not found in dataset: {missing}"
            )
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            table = quote_identifier(self._table)
            staging = quote_identifier(self._staging)
            col_list = ", ".join(quote_identifier(c) for c in frame.columns)

            # Write incoming rows to staging (DDL auto-commits; staging data
            # is visible to subsequent statements on this connection).
            frame.to_sql(self._staging, con, if_exists="replace", index=False)

            # Ensure the target table exists before DELETEing from it.
            # "append" on an empty frame: creates the table if absent (DDL,
            # auto-commits), or is a DML no-op if it already exists.
            frame.iloc[:0].to_sql(self._table, con, if_exists="append", index=False)

            # Atomic merge: delete matching rows, then insert all incoming.
            # EXISTS join handles composite keys without row-value syntax.
            key_match = " AND ".join(
                f"{staging}.{quote_identifier(k)} = {table}.{quote_identifier(k)}"
                for k in self._key_columns
            )
            con.execute(
                f"DELETE FROM {table} WHERE EXISTS "
                f"(SELECT 1 FROM {staging} WHERE {key_match})"
            )
            con.execute(
                f"INSERT INTO {table} ({col_list}) SELECT {col_list} FROM {staging}"
            )
            con.commit()

            # Drop the staging table now that the merge is committed.
            con.execute(f"DROP TABLE IF EXISTS {staging}")
        finally:
            con.close()

    def describe(self) -> str:
        return render(
            self,
            db_path=str(self._db_path),
            table=self._table,
            key_columns=list(self._key_columns),
        )


class AccumulateByRunWriter:
    """A Writer that accumulates runs into one table, stamped by run.

    Owns its target location (a single layer db file + table). Used for the gold
    layer (the accumulating SelectionPool / Review Outcomes), whose history must
    survive across runs. Each row is stamped with the logical ``run_id`` /
    ``logical_run_id`` / ``load_date`` plus ``execution_id`` when the strategy
    was derived from a RunContext. A re-driven logical run is idempotent via
    delete-by-run then insert.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        run_id: str,
        load_date: str,
        execution_id: str | None = None,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._table = table
        self._run_id = run_id
        self._load_date = load_date
        self._execution_id = execution_id
        self._busy_timeout_ms = busy_timeout_ms

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        frame["run_id"] = self._run_id
        frame["logical_run_id"] = self._run_id
        if self._execution_id is not None:
            frame["execution_id"] = self._execution_id
        frame["load_date"] = self._load_date

        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            # Idempotent re-run: clear this run's prior rows, then append, so a
            # re-driven day replaces only its own rows and never other runs'.
            try:
                con.execute(
                    f"DELETE FROM {quote_identifier(self._table)} WHERE run_id = ?",
                    (self._run_id,),
                )
            except sqlite3.OperationalError:
                pass  # table does not exist yet — nothing to clear
            frame.to_sql(self._table, con, if_exists="append", index=False)
            con.commit()
        finally:
            con.close()

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)
