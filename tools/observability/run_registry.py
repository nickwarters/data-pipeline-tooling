"""The run registry: a query store for structured ``RunLog`` records.

A ``RunLog`` writes one JSON object per step plus a run summary to a ``.log``
file, all sharing a ``run_id``. This module loads those records into its own
queryable SQLite store so operators can answer
"did last night's Ingest for Case Type B succeed, how many rows, did anything
warn?" without grepping free text.

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
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from framework._internal.connection import connect

if TYPE_CHECKING:
    from framework.run.address import RunAddress


class RunRegistry:
    """A queryable SQLite store of ingested RunLog records."""

    def __init__(
        self, db_path: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        self._db_path = Path(db_path)
        self._busy_timeout_ms = busy_timeout_ms

    def _connect(self):
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS run_records (
                timestamp        TEXT,
                run_id           TEXT NOT NULL,
                pipeline         TEXT,
                step             TEXT NOT NULL,
                step_address     TEXT,
                step_ordinal     INTEGER NOT NULL,
                status           TEXT,
                rows_in          INTEGER,
                rows_out         INTEGER,
                rows_quarantined INTEGER,
                rows_excluded    INTEGER,
                duration         REAL,
                errors           TEXT,
                error_category   TEXT,
                warn_hits        TEXT,
                committed        INTEGER,
                PRIMARY KEY (run_id, step, step_ordinal)
            )
            """
        )
        # Forward-compatible migration: a registry DB created before the
        # `committed` artifact marker (ADR-0005) lacks the column, and the
        # INSERT below names it. Add it in place rather than forcing a re-create —
        # the store lives on a shared drive (ADR-0001) and is not disposable.
        existing = {row[1] for row in con.execute("PRAGMA table_info(run_records)")}
        if "committed" not in existing:
            con.execute("ALTER TABLE run_records ADD COLUMN committed INTEGER")
        if "step_address" not in existing:
            con.execute("ALTER TABLE run_records ADD COLUMN step_address TEXT")
        con.execute(
            """
            UPDATE run_records
            SET step_address = CASE
                WHEN step = 'run' THEN pipeline
                ELSE pipeline || '.' || step
            END
            WHERE step_address IS NULL
              AND pipeline IS NOT NULL
              AND step IS NOT NULL
            """
        )
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS ingest_progress (
                log_path    TEXT PRIMARY KEY,
                byte_offset INTEGER NOT NULL
            )
            """
        )
        return con

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
            ``(run_id, step, step_ordinal)`` guarantees idempotency — no row is
            double-counted even if a later ingest revisits earlier content.

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
            records sharing the same ``(run_id, step)`` in the file.  When
            ingesting only the tail, a naïve empty ``seen`` dict would restart
            ordinal numbering from 0, colliding with rows already in the DB.
            To prevent silent drops via ``INSERT OR IGNORE``, the distinct
            ``run_id`` values appearing in the tail are looked up in
            ``run_records`` first, and the ``seen`` dict is pre-seeded with
            ``MAX(step_ordinal) + 1`` per ``(run_id, step)`` so tail records
            continue from the correct next ordinal.

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

            # --- collect run_ids in the tail for ordinal seeding ---
            tail_records: list[dict] = []
            tail_run_ids: set[str] = set()
            for raw in raw_lines:
                if not raw.strip():
                    continue
                rec = json.loads(raw)
                tail_records.append(rec)
                tail_run_ids.add(rec["run_id"])

            # --- seed seen dict from existing DB rows for those run_ids ---
            seen: dict[tuple[str, str], int] = {}
            if tail_run_ids:
                placeholders = ",".join("?" * len(tail_run_ids))
                rows = con.execute(
                    f"""
                    SELECT run_id, step, MAX(step_ordinal) + 1
                    FROM run_records
                    WHERE run_id IN ({placeholders})
                    GROUP BY run_id, step
                    """,
                    tuple(tail_run_ids),
                ).fetchall()
                for run_id, step, next_ordinal in rows:
                    seen[(run_id, step)] = next_ordinal

            # --- insert tail records ---
            inserted = 0
            for rec in tail_records:
                key = (rec["run_id"], rec["step"])
                ordinal = seen.get(key, 0)
                seen[key] = ordinal + 1
                cur = con.execute(
                    """
                    INSERT OR IGNORE INTO run_records (
                        timestamp, run_id, pipeline, step, step_address,
                        step_ordinal, status, rows_in, rows_out,
                        rows_quarantined, rows_excluded, duration, errors,
                        error_category, warn_hits, committed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        rec.get("timestamp"),
                        rec["run_id"],
                        rec.get("pipeline"),
                        rec["step"],
                        _step_address(rec),
                        ordinal,
                        rec.get("status"),
                        rec.get("rows_in"),
                        rec.get("rows_out"),
                        rec.get("rows_quarantined"),
                        rec.get("rows_excluded"),
                        rec.get("duration"),
                        json.dumps(rec.get("errors") or []),
                        rec.get("error_category"),
                        json.dumps(rec.get("warn_hits") or []),
                        1 if rec.get("committed") else 0,
                    ),
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

    def records_for_run(self, run_id: str) -> list[dict]:
        """Every step record of one run, in execution (ingest) order."""
        return self._select("WHERE run_id = ? ORDER BY timestamp, rowid", (run_id,))

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
                      WHERE s.run_id = r.run_id
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
    """Decode the JSON-encoded list columns back to lists for the caller."""
    row["errors"] = json.loads(row["errors"]) if row["errors"] else []
    row["warn_hits"] = json.loads(row["warn_hits"]) if row["warn_hits"] else []
    # The artifact marker stores as 0/1 (or null on pre-migration rows); the
    # caller reads the same bool the RunLog wrote.
    row["committed"] = bool(row.get("committed"))
    return row


def _start_of_day(value: date) -> str:
    return datetime.combine(value, datetime.min.time()).isoformat()


def _start_of_next_day(value: date) -> str:
    return datetime.combine(value + timedelta(days=1), datetime.min.time()).isoformat()


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
