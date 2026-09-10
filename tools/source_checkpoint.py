"""Where a polled source got to, and the rule that turns that into the next ask.

A source that is *asked for* repeatedly over time rather than handed over as a
file (``CONTEXT.md``: a **Polling Feed**) needs two things that no Reader, Writer
or run record provides: a durable **position** recording how far it has been
polled, and a **rule** turning that position into the next span to fetch. This
module is the home of both, for every such source.

The rule is here; the store follows in a later step of the same change.

**"Checkpoint" here is not the pipeline sense.** A ``Pipeline`` checkpoint is a
mid-graph ``.write()`` node landing an intermediate dataset for lineage. This one
is **source control state**: how far a source has been polled, kept in its own
file beside the run metadata rather than inside it.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

__all__ = [
    "InstantWindow",
    "instant_window",
]


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
