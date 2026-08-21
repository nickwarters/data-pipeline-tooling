```python
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


def test_the_unpinned_system_zone_bound_round_trips_to_local_midnight(monkeypatch):
    """Cover the branch the pin takes away: ``local_timezone()`` returning None.

    ``None`` means "the system zone, resolved per instant" and is what actually
    runs in production — but pinning the seam for every test means no test
    executes it any more, so ``start_of_local_day``'s ``zone is None`` arm could
    be broken with the suite green in every zone.

    The assertion is a **round trip**, not a shape check. Checking only that the
    bound ends in ``+00:00`` is far too weak: mis-labelling local midnight as
    *UTC* midnight — the exact confusion this module exists to prevent — keeps
    that suffix and a zero offset, so it passes. Converting the bound back to the
    system zone and requiring it to land on midnight of the day asked for is what
    catches it. On a box already at UTC the two are indistinguishable and nothing
    could tell them apart; everywhere else this fails loudly.
    """
    monkeypatch.setattr(timestamps, "local_timezone", _SYSTEM_LOCAL_TIMEZONE)
    assert timestamps.local_timezone() is None
    day = dt.date(2026, 5, 29)

    bound = start_of_local_day(day)

    assert bound.endswith("+00:00")
    local = dt.datetime.fromisoformat(bound).astimezone()
    assert local.date() == day
    assert local.time() == dt.time.min

```
