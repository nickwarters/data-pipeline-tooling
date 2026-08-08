# `WorkingDayCalendar` — working-day arithmetic

Availability criteria are phrased in **working days**: "candidate Cases … these
Advisers within the last 20 working days" ([`../CONTEXT.md`](../CONTEXT.md)).
`WorkingDayCalendar` answers those questions deterministically. It is a
**config-seeded pure utility** — Python only, no `Store`, no in-memory engine,
no `Dataset`. Because it depends only on the stdlib `datetime`, it
behaves identically on Windows and macOS.

It is deliberately **not a Feed**: cross-cutting Reference Data lives in
per-subject medallions, but the working-day calendar is seeded from config, not
ingested (`CONTEXT.md` Reference Data note).

## Construction (the config)

```python
from datetime import date
from tools.calendar import WorkingDayCalendar

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

Seeding comes from a **YAML calendar file** via
[`WorkingDayCalendar.from_yaml(path)`](#from-a-calendar-file--workingdaycalendarfrom_yamlpath)
(below), so an operator seeds holidays without editing code. The calendar itself
stays pure so it is trivially testable and deterministic.

## From a calendar file — `WorkingDayCalendar.from_yaml(path)`

```yaml
# holidays.yml
weekend: [saturday, sunday]   # optional; this is the default
holidays:
  - 2026-01-01                # New Year's Day
  - 2026-12-25                # Christmas Day
```

```python
from tools.calendar import WorkingDayCalendar

cal = WorkingDayCalendar.from_yaml("holidays.yml")
```

| Key | Optional? | Value |
|-----|-----------|-------|
| `holidays` | yes (default none) | a flat list of `YYYY-MM-DD` dates. A name has nowhere to live — the calendar holds a set of dates — so label a holiday with a `#` comment. |
| `weekend` | yes (default `[saturday, sunday]`) | a list of full English weekday names, matched case-insensitively — the same operator language `Schedule.on_weekdays("monday", …)` accepts. Ordinals are **not** accepted here. `[]` is legal and means "no weekend". |

Nothing else is allowed: an unknown key is an error, and so is an empty file —
passing a calendar file means you intended to seed something. (A document of
`{}` is a mapping and is accepted; it yields the default calendar.)

**On dates.** `yaml.safe_load` parses an unquoted `2026-01-01` into a real
`datetime.date`, which is what the calendar wants. Quoted strings
(`"2026-01-01"`) are accepted too. A date-*time* (`2026-01-01 09:00:00`) is
**rejected**: `date(2026, 1, 1) == datetime(2026, 1, 1)` is `False` and the two
hash differently, so a `datetime` in the holiday set would silently never match.

Every problem raises `ValueError` naming the path, so a caller never has to
interpret a parser exception:

- `no calendar file at '<path>'`
- `cannot read calendar file '<path>': …` (any other read failure — a directory, a permission error)
- `calendar file '<path>' is not valid YAML: …`
- `calendar file '<path>' must contain a mapping with keys: holidays, weekend`
- `calendar file '<path>': unknown key 'holyday'; expected: holidays, weekend`
- `calendar file '<path>': holidays must be a list of YYYY-MM-DD dates` (and the `weekend` equivalent)
- `calendar file '<path>': holidays[2] must be a YYYY-MM-DD date, got 'next monday'`
- `calendar file '<path>': unknown weekday name 'funday'; expected one of: monday, …`

The same file serves both callers of the calendar: orchestration schedules and
Availability criteria (`CasePool`). `yaml` is imported lazily inside the method,
so importing `tools.calendar` still costs only the stdlib.

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

## Where the calendar is used — orchestration

A scheduled pipeline reaches the calendar through its `Schedule`. The worked
example is [`case_review/schedules.py`](../case_review/schedules.py), where the
`sharepoint_cases` feed is declared `Schedule.daily()`, so a weekend or a seeded
holiday is what makes the orchestrator record `skipped` rather than invoke the
pipeline.

**`python -m cli orchestrate` seeds its calendar with `--calendar <file>`**, the
YAML calendar file above. Without the flag the calendar is the default —
weekends only, no holidays. The scheduling side is in
[operator-cli.md](operator-cli.md#orchestrate--run-scheduled-due-work).

The seeded calendar drives the month-walking schedules too, not just the
weekday gate: with the 1st of the month seeded as a holiday,
`NthWorkingDayOfMonth(1)` becomes due on the 2nd. Note that the skip reason a
schedule prints names the aspect of the date *it* judged — for `Weekdays`, the
weekday name — so a holiday skip on a Monday reads
`schedule daily is not due on monday`.

## Where the calendar is used — availability windows

`CasePool.fetch_available_cases(..., within_working_days=N)` counts the same
working days, so the same file seeds it. A path-addressed pipeline takes it as
the `calendar` run parameter rather than a flag of its own:

```sh
python -m cli run pipelines/selection --base-dir /share \
    --param calendar=/config/calendar.yml
```

Without the parameter the window counts weekends only, so a bank holiday
silently narrows it by a day. Seeding the same file both commands read is what
keeps a Case eligible for Selection on the day the schedule expects to select
it. See [selection.md](selection.md).
