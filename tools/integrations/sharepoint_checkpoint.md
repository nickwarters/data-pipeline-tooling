```python
"""Where one SharePoint list's ``Modified`` polling got to, and where to go next.

:class:`~tools.integrations.sharepoint_rest.SharePointModifiedReader` is handed a
window and never computes one. This module is the other half of that split: the
durable watermark a run commits, and the pure rule that turns it plus SharePoint's
own clock into the next window to ask for.

**The window rule**, in three lines: ``end = server_now - safety_lag``;
``start = committed_watermark - overlap``, or ``None`` when nothing has been
committed (the first run fetches the full current list); and the whole window is
``None`` when ``end`` has not advanced past the committed watermark — a run
repeated too soon, which is ordinary operation rather than a failure.

**"Checkpoint" here is not the pipeline sense.** A `Pipeline` checkpoint is a
mid-graph ``.write()`` node that lands an intermediate dataset for lineage. This
one is **polling state**: how far a source has been polled, kept in its
own file beside the run metadata rather than inside it.

Why the lag, why the overlap, why the list GUID keys a watermark, and how a run
wires the two halves together: see ``docs/adding-a-feed.md``.
"""

from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from framework._internal.connection import connect
from tools.integrations.sharepoint_rest import ModifiedWindow
from tools.observability.timestamps import utc_now_iso

__all__ = ["SharePointCheckpointStore", "SharePointSource"]

# ``site`` and ``list_id`` restate what ``source_key`` concatenates; they are
# stored anyway so an operator can query the table by either on its own.
_CREATE_CHECKPOINTS = """
    CREATE TABLE IF NOT EXISTS sharepoint_checkpoints (
        source_key         TEXT PRIMARY KEY,
        site               TEXT NOT NULL,
        list_id            TEXT NOT NULL,
        watermark_utc      TEXT NOT NULL,
        ingestion_batch_id TEXT NOT NULL,
        pipeline_run_id    TEXT NOT NULL,
        committed_at_utc   TEXT NOT NULL
    )
"""

_UPSERT_CHECKPOINT = """
    INSERT INTO sharepoint_checkpoints (
        source_key, site, list_id, watermark_utc,
        ingestion_batch_id, pipeline_run_id, committed_at_utc
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
        site               = excluded.site,
        list_id            = excluded.list_id,
        watermark_utc      = excluded.watermark_utc,
        ingestion_batch_id = excluded.ingestion_batch_id,
        pipeline_run_id    = excluded.pipeline_run_id,
        committed_at_utc   = excluded.committed_at_utc
"""

_SELECT_WATERMARK = (
    "SELECT watermark_utc FROM sharepoint_checkpoints WHERE source_key = ?"
)

_TABLE_EXISTS = (
    "SELECT 1 FROM sqlite_master "
    "WHERE type = 'table' AND name = 'sharepoint_checkpoints'"
)


@dataclass(frozen=True)
class SharePointSource:
    """One pollable SharePoint list: a site, and the list's stable GUID."""

    site: str
    list_id: UUID

    @property
    def key(self) -> str:
        """The identity the watermark is stored under."""
        return f"{_keyed_site(self.site)}|{self.list_id}"


class SharePointCheckpointStore:
    """The durable ``Modified`` watermark per list, and the window rule over it."""

    def __init__(
        self, base_dir: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        self._base_dir = Path(base_dir)
        self._busy_timeout_ms = busy_timeout_ms

    @property
    def path(self) -> Path:
        """The control-state file: ``<base_dir>/_checkpoints/sharepoint.db``."""
        return self._base_dir / "_checkpoints" / "sharepoint.db"

    def committed_watermark(self, source: SharePointSource) -> dt.datetime | None:
        """The last committed window end for ``source``, or ``None`` if unseen.

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
            row = con.execute(_SELECT_WATERMARK, (source.key,)).fetchone()
        finally:
            con.close()
        return dt.datetime.fromisoformat(row[0]) if row else None

    def window(
        self,
        source: SharePointSource,
        *,
        server_now: dt.datetime,
        overlap: dt.timedelta,
        safety_lag: dt.timedelta,
    ) -> ModifiedWindow | None:
        """The next window to poll ``source`` for, or ``None`` if there is none.

        ``end`` is ``server_now`` held back by ``safety_lag``; ``start`` is the
        committed watermark pulled back by ``overlap``, or ``None`` on a first
        run. ``None`` is returned when the safe upper bound has not yet advanced
        past the watermark — the run-again-too-soon case, which is routine.

        ``server_now`` is SharePoint's clock, not this box's: the window bounds a
        predicate the *list* evaluates, so a skewed local clock would silently
        widen or narrow it.
        """
        server_now = _require_utc_instant(server_now, "server_now")
        overlap = _require_non_negative(overlap, "overlap")
        safety_lag = _require_non_negative(safety_lag, "safety_lag")
        end = server_now - safety_lag
        committed = self.committed_watermark(source)
        if committed is not None:
            if end <= committed:
                return None
            return ModifiedWindow(start=committed - overlap, end=end)
        return ModifiedWindow(start=None, end=end)

    def commit(
        self,
        source: SharePointSource,
        *,
        window_end: dt.datetime,
        ingestion_batch_id: str,
        pipeline_run_id: str,
    ) -> None:
        """Advance ``source``'s watermark to ``window_end``, with its provenance.

        The **last act of a successful run**, and the only thing that moves a
        feed forward: nothing else advances the watermark, so a run that failed
        part-way simply re-polls the same window next time.

        An equal ``window_end`` is accepted — not advancing is not going
        backwards — and refreshes the provenance columns, so repeating an
        identical commit is a no-op in effect. An *earlier* one raises: a
        watermark that moved backwards would quietly re-poll covered ground and
        hide the fact that a run lost its place.

        ``ingestion_batch_id`` is opaque provenance, handed in rather than
        derived here; the caller owns what a batch is.
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
            row = con.execute(_SELECT_WATERMARK, (source.key,)).fetchone()
            if row is not None:
                stored = dt.datetime.fromisoformat(row[0])
                if end < stored:
                    raise ValueError(
                        f"SharePoint checkpoint for {source.key} must not move "
                        f"backwards: committed {stored.isoformat()}, "
                        f"asked to commit {end.isoformat()}"
                    )
            con.execute(
                _UPSERT_CHECKPOINT,
                (
                    source.key,
                    _keyed_site(source.site),
                    str(source.list_id),
                    end.isoformat(),
                    ingestion_batch_id,
                    pipeline_run_id,
                    utc_now_iso(),
                ),
            )
            con.commit()
        finally:
            con.close()


def _keyed_site(site: str) -> str:
    """The site as it is persisted and keyed: no trailing ``/``, no userinfo.

    Rebuilding the netloc from ``hostname`` drops both the ``user:pass@`` and the
    bare ``user@`` form, so a site addressed with and without one is a single
    source. The host folds to lower case with it, which DNS agrees with; the path
    does not, because a site path's case is the tenant's business and two
    spellings may be two addresses.
    """
    parts = urlsplit(site.rstrip("/"))
    host = parts.hostname or ""
    netloc = f"{host}:{parts.port}" if parts.port else host
    return parts._replace(netloc=netloc).geturl()


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
    """A window offset that points the way it is meant to.

    A negative ``safety_lag`` would read past SharePoint's own clock; a negative
    ``overlap`` would leave a permanent gap between consecutive windows that no
    later run ever covers.
    """
    if value < dt.timedelta(0):
        raise ValueError(f"{name} must not be negative; got {value}")
    return value

```
