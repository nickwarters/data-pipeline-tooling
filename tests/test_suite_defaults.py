"""The suite's own defaults, held to their contract.

``tests/conftest.py`` pins the local calendar zone so no test's answer depends
on the offset of the box running it. That pin is invisible — nothing fails if it
is deleted *today*, it just quietly hands the next near-midnight test back to
the machine's zone. These tests make it visible: the default holds, a test can
still override it (which is what the zone-conversion tests rely on), and the
production default the pin displaces stays covered.
"""

import datetime as dt

import pytest

from tools.observability import timestamps
from tools.observability.timestamps import local_date, start_of_local_day

_BST = dt.timezone(dt.timedelta(hours=1))

# Captured at import, before any fixture runs, so the real system-zone default
# can be put back for the one test that needs to exercise it.
_SYSTEM_LOCAL_TIMEZONE = timestamps.local_timezone


def test_the_local_zone_defaults_to_utc():
    # Not "some fixed zone": UTC specifically, so an instant's date and its
    # local date coincide for every test that isn't about the conversion.
    assert timestamps.local_timezone() == dt.timezone.utc
    assert local_date("2026-05-28T23:59:00+00:00") == dt.date(2026, 5, 28)


@pytest.fixture
def uk_summer(monkeypatch):
    monkeypatch.setattr(timestamps, "local_timezone", lambda: _BST)


def test_a_test_that_asks_for_its_own_zone_still_wins(uk_summer):
    # The autouse pin is set up first, so a named zone fixture overrides it —
    # this is what the UTC-instant/local-date conversion tests depend on.
    assert timestamps.local_timezone() == _BST
    assert local_date("2026-05-28T23:59:00+00:00") == dt.date(2026, 5, 29)


def test_the_unpinned_system_zone_still_produces_a_stored_shape_bound(monkeypatch):
    """Cover the branch the pin takes away: ``local_timezone()`` returning None.

    ``None`` means "the system zone, resolved per instant" and is what actually
    runs in production — but pinning the seam for every test means no test
    executes it any more, so ``start_of_local_day``'s ``zone is None`` arm could
    be broken (dropping the ``.astimezone()``, say, and emitting a naive local
    midnight that SQLite's text comparison would silently mis-order) with the
    suite green in every zone. Call the real function explicitly to keep it
    covered; the assertion is about the *shape*, which holds on any box.
    """
    monkeypatch.setattr(timestamps, "local_timezone", _SYSTEM_LOCAL_TIMEZONE)
    assert timestamps.local_timezone() is None

    bound = start_of_local_day(dt.date(2026, 5, 29))

    assert bound.endswith("+00:00")
    assert dt.datetime.fromisoformat(bound).utcoffset() == dt.timedelta(0)
