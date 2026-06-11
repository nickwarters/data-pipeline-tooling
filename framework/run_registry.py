"""The run registry: a query store for structured ``RunLog`` records.

A ``RunLog`` writes one JSON object per step plus a run summary to a ``.log``
file, all sharing a ``run_id``. This module loads those records into its own
queryable SQLite store so operators can answer
"did last night's Ingest for Case Type B succeed, how many rows, did anything
warn?" without grepping free text.

It is a *query* store, not a ``Dataset`` carrier, so it stays stdlib-only
(``json`` + ``sqlite3``) and never touches pandas. It opens through the shared
``connect`` factory in ``framework.connection`` so SQLite settings stay
centralized.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from framework.connection import connect


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
                step_ordinal     INTEGER NOT NULL,
                status           TEXT,
                rows_in          INTEGER,
                rows_out         INTEGER,
                rows_quarantined INTEGER,
                rows_excluded    INTEGER,
                duration         REAL,
                errors           TEXT,
                warn_hits        TEXT,
                PRIMARY KEY (run_id, step, step_ordinal)
            )
            """
        )
        return con

    def ingest(self, log_path: str | os.PathLike[str]) -> int:
        """Load a RunLog JSONL file into the store; return the count of new records.

        Idempotent: re-reading the same file inserts nothing the second time. The
        identity of a record is ``(run_id, step, step_ordinal)`` — the ordinal
        disambiguates the repeated ``process`` step a multi-processor run emits
        (the builder records one ``process`` per processor), which a bare
        ``(run_id, step)`` key would collide. The ordinal is recomputed by
        position on every scan, so it is stable across re-ingests.
        """
        path = Path(log_path)
        con = self._connect()
        try:
            inserted = 0
            seen: dict[tuple[str, str], int] = {}
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue  # tolerate blank lines (e.g. a trailing newline)
                rec = json.loads(line)
                key = (rec["run_id"], rec["step"])
                ordinal = seen.get(key, 0)
                seen[key] = ordinal + 1
                cur = con.execute(
                    """
                    INSERT OR IGNORE INTO run_records (
                        timestamp, run_id, pipeline, step, step_ordinal, status,
                        rows_in, rows_out, rows_quarantined, rows_excluded,
                        duration, errors, warn_hits
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        rec.get("timestamp"),
                        rec["run_id"],
                        rec.get("pipeline"),
                        rec["step"],
                        ordinal,
                        rec.get("status"),
                        rec.get("rows_in"),
                        rec.get("rows_out"),
                        rec.get("rows_quarantined"),
                        rec.get("rows_excluded"),
                        rec.get("duration"),
                        json.dumps(rec.get("errors") or []),
                        json.dumps(rec.get("warn_hits") or []),
                    ),
                )
                inserted += cur.rowcount
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
    return row
