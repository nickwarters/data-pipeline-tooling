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
import time

import pandas as pd
import pytest

from tools.observability import timestamps
from tools.observability.timestamps import (
    local_date,
    local_now,
    local_wall_clock,
    parse_timestamp,
    start_of_local_day,
    utc_now_iso,
)

BST = dt.timezone(dt.timedelta(hours=1))


@pytest.fixture
def uk_summer(monkeypatch):
    """Pretend the local zone is UTC+1 in summer."""
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


@pytest.fixture
def system_zone_utc_plus_one(monkeypatch):
    """Make the *system* zone UTC+1 and leave the seam on its default (None)."""
    if not hasattr(time, "tzset"):
        pytest.skip("time.tzset is POSIX-only")
    monkeypatch.setattr(timestamps, "local_timezone", lambda: None)
    monkeypatch.setenv("TZ", "XXX-1")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def test_local_date_of_a_pandas_timestamp_uses_the_system_zone(
    system_zone_utc_plus_one,
):
    # pandas' own astimezone(None) means "drop to UTC"; the rule is the local date.
    stamp = pd.Timestamp("2026-07-27T23:10:00+00:00")
    assert local_date(stamp) == dt.date(2026, 7, 28)
    assert local_date(stamp) == local_date(stamp.isoformat())


@pytest.fixture
def default_zone(monkeypatch):
    """Leave the seam on its default (None), as it is in production."""
    monkeypatch.setattr(timestamps, "local_timezone", lambda: None)


def test_local_wall_clock_converts_a_column_to_uk_time_per_instant(default_zone):
    instants = pd.to_datetime(
        pd.Series(
            [
                "2026-07-27T23:10:00+00:00",  # BST: 00:10 on the 28th
                "2026-12-07T23:10:00+00:00",  # GMT: unchanged
                "2026-10-25T00:59:00+00:00",  # 01:59 BST, a minute before the change
                "2026-10-25T01:00:00+00:00",  # 01:00 GMT, the change itself
                None,
            ]
        ),
        utc=True,
    )
    assert local_wall_clock(instants).tolist()[:4] == [
        pd.Timestamp("2026-07-28T00:10:00"),
        pd.Timestamp("2026-12-07T23:10:00"),
        pd.Timestamp("2026-10-25T01:59:00"),
        pd.Timestamp("2026-10-25T01:00:00"),
    ]
    assert pd.isna(local_wall_clock(instants).iloc[4])


def test_local_wall_clock_agrees_with_local_date_through_the_seam(uk_summer):
    instants = pd.to_datetime(pd.Series(["2026-07-27T23:10:00+00:00"]), utc=True)
    [wall] = local_wall_clock(instants)
    assert wall == pd.Timestamp("2026-07-28T00:10:00")
    assert wall.date() == local_date("2026-07-27T23:10:00+00:00")


def test_local_date_of_a_daytime_stamp_is_unchanged(uk_summer):
    assert local_date("2026-07-27T09:00:00+00:00") == dt.date(2026, 7, 27)


def test_local_now_reads_the_wall_clock_through_the_zone_seam(uk_summer):
    # The wall clock a time-of-day comparison asks about, in the same zone the
    # calendar dates use — not the box's, and not UTC.
    now = local_now()

    assert now.utcoffset() == dt.timedelta(hours=1)
    assert now.hour == dt.datetime.now(dt.timezone.utc).astimezone(BST).hour


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
