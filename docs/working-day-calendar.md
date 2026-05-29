# `WorkingDayCalendar` — working-day arithmetic

Availability criteria are phrased in **working days**: "candidate Cases … these
Advisers within the last 20 working days" ([`../CONTEXT.md`](../CONTEXT.md)).
`WorkingDayCalendar` answers those questions deterministically. It is a
**config-seeded pure utility** — Python only, no `Store`, no in-memory engine,
no `DataHandle` (ADR-0002). Because it depends only on the stdlib `datetime`, it
behaves identically on Windows and macOS.

It is deliberately **not a Feed**: cross-cutting Reference Data lives in
per-subject medallions, but the working-day calendar is seeded from config, not
ingested (ADR-0001 amendment; `CONTEXT.md` Reference Data note).

## Construction (the config)

```python
from datetime import date
from framework.calendar import WorkingDayCalendar

cal = WorkingDayCalendar(
    holidays=[date(2026, 1, 1), date(2026, 12, 25)],  # individual non-working dates
    weekend=(5, 6),                                    # Sat=5, Sun=6 (the default)
)
```

- **`weekend`** — the weekday ordinals that are non-working, using
  `date.weekday()` numbering (**Monday=0 … Sunday=6**). Defaults to
  `(5, 6)` (Saturday/Sunday). A region with a Friday/Saturday weekend passes
  `(4, 5)`.
- **`holidays`** — individual non-working dates layered on top of the weekend
  rule. Any iterable of `datetime.date`; held as a set, so duplicates and order
  don't matter.

Seeding is the caller's concern (a holidays list in config, parsed to `date`s).
The calendar itself stays pure so it is trivially testable and deterministic.

## Queries

### `is_working_day(day) -> bool`
`True` unless `day` falls on the configured weekend **or** is a holiday.

### `last_n_working_days(n, from_date) -> list[date]`
The `n` most recent working days on or before `from_date`, returned
**most-recent first**. Walks backward, skipping weekends and holidays.

```python
cal = WorkingDayCalendar()              # default Sat/Sun, no holidays
cal.last_n_working_days(2, date(2026, 1, 5))   # Monday
# [date(2026, 1, 5), date(2026, 1, 2)]  -> Sat 3rd / Sun 4th skipped
```

**Boundary handling.** If `from_date` is itself a working day it is the first
(most-recent) entry. If `from_date` lands on a weekend or holiday it is not
counted — the window is anchored at the previous working day:

```python
cal.last_n_working_days(2, date(2026, 1, 3))   # a Saturday
# [date(2026, 1, 2), date(2026, 1, 1)]  -> anchored at Friday
```

For an availability criterion, `result[-1]` is the earliest eligible day (the
window's far edge) and `result[0]` the most recent.
