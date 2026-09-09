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
from typing import Literal

import pandas as pd

__all__ = [
    "elapsed",
    "instants",
    "local_date",
    "local_date_texts",
    "local_dates",
    "local_months",
    "local_now",
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


def local_now() -> dt.datetime:
    """The current local wall clock, read through the same zone seam as the dates.

    "Is it past 09:00 yet?" is a local wall-clock question, so it belongs to the
    local half of the rule stated above rather than to the UTC instant half. It
    lives here so nothing elsewhere spells its own ``datetime.now(...)`` and
    quietly answers it in a different zone.
    """
    return dt.datetime.now(local_timezone())


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


# --- whole columns of instants ----------------------------------------------
#
# A gold reduction works over a column of stored instants, not one value, and
# every one of them buckets those instants by *local* calendar date or month.
# The rule is the one stated at the top of this module; these apply it to a
# ``pandas`` Series so no reduction spells its own conversion.

SECONDS_PER = {"seconds": 1.0, "hours": 3_600.0, "days": 86_400.0}

Unit = Literal["seconds", "hours", "days"]


def instants(values) -> pd.Series:
    """Stored ISO-8601 text (or datetimes) as UTC instants, a whole column at once.

    ``format="ISO8601"`` rather than inference, so a batch mixing two spellings
    of the same instant (``...Z`` beside ``...+00:00``) parses whole. A value
    that does not parse at all becomes ``NaT``: the measure it feeds drops that
    row rather than the run failing on one bad stamp -- a reporting reduction
    summarises what it can read, whereas the silver boundary's
    ``SchemaCoercion`` fails loudly on the same input, deliberately.
    """
    return pd.to_datetime(values, utc=True, errors="coerce", format="ISO8601")


def local_dates(values) -> pd.Series:
    """The local calendar date of each instant; ``None`` where there is none.

    Per instant rather than one vectorised ``tz_convert``: which zone is local
    is the :func:`local_timezone` seam and it resolves per instant, which is
    what lets a column spanning a summer-time change file each row under the
    day it actually happened on.
    """
    parsed = instants(values)
    return _objects([None if pd.isna(v) else local_date(v) for v in parsed], parsed)


def local_date_texts(values) -> pd.Series:
    """The local calendar date of each instant as ``YYYY-MM-DD`` text."""
    days = local_dates(values)
    return _objects([None if d is None else d.isoformat() for d in days], days)


def local_months(values) -> pd.Series:
    """The local calendar month of each instant as ``YYYY-MM`` text."""
    days = local_dates(values)
    return _objects([None if d is None else d.strftime("%Y-%m") for d in days], days)


def _objects(items: list, like: pd.Series) -> pd.Series:
    """``items`` as an ``object`` column on ``like``'s index, so a ``None`` stays
    ``None`` rather than being inferred into ``NaN`` or ``NaT``."""
    return pd.Series(items, index=like.index, dtype="object")


def elapsed(start, end, *, unit: Unit = "days"):
    """Time from ``start`` to ``end`` in ``unit``, never negative.

    Works on two instants or two whole columns of them. Missing on either side
    is missing out (``NaN``), so a measure over the result simply has one
    fewer value. Clamped at zero: an end before its start is a stamp written
    out of order, and a negative duration pulling a mean down is a worse lie
    than a zero.
    """
    delta = end - start
    if isinstance(delta, pd.Series):
        return (delta.dt.total_seconds() / SECONDS_PER[unit]).clip(lower=0.0)
    if pd.isna(delta):
        return float("nan")
    return max(delta.total_seconds() / SECONDS_PER[unit], 0.0)
