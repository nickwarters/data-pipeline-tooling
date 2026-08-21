```python
"""``WorkingDayCalendar`` — config-seeded working-day arithmetic.

Availability criteria phrase eligibility in *working days* ("these Advisers
within the last 20 working days" — see ``CONTEXT.md``). This utility answers
those questions deterministically from a seeded weekend rule plus a set of
holidays. It is **pure logic**: no ``Store``, no in-memory engine, no
``Dataset`` — it depends only on the stdlib ``datetime``, so it is the same on
Windows and macOS. Reference Data lives in per-subject medallions; the
working-day calendar is deliberately not a feed.

The config it is "seeded from" is a **YAML calendar file** — a mapping of
optional ``holidays`` and ``weekend`` keys — loadable by
:meth:`WorkingDayCalendar.from_yaml`; it is still not a feed.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

_WEEKDAY_NAMES = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)

_CALENDAR_KEYS = ("holidays", "weekend")


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

    @classmethod
    def from_yaml(cls, path: str | Path) -> "WorkingDayCalendar":
        """Seed a calendar from a YAML calendar file.

        The file is a mapping with two optional keys::

            weekend: [saturday, sunday]   # the default
            holidays:
              - 2026-01-01
              - 2026-12-25

        ``holidays`` are ``YYYY-MM-DD`` dates (YAML parses unquoted ones into
        ``date`` objects; quoted strings are accepted too). ``weekend`` names
        full English weekdays, case-insensitively — the same operator language
        ``Schedule.on_weekdays(...)`` accepts; ``[]`` means "no weekend".

        Every operator-facing problem raises :class:`ValueError` naming the
        path, so a caller never has to interpret a parser exception. ``yaml`` is
        imported lazily so importing this module costs only the stdlib.
        """
        import yaml

        file_path = Path(path)
        try:
            text = file_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise ValueError(f"no calendar file at '{file_path}'") from None
        except OSError as exc:
            raise ValueError(f"cannot read calendar file '{file_path}': {exc}") from exc
        try:
            loaded = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise ValueError(
                f"calendar file '{file_path}' is not valid YAML: {exc}"
            ) from exc
        if not isinstance(loaded, dict):
            raise ValueError(
                f"calendar file '{file_path}' must contain a mapping with keys: "
                f"{', '.join(_CALENDAR_KEYS)}"
            )
        for key in loaded:
            if key not in _CALENDAR_KEYS:
                raise ValueError(
                    f"calendar file '{file_path}': unknown key {key!r}; "
                    f"expected: {', '.join(_CALENDAR_KEYS)}"
                )
        return cls(
            holidays=_parse_holidays(loaded.get("holidays", []), file_path),
            weekend=(
                _parse_weekend(loaded["weekend"], file_path)
                if "weekend" in loaded
                else (5, 6)
            ),
        )

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


def _parse_holidays(value: Any, path: Path) -> list[date]:
    """The ``holidays`` key: a list of ``YYYY-MM-DD`` dates."""
    if not isinstance(value, list):
        raise ValueError(
            f"calendar file '{path}': holidays must be a list of YYYY-MM-DD dates"
        )
    return [_parse_holiday(item, index, path) for index, item in enumerate(value)]


def _parse_holiday(value: Any, index: int, path: Path) -> date:
    """One holiday element, as a ``date``.

    A ``datetime`` is rejected rather than narrowed: it compares unequal to the
    ``date`` a schedule asks about and hashes differently, so it would sit in
    the holiday set and silently never match.
    """
    where = f"calendar file '{path}': holidays[{index}]"
    if isinstance(value, datetime):
        raise ValueError(
            f"{where} must be a YYYY-MM-DD date, got a date-time; "
            "use a plain YYYY-MM-DD date"
        )
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise ValueError(f"{where} must be a YYYY-MM-DD date, got {value!r}")


def _parse_weekend(value: Any, path: Path) -> list[int]:
    """The ``weekend`` key: weekday names mapped to ``date.weekday()`` ordinals."""
    if not isinstance(value, list):
        raise ValueError(
            f"calendar file '{path}': weekend must be a list of weekday names"
        )
    ordinals: list[int] = []
    for name in value:
        key = name.strip().lower() if isinstance(name, str) else name
        if key not in _WEEKDAY_NAMES:
            raise ValueError(
                f"calendar file '{path}': unknown weekday name {name!r}; "
                f"expected one of: {', '.join(_WEEKDAY_NAMES)}"
            )
        ordinals.append(_WEEKDAY_NAMES.index(key))
    return ordinals

```
