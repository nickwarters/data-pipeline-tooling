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

import pandas as pd
import pytest

from tools.observability import timestamps
from tools.observability.timestamps import (
    elapsed,
    instants,
    local_date,
    local_date_texts,
    local_dates,
    local_months,
    local_now,
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


# --- whole columns of instants ----------------------------------------------


def test_instants_parse_a_column_whole_and_null_what_does_not_parse():
    parsed = instants(
        pd.Series(
            ["2026-08-09T23:30:00+00:00", "2026-08-09T23:30:00Z", "not a stamp", None]
        )
    )
    assert str(parsed.dt.tz) == "UTC"
    assert parsed.iloc[0] == parsed.iloc[1]
    assert parsed.iloc[2:].isna().all()


def test_instants_parse_one_value_too():
    assert instants("2026-08-09T23:30:00Z") == pd.Timestamp(
        "2026-08-09T23:30:00", tz="UTC"
    )
    assert pd.isna(instants(None))


def test_local_dates_file_a_late_evening_utc_stamp_under_the_next_local_day(uk_summer):
    days = local_dates(
        pd.Series(["2026-08-09T23:30:00+00:00", "2026-08-09T12:00:00+00:00", None])
    )
    assert days.tolist() == [dt.date(2026, 8, 10), dt.date(2026, 8, 9), None]


def test_local_date_texts_and_months_are_iso_text_or_none(uk_summer):
    stamps = pd.Series(["2026-08-31T23:30:00+00:00", None])
    assert local_date_texts(stamps).tolist() == ["2026-09-01", None]
    assert local_months(stamps).tolist() == ["2026-09", None]


def test_elapsed_over_two_columns_is_in_the_unit_asked_for_and_never_negative():
    start = instants(pd.Series(["2026-08-09T00:00:00Z", "2026-08-09T12:00:00Z", None]))
    end = instants(
        pd.Series(
            ["2026-08-10T12:00:00Z", "2026-08-09T00:00:00Z", "2026-08-09T00:00:00Z"]
        )
    )
    assert elapsed(start, end).tolist()[:2] == [1.5, 0.0]
    assert pd.isna(elapsed(start, end).iloc[2])
    assert elapsed(start, end, unit="hours").iloc[0] == 36.0
    assert elapsed(start, end, unit="seconds").iloc[0] == 36.0 * 3600


def test_elapsed_between_two_instants_matches_the_column_form():
    start = pd.Timestamp("2026-08-09T00:00:00Z")
    end = pd.Timestamp("2026-08-10T12:00:00Z")
    assert elapsed(start, end) == 1.5
    assert elapsed(end, start) == 0.0
    assert pd.isna(elapsed(pd.NaT, end))
