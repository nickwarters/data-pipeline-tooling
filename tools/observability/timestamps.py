"""The one place run-metadata time semantics are decided.

Two different clocks meet in the run metadata, and mixing them silently is how a
nightly batch blocks itself on a perfectly fresh upstream:

*Instants* — when a record was emitted — are stamped in **UTC**, timezone-aware,
and stored as ISO-8601 text carrying the explicit ``+00:00`` offset. That is the
on-disk format and it does not change here: it sorts correctly as text and never
depends on the reading machine's zone.

*Calendar dates* — a run date, "did last night's run succeed?" — are **local**.
An operator's "today" is the box's today, and ``run_date`` defaults to the local
``date.today()``.

So every comparison between the two must convert the stored UTC instant into the
**local** calendar date first. On a UK box at UTC+1 an upstream that succeeded at
00:10 local is stamped 23:10 UTC the previous day; taking the UTC date there
would call it stale twenty minutes after it ran.

The same rule applies to the SQL date bounds: a "records on this local date"
filter is the local midnight boundary expressed as a UTC instant in the exact
shape the emitter writes, so the text comparison SQLite performs compares like
with like.

:func:`local_timezone` is the single seam for "which zone is local" — it returns
``None``, meaning the system zone (which handles the summer-time shift per
instant), and tests substitute a fixed offset so the boundary cases can be
pinned without touching the machine's clock.
"""

from __future__ import annotations

import datetime as dt

__all__ = [
    "local_date",
    "local_timezone",
    "parse_timestamp",
    "start_of_local_day",
    "utc_now_iso",
]


def utc_now_iso() -> str:
    """The current instant, as the ISO-8601 UTC text every record is stamped with."""
    return dt.datetime.now(dt.timezone.utc).isoformat()


def local_timezone() -> dt.tzinfo | None:
    """The zone local calendar dates are expressed in; ``None`` is the system's.

    Returning ``None`` rather than a concrete zone is deliberate: the standard
    library then resolves the offset *per instant*, so a comparison spanning a
    summer-time change uses the offset actually in force on that date rather than
    the one in force right now.
    """
    return None


def parse_timestamp(value: str) -> dt.datetime:
    """Parse a stored record timestamp, tolerating a trailing ``Z``."""
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def local_date(value: str | dt.datetime) -> dt.date:
    """The local calendar date of a record timestamp.

    The conversion a freshness check needs: the stored instant is UTC, the run
    date it is compared against is local, so the instant is moved into the local
    zone before its date is taken. A timestamp that carries no offset is already
    read as local wall time.
    """
    moment = parse_timestamp(value) if isinstance(value, str) else value
    return moment.astimezone(local_timezone()).date()


def start_of_local_day(day: dt.date) -> str:
    """Local midnight of ``day``, as a stored-shape UTC timestamp string.

    The lower bound of a "on this local date" query. Emitting the same shape the
    emitter writes — ISO-8601 with an explicit ``+00:00`` offset — is what makes
    SQLite's text comparison against the stored column correct rather than
    accidentally correct.
    """
    naive_midnight = dt.datetime.combine(day, dt.time.min)
    zone = local_timezone()
    local_midnight = (
        naive_midnight.replace(tzinfo=zone)
        if zone is not None
        else naive_midnight.astimezone()
    )
    return local_midnight.astimezone(dt.timezone.utc).isoformat()
