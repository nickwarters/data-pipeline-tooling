"""``WorkingDayCalendar`` — config-seeded working-day arithmetic.

Availability criteria phrase eligibility in *working days* ("these Advisers
within the last 20 working days" — see ``CONTEXT.md``). This utility answers
those questions deterministically from a seeded weekend rule plus a set of
holidays. It is **pure logic**: no ``Store``, no in-memory engine, no
``Dataset`` — it depends only on the stdlib ``datetime``, so it is the same on
Windows and macOS. Reference Data lives in per-subject medallions; the
working-day calendar is deliberately *not* a feed (ADR-0001 amendment).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable


class WorkingDayCalendar:
    """Working-day arithmetic over a weekend rule + a set of holidays.

    ``weekend`` is the set of weekday ordinals that are non-working
    (``date.weekday()``: Monday=0 … Sunday=6), defaulting to Saturday/Sunday.
    ``holidays`` are individual non-working dates layered on top.
    """

    def __init__(
        self,
        holidays: Iterable[date] = (),
        weekend: Iterable[int] = (5, 6),
    ) -> None:
        self._holidays = frozenset(holidays)
        self._weekend = frozenset(weekend)

    def is_working_day(self, day: date) -> bool:
        """``True`` unless ``day`` falls on the weekend or is a holiday."""
        return day.weekday() not in self._weekend and day not in self._holidays

    def last_n_working_days(self, n: int, from_date: date) -> list[date]:
        """The ``n`` most recent working days on or before ``from_date``.

        Returned most-recent first. Walks backward, skipping weekends and
        holidays; if ``from_date`` itself is a working day it is the first day.
        """
        days: list[date] = []
        day = from_date
        while len(days) < n:
            if self.is_working_day(day):
                days.append(day)
            day -= timedelta(days=1)
        return days
