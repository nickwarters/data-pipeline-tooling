"""Test the source checkpoint: the window rule over a committed position."""

import datetime as dt

import pytest

from tools.source_checkpoint import InstantWindow, instant_window

UTC = dt.timezone.utc
SOURCE_NOW = dt.datetime(2026, 8, 5, 9, 0, tzinfo=UTC)
OVERLAP = dt.timedelta(minutes=5)
SAFETY_LAG = dt.timedelta(minutes=2)
NAIVE = dt.datetime(2026, 8, 5, 9, 0)


def window(
    committed=None, *, source_now=SOURCE_NOW, overlap=OVERLAP, safety_lag=SAFETY_LAG
):
    return instant_window(
        committed, source_now=source_now, overlap=overlap, safety_lag=safety_lag
    )


# --- the window rule ----------------------------------------------------------


def test_the_first_window_has_no_lower_bound():
    # Nothing has been committed, so there is no floor to resume from: the first
    # run fetches everything the source holds, up to the safe upper boundary.
    first = window(None)

    assert first == InstantWindow(start=None, end=SOURCE_NOW - SAFETY_LAG)


def test_a_committed_position_resumes_one_overlap_early():
    # The overlap is deliberate re-reading: a row stamped either side of the
    # last boundary is re-observed rather than missed.
    committed = dt.datetime(2026, 8, 5, 8, 30, tzinfo=UTC)

    assert window(committed) == InstantWindow(
        start=committed - OVERLAP, end=SOURCE_NOW - SAFETY_LAG
    )


def test_a_window_that_has_not_advanced_yet_is_none_rather_than_an_error():
    # Running again before the safe upper bound has moved past the committed
    # position is ordinary operation, not a failure: there is nothing left to
    # poll yet, so None comes back rather than a window of covered ground.
    committed = SOURCE_NOW - SAFETY_LAG

    assert window(committed) is None
    later = SOURCE_NOW + dt.timedelta(seconds=1)
    assert window(committed, source_now=later) is not None


def test_the_rule_reads_the_source_clock_in_utc():
    # The bounds are a predicate the source evaluates, so an offset-aware clock
    # reading is one instant however it was spelled.
    local = dt.timezone(dt.timedelta(hours=1))

    assert window(None, source_now=dt.datetime(2026, 8, 5, 10, 0, tzinfo=local)) == (
        InstantWindow(start=None, end=SOURCE_NOW - SAFETY_LAG)
    )


@pytest.mark.parametrize(
    "kwargs",
    [{"source_now": NAIVE}, {"committed": NAIVE}],
    ids=["source_now", "committed"],
)
def test_a_naive_instant_is_refused(kwargs):
    # A naive datetime has no single UTC meaning; reading it as the local zone
    # would shift the window by whatever offset the running box is in.
    with pytest.raises(ValueError, match="timezone-aware"):
        window(**kwargs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"overlap": dt.timedelta(minutes=-1)},
        {"safety_lag": dt.timedelta(minutes=-1)},
    ],
    ids=["overlap", "safety_lag"],
)
def test_a_negative_overlap_or_safety_lag_is_refused(kwargs):
    # A negative safety lag reads into the future; a negative overlap opens a
    # permanent gap between consecutive windows.
    with pytest.raises(ValueError, match="must not be negative"):
        window(**kwargs)


def test_a_window_refuses_a_naive_bound_or_an_inverted_span():
    with pytest.raises(ValueError, match="timezone-aware"):
        InstantWindow(None, NAIVE)
    with pytest.raises(ValueError, match="must be before"):
        InstantWindow(SOURCE_NOW, SOURCE_NOW)
