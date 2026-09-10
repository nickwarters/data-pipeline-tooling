"""Where a polled source got to, and the rule that turns that into the next ask.

A source that is *asked for* repeatedly over time rather than handed over as a
file (``CONTEXT.md``: a **Polling Feed**) needs two things that no Reader, Writer
or run record provides: a durable **position** recording how far it has been
polled, and a **rule** turning that position into the next span to fetch. This
module is the home of both, for every such source.

**The position** is a :class:`Position` — today only :class:`Instant`, a UTC
datetime, which is what a ``Modified`` or ``created_at`` window commits. A kind
of position realises its own encoding and its own "may I advance to this"
check, the way a load strategy realises its own Writer, so the store branches on
nothing and another kind is one class plus one entry in :data:`POSITION_KINDS`.

**The store** keeps one row per source under ``<base_dir>/_checkpoints/
sources.db``, keyed by the source's ``kind`` and ``key``. Reading a position
never writes — an unseen source reads as ``None`` and brings no file into
existence — and :meth:`SourceCheckpointStore.commit` is the **last act of a
successful run**: nothing else advances a position, so a run that failed
part-way simply re-polls the same span next time, and a dry run commits
nothing.

**The rule** is :func:`instant_window`, pure, and handed the committed instant
rather than reading it from the store: the store has no business knowing about
overlaps and lags, which belong to the source being polled.

**A run's time is never a source's position.** The run registry knows when a
pipeline last succeeded; that is a fact about this box's clock. A position is a
fact about the source, stamped by the source's clock, and only advanced once
what it vouches for has been published. Under a failed run the two diverge, and
the position is the one that is right.

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
from typing import ClassVar, Protocol, runtime_checkable

from framework._internal.connection import connect
from tools.observability.timestamps import utc_now_iso

__all__ = [
    "POSITION_KINDS",
    "Instant",
    "InstantWindow",
    "Position",
    "Source",
    "SourceCheckpointStore",
    "SourceIdentity",
    "instant_window",
]


# --- what a source is -----------------------------------------------------------


@runtime_checkable
class SourceIdentity(Protocol):
    """What the store keys a position on: a ``kind`` and a ``key`` within it.

    ``kind`` names the family (``"sharepoint-list"``, ``"sql-table"``); ``key``
    is the source's **stable** identity within that family — a list's GUID, a
    table's qualified name — never a display name, because keying on something
    that can be renamed forks the checkpoint the moment somebody renames it, with
    the new key looking like a first load. A source with hygiene of its own (a
    SharePoint site URL to strip credentials from) declares its own class with
    these two attributes; one without uses :class:`Source`.
    """

    @property
    def kind(self) -> str: ...

    @property
    def key(self) -> str: ...


@dataclass(frozen=True)
class Source:
    """A plain source identity: the ``kind`` and stable ``key`` and nothing else."""

    kind: str
    key: str

    def __post_init__(self) -> None:
        for name, value in (("kind", self.kind), ("key", self.key)):
            if not value:
                raise ValueError(f"Source.{name} must not be empty")


# --- what a position is -----------------------------------------------------------


@runtime_checkable
class Position(Protocol):
    """Where a source has been polled to, in whatever terms that source keeps.

    Each kind knows how to write itself down, read itself back, and whether a
    proposed successor is a legitimate advance — so the store persists text and
    branches on nothing. ``kind`` is the discriminator stored beside the text.
    """

    kind: ClassVar[str]

    def encode(self) -> str: ...

    @classmethod
    def decode(cls, text: str) -> "Position": ...

    def may_advance_to(self, successor: "Position") -> bool: ...


@dataclass(frozen=True)
class Instant:
    """A position in source time: one UTC instant, normally a window's ``end``.

    Converted to UTC once, at construction; a naive datetime is refused rather
    than read as the local zone, which would move a persisted position by
    whatever offset the running box happens to be in. Equal to another
    ``Instant`` at the same moment however either was spelled.
    """

    kind: ClassVar[str] = "instant"

    at: dt.datetime

    def __post_init__(self) -> None:
        object.__setattr__(self, "at", _require_utc_instant(self.at, "Instant.at"))

    def encode(self) -> str:
        return self.at.isoformat()

    @classmethod
    def decode(cls, text: str) -> "Instant":
        return cls(dt.datetime.fromisoformat(text))

    def may_advance_to(self, successor: Position) -> bool:
        """Later or equal advances; earlier does not — time does not run backwards."""
        return isinstance(successor, Instant) and successor.at >= self.at


# Every kind of position the store can read back, by its stored discriminator.
# A new kind is one class above plus one entry here.
POSITION_KINDS: dict[str, type[Position]] = {Instant.kind: Instant}


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

    ``committed`` is where the last successful run got to, from the checkpoint
    store. ``source_now`` is the **source's** clock, read this run, never this
    box's: the span bounds a predicate the *source* evaluates, so a skewed local
    clock would silently widen or narrow it. The **overlap** re-reads a little of
    what the previous span already covered, which is safe when the landing is
    idempotent and necessary because a row can be stamped inside a span and
    still miss the read that fetched it. The **safety lag** holds ``end`` behind
    the source's clock for the same reason from the other side.

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


# --- the store --------------------------------------------------------------------

_CREATE_CHECKPOINTS = """
    CREATE TABLE IF NOT EXISTS source_checkpoints (
        kind             TEXT NOT NULL,
        key              TEXT NOT NULL,
        position_kind    TEXT NOT NULL,
        position         TEXT NOT NULL,
        batch_id         TEXT NOT NULL,
        pipeline_run_id  TEXT NOT NULL,
        committed_at_utc TEXT NOT NULL,
        PRIMARY KEY (kind, key)
    )
"""

# One-off changes to this file that must run exactly once, remembered here so a
# crash part-way leaves no row and the change is simply retried on the next
# commit. The run registry keeps the same ledger for the same reason.
_CREATE_MIGRATIONS = """
    CREATE TABLE IF NOT EXISTS checkpoint_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
    )
"""

_UPSERT_CHECKPOINT = """
    INSERT INTO source_checkpoints (
        kind, key, position_kind, position,
        batch_id, pipeline_run_id, committed_at_utc
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, key) DO UPDATE SET
        position_kind    = excluded.position_kind,
        position         = excluded.position,
        batch_id         = excluded.batch_id,
        pipeline_run_id  = excluded.pipeline_run_id,
        committed_at_utc = excluded.committed_at_utc
"""

_SELECT_POSITION = (
    "SELECT position_kind, position FROM source_checkpoints WHERE kind = ? AND key = ?"
)

_TABLE_EXISTS = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"


class SourceCheckpointStore:
    """The durable position per source, under ``<base_dir>/_checkpoints/sources.db``."""

    def __init__(
        self, base_dir: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        self._base_dir = Path(base_dir)
        self._busy_timeout_ms = busy_timeout_ms

    @property
    def path(self) -> Path:
        """The control-state file: ``<base_dir>/_checkpoints/sources.db``."""
        return self._base_dir / "_checkpoints" / "sources.db"

    def position(self, source: SourceIdentity) -> Position | None:
        """Where ``source`` was last committed to, or ``None`` if never.

        A read never writes: an absent file stays absent and an absent table
        stays absent, so asking where a feed got to cannot itself create the
        control state (nor take a write lock to do it). An absent file, an
        absent table and an absent row all mean the same thing.
        """
        row = self._read_row(source)
        if row is not None:
            return _decode(*row)
        if not self._carried_over():
            return _legacy_position(self._legacy_path, source)
        return None

    def commit(
        self,
        source: SourceIdentity,
        position: Position,
        *,
        batch_id: str,
        pipeline_run_id: str,
    ) -> None:
        """Advance ``source`` to ``position``, with its provenance.

        The **last act of a successful run**, and the only thing that moves a
        source forward: nothing else advances a position, so a run that failed
        part-way simply re-polls the same span next time.

        An equal position is accepted — not advancing is not going backwards —
        and refreshes the provenance columns, so repeating an identical commit
        is a no-op in effect. One the stored position will not advance to
        raises: a position that moved backwards would quietly re-poll covered
        ground and hide the fact that a run lost its place. So does a position
        of a different kind, because a source does not change what it is
        measured in.

        ``batch_id`` is opaque provenance, handed in rather than derived here;
        the caller owns what a batch is.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self.path, self._busy_timeout_ms)
        try:
            con.execute(_CREATE_CHECKPOINTS)
            con.execute(_CREATE_MIGRATIONS)
            # BEGIN IMMEDIATE puts the monotonicity read inside the write
            # transaction, so a concurrent committer cannot slip a newer
            # position in between the SELECT and the upsert. It has to come
            # before any DML on this connection: sqlite3 opens its own implicit
            # transaction at the first write statement, and BEGIN would then
            # fail as a nested one.
            con.execute("BEGIN IMMEDIATE")
            _carry_over_legacy(con, self._legacy_path)
            row = con.execute(_SELECT_POSITION, (source.kind, source.key)).fetchone()
            if row is not None:
                stored = _decode(*row)
                if stored.kind != position.kind:
                    raise ValueError(
                        f"checkpoint for {source.kind}:{source.key} is measured in "
                        f"{stored.kind!r}, not {position.kind!r}"
                    )
                if not stored.may_advance_to(position):
                    raise ValueError(
                        f"checkpoint for {source.kind}:{source.key} must not move "
                        f"backwards: committed {stored.encode()}, "
                        f"asked to commit {position.encode()}"
                    )
            con.execute(
                _UPSERT_CHECKPOINT,
                (
                    source.kind,
                    source.key,
                    position.kind,
                    position.encode(),
                    batch_id,
                    pipeline_run_id,
                    utc_now_iso(),
                ),
            )
            con.commit()
        finally:
            con.close()

    def _read_row(self, source: SourceIdentity) -> tuple[str, str] | None:
        if not self.path.exists():
            return None
        con = connect(self.path, self._busy_timeout_ms)
        try:
            if con.execute(_TABLE_EXISTS, ("source_checkpoints",)).fetchone() is None:
                return None
            return con.execute(_SELECT_POSITION, (source.kind, source.key)).fetchone()
        finally:
            con.close()

    def _carried_over(self) -> bool:
        if not self.path.exists():
            return False
        con = connect(self.path, self._busy_timeout_ms)
        try:
            if (
                con.execute(_TABLE_EXISTS, ("checkpoint_migrations",)).fetchone()
                is None
            ):
                return False
            return _migration_applied(con, _CARRY_OVER)
        finally:
            con.close()

    @property
    def _legacy_path(self) -> Path:
        return self._base_dir / "_checkpoints" / _LEGACY_FILE


def _decode(position_kind: str, text: str) -> Position:
    try:
        cls = POSITION_KINDS[position_kind]
    except KeyError:
        raise ValueError(
            f"stored checkpoint has position kind {position_kind!r}, which this "
            f"code does not know (knows: {', '.join(sorted(POSITION_KINDS))})"
        ) from None
    return cls.decode(text)


def _migration_applied(con, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM checkpoint_migrations WHERE name = ?", (name,)
    ).fetchone()
    return row is not None


# --- carry-over from the pre-generic file -------------------------------------------
#
# Before 2026-09 this state was SharePoint's alone, in ``_checkpoints/sharepoint.db``
# with one table of ``Modified`` watermarks keyed on ``site|list-guid``. A base
# directory upgraded in place still has that file, and without what follows its
# first run on this code would read every list as unseen and re-fetch it whole.
# So: until the carry-over is recorded in the new file, a SharePoint list whose
# row the new file lacks is read from the old one; and the first commit copies
# every old row in, inside its own transaction, and records that it did. The old
# file is never deleted — it is somebody's backup until they say otherwise.
# Remove this section once no live base directory carries the old file.

_LEGACY_FILE = "sharepoint.db"
# Must agree with SharePointSource.kind in tools.integrations.sharepoint_rest; a
# test holds the two equal.
_LEGACY_KIND = "sharepoint-list"
_CARRY_OVER = "carry_over_sharepoint_checkpoints"
_INSERT_LEGACY = "INSERT OR IGNORE INTO source_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)"
_SELECT_LEGACY = (
    "SELECT source_key, watermark_utc, ingestion_batch_id, pipeline_run_id, "
    "committed_at_utc FROM sharepoint_checkpoints"
)


def _legacy_position(legacy_path: Path, source: SourceIdentity) -> Position | None:
    if source.kind != _LEGACY_KIND or not legacy_path.exists():
        return None
    con = connect(legacy_path, 5000)
    try:
        if con.execute(_TABLE_EXISTS, ("sharepoint_checkpoints",)).fetchone() is None:
            return None
        row = con.execute(
            "SELECT watermark_utc FROM sharepoint_checkpoints WHERE source_key = ?",
            (source.key,),
        ).fetchone()
    finally:
        con.close()
    return Instant.decode(row[0]) if row else None


def _carry_over_legacy(con, legacy_path: Path) -> None:
    """Copy the old file's rows in, once, inside the caller's transaction."""
    if _migration_applied(con, _CARRY_OVER):
        return
    if legacy_path.exists():
        legacy = connect(legacy_path, 5000)
        try:
            if legacy.execute(_TABLE_EXISTS, ("sharepoint_checkpoints",)).fetchone():
                for key, watermark, batch_id, run_id, committed_at in legacy.execute(
                    _SELECT_LEGACY
                ):
                    con.execute(
                        _INSERT_LEGACY,
                        (
                            _LEGACY_KIND,
                            key,
                            Instant.kind,
                            watermark,
                            batch_id,
                            run_id,
                            committed_at,
                        ),
                    )
        finally:
            legacy.close()
    con.execute(
        "INSERT INTO checkpoint_migrations (name, applied_at) VALUES (?, ?)",
        (_CARRY_OVER, utc_now_iso()),
    )


def _require_utc_instant(value: dt.datetime, name: str) -> dt.datetime:
    """One instant, converted to UTC once; a naive one is refused.

    Strict rather than lenient on purpose: a naive datetime has no single UTC
    meaning, and reading it as the local zone would move a persisted position by
    whatever offset the running box happens to be in.
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
