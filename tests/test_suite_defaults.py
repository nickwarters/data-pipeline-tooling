"""The suite's own defaults, held to their contract.

``tests/conftest.py`` pins the local calendar zone so no test's answer depends
on the offset of the box running it. That pin is invisible — nothing fails if it
is deleted *today*, it just quietly hands the next near-midnight test back to
the machine's zone. These two tests make it visible: one that the default holds,
one that a test can still override it, which is what the zone-conversion tests
rely on.
"""

import datetime as dt

import pytest

from tools.observability import timestamps
from tools.observability.timestamps import local_date

_BST = dt.timezone(dt.timedelta(hours=1))


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
