"""Writers persist datasets to destinations they own.

A Writer owns both its target location and load strategy. The pipeline hands it
the dataset and makes no write decisions of its own.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TextIO

import pandas as pd

from framework._internal.connection import connect
from framework._internal.describe import redact_url, render
from framework.core.protocols import Writer
from framework.core.dataset import Dataset
from framework.io.remote import SharePointPusher, StubbedSharePointPusher
from framework.io.sql import quote_identifier
from framework.io.strategy import AccumulateByRun, Refresh, UpsertStrategy

def _frame_for_strategy(
    dataset: Dataset,
    strategy: Refresh | AccumulateByRun | UpsertStrategy,
    read_existing: Callable[[], pd.DataFrame],
) -> tuple[pd.DataFrame, bool]:
    """Return (frame_to_write, replaced) where replaced is True when prior rows
    for this run_id already existed (a re-run), False for a fresh write."""
    frame = dataset.to_pandas()
    if isinstance(strategy, Refresh):
        return frame, False
    if isinstance(strategy, AccumulateByRun):
        frame = _stamp_accumulate_frame(frame, strategy)

        existing = read_existing()
        replaced = False
        if len(existing) > 0 and "run_id" in existing.columns:
            replaced = bool((existing["run_id"] == strategy.run_id).any())
            existing = existing[existing["run_id"] != strategy.run_id]
        return pd.concat([existing, frame], ignore_index=True), replaced
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

    After ``write()`` returns, ``replaced`` is ``True`` when prior rows for this
    run_id already existed in the file (a re-run), ``False`` for a fresh write.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: Refresh | AccumulateByRun,
    ) -> None:
        self._path = Path(path)
        self._strategy = strategy
        self.replaced: bool = False

    def write(self, dataset: Dataset) -> None:
        frame, self.replaced = _frame_for_strategy(
            dataset, self._strategy, self._read_existing
        )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(self._path, index=False, lineterminator="\n")

    def _read_existing(self) -> pd.DataFrame:
        if not self._path.exists():
            return pd.DataFrame()
        return pd.read_csv(self._path)

    def describe(self) -> str:
        return render(self, path=str(self._path))


class ExcelWriter:
    """A file Deliverable Writer for one Excel worksheet.

    After ``write()`` returns, ``replaced`` is ``True`` when prior rows for this
    run_id already existed in the file (a re-run), ``False`` for a fresh write.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: Refresh | AccumulateByRun,
        sheet: str = "Sheet1",
    ) -> None:
        self._path = Path(path)
        self._strategy = strategy
        self._sheet = sheet
        self.replaced: bool = False

    def write(self, dataset: Dataset) -> None:
        frame, self.replaced = _frame_for_strategy(
            dataset, self._strategy, self._read_existing
        )
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
    """A file Deliverable Writer for JSON record arrays.

    After ``write()`` returns, ``replaced`` is ``True`` when prior rows for this
    run_id already existed in the file (a re-run), ``False`` for a fresh write.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        strategy: Refresh | AccumulateByRun,
    ) -> None:
        self._path = Path(path)
        self._strategy = strategy
        self.replaced: bool = False

    def write(self, dataset: Dataset) -> None:
        frame, self.replaced = _frame_for_strategy(
            dataset, self._strategy, self._read_existing
        )
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


class StdoutWriter:
    """A Writer that prints the dataset to the console instead of persisting it.

    Owns neither a target location nor a load strategy — it is a terminal sink for
    *seeing* a result rather than storing one, e.g. printing a Selection
    explainer's per-Case trace while developing or driving a feed by hand. Each
    ``write`` renders the whole dataset as a plain-text table (column headers +
    rows) to the stream, which defaults to ``sys.stdout`` (resolved per call, so
    test capture and redirection both work) but can be pointed at any text stream.

    An optional ``label`` is printed above the table to caption what is being
    shown when several datasets land on the same console.
    """

    def __init__(self, label: str | None = None, *, stream: TextIO | None = None) -> None:
        self._label = label
        self._stream = stream

    def write(self, dataset: Dataset) -> None:
        stream = self._stream if self._stream is not None else sys.stdout
        if self._label:
            print(self._label, file=stream)
        print(dataset.to_pandas().to_string(index=False), file=stream)

    def describe(self) -> str:
        return render(self, label=self._label)


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

    After ``write()`` returns, ``replaced`` is ``True`` when prior rows for this
    run_id already existed (a re-run), ``False`` for a fresh write.
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
        self.replaced: bool = False

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
                cursor = con.execute(
                    f"DELETE FROM {quote_identifier(self._table)} WHERE run_id = ?",
                    (self._run_id,),
                )
                self.replaced = cursor.rowcount > 0
            except sqlite3.OperationalError:
                self.replaced = False  # table does not exist yet — nothing to clear
            frame.to_sql(self._table, con, if_exists="append", index=False)
            con.commit()
        finally:
            con.close()

    def describe(self) -> str:
        return render(self, db_path=str(self._db_path), table=self._table)
