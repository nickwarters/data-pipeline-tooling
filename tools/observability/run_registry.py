"""The run registry: a query store for structured ``RunLog`` records.

A ``RunLog`` writes one JSON object per step plus a run summary to a ``.log``
file, all sharing a ``pipeline_run_id`` (the concrete pipeline attempt). This
module loads those records into its own queryable SQLite store so operators can
answer
"did last night's Ingest for Case Type B succeed, how many rows, did anything
warn?" without grepping free text.

The stored shape is not restated here: the table, the additive column migration,
the ``INSERT`` and the row decode are all derived from the single field
declaration in :mod:`tools.observability.record_schema`, so what is written and
what is read can never drift from what the log emits.

Opening the file and migrating it are separate jobs. Migration is write work,
and a writer's lock is exclusive because WAL is unavailable on the share, so
doing it per connection made every read-only operator query briefly lock the
registry against every running pipeline. It is attempted once per instance now,
and writes only when the file is actually behind.

It is a *query* store, not a ``Dataset`` carrier, so it stays stdlib-only
(``json`` + ``sqlite3``) and never touches pandas. It opens through the shared
``connect`` factory in ``framework._internal.connection`` so SQLite settings stay
centralized.

Ingest is incremental: each ``.log`` file's last consumed byte position is
persisted in the registry DB (``ingest_progress`` table).  On the next call,
only the new tail bytes are read so cost does not grow with total history — an
important property when the file lives on a network share (ADR-0001).  If the
file is shorter than the recorded offset (truncation / rotation), the offset is
reset to 0 and the whole file is re-read from the top; idempotency via
``INSERT OR IGNORE`` guarantees no double-counting.
"""

from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from framework._internal.connection import connect
from tools.observability.record_schema import (
    RUN_RECORD_COLUMNS,
    RUN_RECORD_PRIMARY_KEY,
    create_table_sql,
    ensure_columns,
    insert_sql,
)
from tools.observability.timestamps import start_of_local_day, utc_now_iso

if TYPE_CHECKING:
    from framework.run.address import RunAddress

_TABLE = "run_records"
# Both statements are derived from the one field declaration, so the stored
# shape and what is written into it cannot disagree.
_CREATE_RUN_RECORDS = create_table_sql(
    _TABLE, RUN_RECORD_COLUMNS, RUN_RECORD_PRIMARY_KEY
)
_INSERT_RUN_RECORD = insert_sql(_TABLE, RUN_RECORD_COLUMNS, or_ignore=True)

_CREATE_INGEST_PROGRESS = """
    CREATE TABLE IF NOT EXISTS ingest_progress (
        log_path    TEXT PRIMARY KEY,
        byte_offset INTEGER NOT NULL
    )
"""

# The step address of a record that predates the column: derived from the
# pipeline and step it already carries.
_BACKFILL_STEP_ADDRESS = """
    UPDATE run_records
    SET step_address = CASE
        WHEN step = 'run' THEN pipeline
        ELSE pipeline || '.' || step
    END
    WHERE step_address IS NULL
      AND pipeline IS NOT NULL
      AND step IS NOT NULL
"""

_PENDING_BACKFILL = """
    SELECT 1 FROM run_records
    WHERE step_address IS NULL AND pipeline IS NOT NULL AND step IS NOT NULL
    LIMIT 1
"""

# The ledger of one-off data migrations already applied to this file. A row is
# written in the same transaction as the migration it names, so a crash part-way
# leaves no row and the migration is simply retried on the next open.
_CREATE_MIGRATIONS = """
    CREATE TABLE IF NOT EXISTS registry_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
    )
"""
_STEP_ADDRESS_BACKFILL = "step_address_backfill"


class RunRegistry:
    """A queryable SQLite store of ingested RunLog records."""

    def __init__(
        self, db_path: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        self._db_path = Path(db_path)
        self._busy_timeout_ms = busy_timeout_ms
        self._migrated = False

    def _connect(self):
        """Open a connection, migrating the file once per instance.

        Opening and migrating are separate jobs. Migration is DDL plus a
        one-off backfill — write work — and running it on every connection made
        every read take a write lock: with the rollback journal (WAL is
        unavailable on a network share) a writer's lock is exclusive, so a
        read-only operator query briefly locked the registry against every
        running pipeline. Now a connection is just a connection, and the
        migration is attempted once per instance.
        """
        if not self._migrated:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        if not self._migrated:
            self._migrate(con)
            self._migrated = True
        return con

    def _migrate(self, con) -> None:
        """Bring the file up to the declared shape; write only if it is behind.

        A registry DB created before a field joined the record schema lacks its
        column, and the INSERT names every declared one. Whatever is missing is
        added in place rather than the table re-created — the store lives on a
        shared drive and is not disposable. Nothing here writes when the file is
        already current, so the common path takes no write lock at all.

        The ``step_address`` backfill is the one statement that touches existing
        rows, so it is remembered rather than repeated. Gating it on "was the
        column just added?" alone would be wrong: a process that added the
        column and then died before the backfill committed would leave those
        rows NULL forever and address-based freshness lookups silently blind. So
        the backfill is instead gated on a ledger row written in the *same*
        transaction — until that row exists the work is considered outstanding,
        and a file that still has rows awaiting an address gets them.
        """
        con.execute(_CREATE_RUN_RECORDS)
        con.execute(_CREATE_INGEST_PROGRESS)
        con.execute(_CREATE_MIGRATIONS)
        added = ensure_columns(con, _TABLE, RUN_RECORD_COLUMNS)
        if not _migration_applied(con, _STEP_ADDRESS_BACKFILL):
            # The probe is what catches a file whose column arrived in an
            # earlier, interrupted attempt. It is skipped once the ledger row
            # exists, so a current file never scans the table to open it.
            if "step_address" in added or con.execute(_PENDING_BACKFILL).fetchone():
                con.execute(_BACKFILL_STEP_ADDRESS)
            _mark_migration_applied(con, _STEP_ADDRESS_BACKFILL)
            con.commit()

    def ingest(self, log_path: str | os.PathLike[str]) -> int:
        """Load a RunLog JSONL file into the store; return the count of new records.

        Incremental (high-water-mark) ingest
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        The byte offset of the last fully consumed line is persisted in the
        ``ingest_progress`` table, keyed by the normalised absolute path of the
        log file.  On each call only the *new tail* is read, so cost is
        proportional to new records rather than total history.

        Truncation / rotation
            If the file is shorter than the stored offset, the file has been
            rotated or replaced.  The offset is reset to 0 and the whole file
            is re-read from the top.  ``INSERT OR IGNORE`` on the primary key
            ``(pipeline_run_id, step, step_ordinal)`` guarantees idempotency — no
            row is double-counted even if a later ingest revisits earlier content.

        Partial-line safety
            The tail is read in binary mode so byte positions are not distorted
            by newline translation on Windows (CRLF/LF).  Only lines terminated
            by ``\\n`` are parsed; a trailing fragment without a final ``\\n``
            means the writer is still mid-append.  That fragment is left for the
            next call: the stored offset advances only through the last complete
            line (the last ``\\n`` in the tail).  Blank lines are skipped but
            their bytes do count toward the consumed offset.

        Ordinal seeding across the boundary
            ``step_ordinal`` is the zero-based position of a record among all
            records sharing the same ``(pipeline_run_id, step)`` in the file.  When
            ingesting only the tail, a naïve empty ``seen`` dict would restart
            ordinal numbering from 0, colliding with rows already in the DB.
            To prevent silent drops via ``INSERT OR IGNORE``, the distinct
            ``pipeline_run_id`` values appearing in the tail are looked up in
            ``run_records`` first, and the ``seen`` dict is pre-seeded with
            ``MAX(step_ordinal) + 1`` per ``(pipeline_run_id, step)`` so tail
            records continue from the correct next ordinal.

        The new offset and the inserted records are committed in the same
        transaction so a crash leaves the DB in a consistent, re-ingestion-safe
        state.
        """
        path = Path(log_path)
        norm_path = os.fspath(path.resolve())
        con = self._connect()
        try:
            # --- look up (or default) the stored byte offset ---
            row = con.execute(
                "SELECT byte_offset FROM ingest_progress WHERE log_path = ?",
                (norm_path,),
            ).fetchone()
            offset = row[0] if row else 0

            # --- truncation / rotation guard ---
            file_size = path.stat().st_size
            if file_size < offset:
                offset = 0

            # --- read the tail in binary mode ---
            with path.open("rb") as fh:
                fh.seek(offset)
                tail = fh.read()

            # Only consume through the last complete line (terminated by \n).
            last_newline = tail.rfind(b"\n")
            if last_newline == -1:
                # No complete line in the tail — nothing to process.
                return 0
            consumed = tail[: last_newline + 1]
            new_offset = offset + len(consumed)

            # --- decode lines (strip \r to handle CRLF on Windows) ---
            raw_lines = [
                chunk.rstrip(b"\r").decode("utf-8") for chunk in consumed.split(b"\n")
            ]

            # --- collect pipeline_run_ids in the tail for ordinal seeding ---
            tail_records: list[dict] = []
            tail_run_ids: set[str] = set()
            for raw in raw_lines:
                if not raw.strip():
                    continue
                rec = json.loads(raw)
                tail_records.append(rec)
                tail_run_ids.add(rec["pipeline_run_id"])

            # --- seed seen dict from existing DB rows for those run ids ---
            seen: dict[tuple[str, str], int] = {}
            if tail_run_ids:
                placeholders = ",".join("?" * len(tail_run_ids))
                rows = con.execute(
                    f"""
                    SELECT pipeline_run_id, step, MAX(step_ordinal) + 1
                    FROM run_records
                    WHERE pipeline_run_id IN ({placeholders})
                    GROUP BY pipeline_run_id, step
                    """,
                    tuple(tail_run_ids),
                ).fetchall()
                for pipeline_run_id, step, next_ordinal in rows:
                    seen[(pipeline_run_id, step)] = next_ordinal

            # --- insert tail records ---
            inserted = 0
            for rec in tail_records:
                key = (rec["pipeline_run_id"], rec["step"])
                ordinal = seen.get(key, 0)
                seen[key] = ordinal + 1
                # The two columns the store owns rather than the log: the
                # ordinal, and the address a legacy record predates.
                values = {
                    **rec,
                    "step_address": _step_address(rec),
                    "step_ordinal": ordinal,
                }
                cur = con.execute(
                    _INSERT_RUN_RECORD,
                    tuple(f.to_sql(values.get(f.name)) for f in RUN_RECORD_COLUMNS),
                )
                inserted += cur.rowcount

            # --- upsert high-water mark in the same transaction ---
            con.execute(
                """
                INSERT INTO ingest_progress (log_path, byte_offset)
                VALUES (?, ?)
                ON CONFLICT(log_path) DO UPDATE SET byte_offset = excluded.byte_offset
                """,
                (norm_path, new_offset),
            )
            con.commit()
            return inserted
        finally:
            con.close()

    def records_for_run(self, pipeline_run_id: str) -> list[dict]:
        """Every step record of one pipeline run, in execution (ingest) order."""
        return self._select(
            "WHERE pipeline_run_id = ? ORDER BY timestamp, rowid", (pipeline_run_id,)
        )

    def query_runs(
        self, pipeline: str | None = None, status: str | None = None
    ) -> list[dict]:
        """The run summaries (one per run), oldest first, optionally narrowed.

        Only the ``run`` summary record is returned — the operator's headline row
        per run (overall status, totals, aggregated warn-hits). ``pipeline`` and
        ``status`` narrow the result; ordering is by emit ``timestamp``.
        """
        clauses = ["step = 'run'"]
        params: list[object] = []
        if pipeline is not None:
            clauses.append("pipeline = ?")
            params.append(pipeline)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        where = "WHERE " + " AND ".join(clauses) + " ORDER BY timestamp, rowid"
        return self._select(where, tuple(params))

    def records_for_address(self, address: str) -> list[dict]:
        """Every record for a stable pipeline/step address, oldest first."""
        return self._select(
            "WHERE step_address = ? ORDER BY timestamp, rowid", (address,)
        )

    def has_successful_address(self, address: str) -> bool:
        """Whether the address has at least one successful ingested record."""
        con = self._connect()
        try:
            row = con.execute(
                """
                SELECT 1 FROM run_records
                WHERE step_address = ? AND status = 'ok'
                LIMIT 1
                """,
                (address,),
            ).fetchone()
            return row is not None
        finally:
            con.close()

    def latest_success(
        self,
        address: "RunAddress | str",
        *,
        on: date | None = None,
        on_or_after: date | None = None,
    ) -> dict | None:
        """Latest successful record for a pipeline or step address.

        Date filters are based on the run-log record ``timestamp`` date.
        Whole-pipeline addresses match the ``run`` summary record; step/task
        addresses match successful non-``run`` records for that step.
        """
        from framework.run.address import RunAddress

        if on is not None and on_or_after is not None:
            raise ValueError("Pass either on or on_or_after, not both")
        target = RunAddress.parse(address) if isinstance(address, str) else address
        clauses = ["step_address = ?", "status = 'ok'"]
        params: list[object] = [target.label]
        if target.step is None:
            clauses.append("step = 'run'")
        else:
            clauses.append("step != 'run'")
        if on is not None:
            clauses.append("timestamp >= ? AND timestamp < ?")
            params.extend((_start_of_day(on), _start_of_next_day(on)))
        if on_or_after is not None:
            clauses.append("timestamp >= ?")
            params.append(_start_of_day(on_or_after))
        rows = self._select(
            "WHERE "
            + " AND ".join(clauses)
            + " ORDER BY timestamp DESC, rowid DESC LIMIT 1",
            tuple(params),
        )
        return rows[0] if rows else None

    def runs_that_warned(self) -> list[dict]:
        """Run summaries that tolerated a warn-severity breach, oldest first.

        A warn-severity breach keeps the run ``ok`` but carries its message on
        the summary's ``warn_hits``. The empty ``[]`` is stored as literal JSON
        text, so a warned run is one whose ``warn_hits`` column is neither null
        nor ``'[]'``.
        """
        return self._select(
            "WHERE step = 'run' AND warn_hits IS NOT NULL AND warn_hits != '[]' "
            "ORDER BY timestamp, rowid",
            (),
        )

    def latest_run_per_pipeline(self) -> list[dict]:
        """The most recent run summary for each pipeline — one row per pipeline.

        "Latest" is by emit ``timestamp`` (``rowid`` breaks an exact tie), so the
        answer to "did last night's run for pipeline X succeed?" is a single row
        per X.
        """
        return self._select(
            """
            WHERE step = 'run' AND rowid = (
                SELECT rowid FROM run_records inner_r
                WHERE inner_r.step = 'run'
                  AND inner_r.pipeline = run_records.pipeline
                ORDER BY timestamp DESC, rowid DESC LIMIT 1
            )
            ORDER BY pipeline
            """,
            (),
        )

    def recent_row_counts(
        self, pipeline: str, limit: int = 10, step: str = "read"
    ) -> list[int]:
        """Read-step volumes of recent *successful* runs of ``pipeline``, newest first.

        The baseline source for volume checks: the row count each of the last
        ``limit`` runs read, most-recent-first. Only runs whose summary closed
        ``ok`` count — an aborted run must not poison the baseline it derives.
        ``step`` selects which step's ``rows_out`` is the feed's "volume"; it
        defaults to ``read`` (the just-ingested source count, before any
        processing).
        """
        con = self._connect()
        try:
            cur = con.execute(
                """
                SELECT r.rows_out
                FROM run_records r
                WHERE r.pipeline = ? AND r.step = ? AND r.rows_out IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM run_records s
                      WHERE s.pipeline_run_id = r.pipeline_run_id
                        AND s.step = 'run' AND s.status = 'ok'
                  )
                ORDER BY r.timestamp DESC, r.rowid DESC
                LIMIT ?
                """,
                (pipeline, step, limit),
            )
            return [row[0] for row in cur.fetchall()]
        finally:
            con.close()

    def recent_profiles(self, address: str, limit: int = 10) -> list[dict]:
        """Per-column profiles of recent *successful* runs at ``address``, newest first.

        The baseline source for :class:`~tools.observability.profile.ProfileDriftCheck`
        — the statistical analogue of :meth:`recent_row_counts`. Each entry is the
        decoded ``DatasetProfile`` record a profile step recorded at the stable
        ``step_address``; only runs whose summary closed ``ok`` count, so an
        aborted run never poisons the baseline it derives. Newest-first, capped at
        ``limit``.
        """
        con = self._connect()
        try:
            cur = con.execute(
                """
                SELECT r.profile
                FROM run_records r
                WHERE r.step_address = ? AND r.profile IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM run_records s
                      WHERE s.pipeline_run_id = r.pipeline_run_id
                        AND s.step = 'run' AND s.status = 'ok'
                  )
                ORDER BY r.timestamp DESC, r.rowid DESC
                LIMIT ?
                """,
                (address, limit),
            )
            return [json.loads(row[0]) for row in cur.fetchall()]
        finally:
            con.close()

    def _select(self, where: str, params: tuple) -> list[dict]:
        """Run a SELECT over run_records and decode each row to a record dict."""
        con = self._connect()
        try:
            cur = con.execute(f"SELECT * FROM run_records {where}", params)
            cols = [d[0] for d in cur.description]
            return [_row_to_record(dict(zip(cols, row))) for row in cur.fetchall()]
        finally:
            con.close()


def _row_to_record(row: dict) -> dict:
    """Decode a stored row back to the record the RunLog wrote.

    Each field decodes itself — the JSON-encoded lists back to lists, the 0/1
    artifact marker back to a bool — so the read path cannot fall behind the
    write path. Reading by name (rather than position) keeps a migrated store
    correct: its added columns sit at the end of the physical table.
    """
    return {**row, **{f.name: f.from_sql(row.get(f.name)) for f in RUN_RECORD_COLUMNS}}


def _migration_applied(con, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM registry_migrations WHERE name = ?", (name,)
    ).fetchone()
    return row is not None


def _mark_migration_applied(con, name: str) -> None:
    con.execute(
        "INSERT OR IGNORE INTO registry_migrations (name, applied_at) VALUES (?, ?)",
        (name, utc_now_iso()),
    )


def _start_of_day(value: date) -> str:
    """The lower bound of a run date, in the shape the stored column carries.

    A run date is a *local* calendar date and a stored timestamp is a UTC
    instant, so the bound is local midnight expressed as UTC — and formatted
    exactly as the emitter formats a record, so SQLite's text comparison is
    comparing like with like rather than relying on a naive string happening to
    sort next to an offset-bearing one.
    """
    return start_of_local_day(value)


def _start_of_next_day(value: date) -> str:
    return start_of_local_day(value + timedelta(days=1))


def _step_address(rec: dict) -> str | None:
    address = rec.get("step_address")
    if address:
        return address
    pipeline = rec.get("pipeline")
    step = rec.get("step")
    if not pipeline or not step:
        return None
    if step == "run":
        return pipeline
    return f"{pipeline}.{step}"
