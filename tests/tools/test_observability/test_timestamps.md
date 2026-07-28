```python
"""Run-metadata time semantics.

One rule, stated once: instants are UTC and aware, calendar dates are local, and
every comparison between the two converts the instant to the local date first.
These tests pin the rule at the boundary that motivated it — a UK box at UTC+1,
where an upstream that lands just after local midnight is stamped the previous
day in UTC.

The local zone is substituted through :func:`local_timezone` rather than by
poking at the machine's clock, so the boundary is pinned identically on Windows
and macOS.
"""

import datetime as dt

import pytest

from tools.observability import timestamps
from tools.observability.timestamps import (
    local_date,
    parse_timestamp,
    start_of_local_day,
    utc_now_iso,
)

BST = dt.timezone(dt.timedelta(hours=1))


@pytest.fixture
def uk_summer(monkeypatch):
    """Pretend the box's local zone is UTC+1, as a UK box is half the year."""
    monkeypatch.setattr(timestamps, "local_timezone", lambda: BST)


def test_emitted_timestamp_is_an_aware_utc_instant():
    moment = parse_timestamp(utc_now_iso())
    assert moment.tzinfo is not None
    assert moment.utcoffset() == dt.timedelta(0)


def test_emitted_timestamp_carries_an_explicit_offset():
    # The stored shape: SQLite compares it as text, so the offset must be there.
    assert utc_now_iso().endswith("+00:00")


def test_a_trailing_z_parses_as_utc():
    assert parse_timestamp("2026-07-27T09:00:00Z") == parse_timestamp(
        "2026-07-27T09:00:00+00:00"
    )


def test_local_date_of_a_late_evening_utc_stamp_is_the_next_day(uk_summer):
    # 23:10 UTC on the 27th is 00:10 local on the 28th: the run happened today.
    assert local_date("2026-07-27T23:10:00+00:00") == dt.date(2026, 7, 28)


def test_local_date_of_a_daytime_stamp_is_unchanged(uk_summer):
    assert local_date("2026-07-27T09:00:00+00:00") == dt.date(2026, 7, 27)


def test_start_of_local_day_is_local_midnight_expressed_as_utc(uk_summer):
    assert start_of_local_day(dt.date(2026, 7, 28)) == "2026-07-27T23:00:00+00:00"


def test_start_of_local_day_has_the_shape_the_emitter_writes():
    bound = start_of_local_day(dt.date(2026, 7, 28))
    # Same text shape as a stored stamp, so SQLite's text comparison compares
    # like with like rather than a naive string against an offset-bearing one.
    assert bound.endswith("+00:00")
    assert parse_timestamp(bound).utcoffset() == dt.timedelta(0)


def test_a_bound_sorts_below_any_stamp_within_that_local_day(uk_summer):
    bound = start_of_local_day(dt.date(2026, 7, 28))
    next_bound = start_of_local_day(dt.date(2026, 7, 29))
    just_after_midnight = "2026-07-27T23:00:00.000001+00:00"
    assert bound <= just_after_midnight < next_bound

```
