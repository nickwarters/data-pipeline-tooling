"""Where a polled source got to, and the rule that turns that into the next ask.

A source that is *asked for* repeatedly over time rather than handed over as a
file (``CONTEXT.md``: a **Polling Feed**) needs two things that no Reader, Writer
or run record provides: a durable **watermark** recording how far it has been
polled, and a **rule** turning that watermark into the next span to fetch. This
module is the home of both, for every such source.

**The store** keeps one row per source under ``<base_dir>/_checkpoints/
sources.db``, keyed by the source's stable key. Reading a watermark never
writes — an unseen source reads as ``None`` and brings no file into existence —
and :meth:`SourceCheckpointStore.commit` is the **last act of a successful
run**: nothing else advances a watermark, so a run that failed part-way simply
re-polls the same span next time, and a dry run commits nothing.

**The rule** is :func:`instant_window`, pure, and handed the committed watermark
rather than reading it from the store: the store has no business knowing about
overlaps and lags, which belong to the source being polled.

**A run's time is never a source's watermark.** The run registry knows when a
pipeline last succeeded; that is a fact about this box's clock. A watermark is a
fact about the source, stamped by the source's clock, and only advanced once
what it vouches for has been published. Under a failed run the two diverge, and
the watermark is the one that is right.

**"Checkpoint" here is not the pipeline sense.** A ``Pipeline`` checkpoint is a
mid-graph ``.write()`` node landing an intermediate dataset for lineage. This one
is **source control state**: how far a source has been polled, kept in its own
file beside the run metadata rather than inside it.
"""

from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass
from pathlib import Path

from framework._internal.connection import connect
from tools.observability.timestamps import utc_now_iso

__all__ = ["InstantWindow", "SourceCheckpointStore", "instant_window"]


@dataclass(frozen=True)
class InstantWindow:
    """The half-open ``[start, end)`` span of source time to fetch this run.

    ``start=None`` is the first-load shape: everything the source holds strictly
    before ``end``, with no lower bound. Both bounds must be timezone-aware — a
    naive datetime has no single UTC meaning, and silently reading it as the
    local zone would shift the span by whatever offset the reading machine
    happens to be in.
    """

    start: dt.datetime | None
    end: dt.datetime

    def __post_init__(self) -> None:
        for name, bound in (("start", self.start), ("end", self.end)):
            if bound is not None and bound.tzinfo is None:
                raise ValueError(
                    f"InstantWindow.{name} must be timezone-aware; "
                    f"got a naive datetime ({bound.isoformat()})"
                )
        if self.start is not None and self.start >= self.end:
            raise ValueError(
                f"InstantWindow.start ({self.start.isoformat()}) must be before "
                f"end ({self.end.isoformat()})"
            )


def instant_window(
    committed: dt.datetime | None,
    *,
    source_now: dt.datetime,
    overlap: dt.timedelta,
    safety_lag: dt.timedelta,
) -> InstantWindow | None:
    """The next span to ask a source for, or ``None`` when nothing is safe to ask.

    In three lines: ``end = source_now - safety_lag``; ``start = committed -
    overlap``, or ``None`` when nothing has been committed (a first load fetches
    everything up to ``end``); and no window at all when ``end`` has not
    advanced past ``committed`` — a run repeated too soon, which is ordinary
    operation rather than a failure.

    ``committed`` is where the last successful run got to, exactly as
    :meth:`SourceCheckpointStore.watermark` hands it back. ``source_now`` is the
    **source's** clock, read this run, never this box's: the span bounds a
    predicate the *source* evaluates, so a skewed local clock would silently
    widen or narrow it. The **overlap** re-reads a little of what the previous
    span already covered, which is safe when the landing is idempotent and
    necessary because a row can be stamped inside a span and still miss the read
    that fetched it. The **safety lag** holds ``end`` behind the source's clock
    for the same reason from the other side.

    Pure, so it can be called in a debugger with made-up instants to see exactly
    which span a given state would produce.
    """
    source_now = _require_utc_instant(source_now, "source_now")
    overlap = _require_non_negative(overlap, "overlap")
    safety_lag = _require_non_negative(safety_lag, "safety_lag")
    end = source_now - safety_lag
    if committed is None:
        return InstantWindow(start=None, end=end)
    committed = _require_utc_instant(committed, "committed")
    if end <= committed:
        return None
    return InstantWindow(start=committed - overlap, end=end)


_CREATE_CHECKPOINTS = """
    CREATE TABLE IF NOT EXISTS source_checkpoints (
        source_key       TEXT PRIMARY KEY,
        watermark_utc    TEXT NOT NULL,
        batch_id         TEXT NOT NULL,
        pipeline_run_id  TEXT NOT NULL,
        committed_at_utc TEXT NOT NULL
    )
"""

_UPSERT_CHECKPOINT = """
    INSERT INTO source_checkpoints (
        source_key, watermark_utc, batch_id, pipeline_run_id, committed_at_utc
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
        watermark_utc    = excluded.watermark_utc,
        batch_id         = excluded.batch_id,
        pipeline_run_id  = excluded.pipeline_run_id,
        committed_at_utc = excluded.committed_at_utc
"""

_SELECT_WATERMARK = "SELECT watermark_utc FROM source_checkpoints WHERE source_key = ?"

_TABLE_EXISTS = (
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'source_checkpoints'"
)


class SourceCheckpointStore:
    """The durable watermark per source, under ``<base_dir>/_checkpoints/sources.db``.

    A source is named by a **stable** key — a SharePoint list's GUID, a table's
    qualified name — never a display name, because keying on something that can
    be renamed forks the checkpoint the moment somebody renames it, with the new
    key looking like a first load. A source with key hygiene of its own
    (``SharePointSource``) builds its key; one without passes a plain string.
    """

    def __init__(
        self, base_dir: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        self._base_dir = Path(base_dir)
        self._busy_timeout_ms = busy_timeout_ms

    @property
    def path(self) -> Path:
        """The control-state file: ``<base_dir>/_checkpoints/sources.db``."""
        return self._base_dir / "_checkpoints" / "sources.db"

    def watermark(self, source_key: str) -> dt.datetime | None:
        """Where ``source_key`` was last committed to, or ``None`` if never.

        A read never writes: an absent file stays absent and an absent table
        stays absent, so asking where a feed got to cannot itself create the
        control state (nor take a write lock to do it).
        """
        if not self.path.exists():
            return None
        con = connect(self.path, self._busy_timeout_ms)
        try:
            if con.execute(_TABLE_EXISTS).fetchone() is None:
                return None
            row = con.execute(_SELECT_WATERMARK, (source_key,)).fetchone()
        finally:
            con.close()
        return dt.datetime.fromisoformat(row[0]) if row else None

    def commit(
        self,
        source_key: str,
        window_end: dt.datetime,
        *,
        batch_id: str,
        pipeline_run_id: str,
    ) -> None:
        """Advance ``source_key``'s watermark to ``window_end``, with its provenance.

        The **last act of a successful run**, and the only thing that moves a
        source forward: nothing else advances a watermark, so a run that failed
        part-way simply re-polls the same span next time.

        An equal ``window_end`` is accepted — not advancing is not going
        backwards — and refreshes the provenance columns, so repeating an
        identical commit is a no-op in effect. An *earlier* one raises: a
        watermark that moved backwards would quietly re-poll covered ground and
        hide the fact that a run lost its place.

        ``batch_id`` is opaque provenance, handed in rather than derived here;
        the caller owns what a batch is.
        """
        end = _require_utc_instant(window_end, "window_end")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self.path, self._busy_timeout_ms)
        try:
            con.execute(_CREATE_CHECKPOINTS)
            # BEGIN IMMEDIATE puts the monotonicity read inside the write
            # transaction, so a concurrent committer cannot slip a newer
            # watermark in between the SELECT and the upsert. It has to come
            # before any DML on this connection: sqlite3 opens its own implicit
            # transaction at the first write statement, and BEGIN would then
            # fail as a nested one.
            con.execute("BEGIN IMMEDIATE")
            row = con.execute(_SELECT_WATERMARK, (source_key,)).fetchone()
            if row is not None:
                stored = dt.datetime.fromisoformat(row[0])
                if end < stored:
                    raise ValueError(
                        f"checkpoint for {source_key} must not move backwards: "
                        f"committed {stored.isoformat()}, "
                        f"asked to commit {end.isoformat()}"
                    )
            con.execute(
                _UPSERT_CHECKPOINT,
                (source_key, end.isoformat(), batch_id, pipeline_run_id, utc_now_iso()),
            )
            con.commit()
        finally:
            con.close()


def _require_utc_instant(value: dt.datetime, name: str) -> dt.datetime:
    """One instant, converted to UTC once; a naive one is refused.

    Strict rather than lenient on purpose: a naive datetime has no single UTC
    meaning, and reading it as the local zone would move a persisted watermark
    by whatever offset the running box happens to be in.
    """
    if value.tzinfo is None:
        raise ValueError(
            f"{name} must be timezone-aware; got a naive datetime ({value.isoformat()})"
        )
    return value.astimezone(dt.timezone.utc)


def _require_non_negative(value: dt.timedelta, name: str) -> dt.timedelta:
    """A span offset that points the way it is meant to.

    A negative ``safety_lag`` would read past the source's own clock; a negative
    ``overlap`` would leave a permanent gap between consecutive spans that no
    later run ever covers.
    """
    if value < dt.timedelta(0):
        raise ValueError(f"{name} must not be negative; got {value}")
    return value
