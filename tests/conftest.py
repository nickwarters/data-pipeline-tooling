"""Suite-wide defaults that keep a test's answer off the box it runs on.

**The local zone is pinned to UTC for every test.**

Two clocks meet in the run metadata: instants are UTC, calendar dates are local,
and every comparison converts the instant to the local date first (the rule
settled in ``tools.observability.timestamps``). A test that stamps a run near
midnight and asserts against a calendar date is therefore answering a question
about *the machine's offset* unless it says which zone it means — and most such
tests never meant to. Left to the system zone they pass in the UK in winter and
fail in it in summer, or pass everywhere in Europe and fail in the Americas.

That is not hypothetical: it reached ``main``. Two ``same_day`` freshness tests
stamped an upstream at 23:59 UTC and asserted against a local run date, so at
UTC+1 they asserted the *opposite* of the rule they named, and the suite could
not be committed from a UK box between March and October.

So the default is fixed here, once, rather than per test. UTC because it is the
zone in which "the instant's date" and "the local date" coincide, which is what
a test that isn't *about* the conversion wants.

**Overriding it is how you test the conversion itself.** The pin goes through
the same ``local_timezone`` seam a test would use, and an autouse fixture is set
up *before* the ones a test asks for by name, so any test that requests its own
zone fixture — ``uk_summer`` in ``tests/framework/run/test_runner.py``,
``tests/tools/test_observability/test_timestamps.py`` — or patches the seam in
its own body wins outright. Nothing here weakens those; it removes the silent
dependency from everything else.

Two limits worth knowing. This pins the zone, not the clock: ``date.today()``
and ``utc_now_iso()`` still read the real time, so a test that needs a fixed
*instant* must still inject one. And the override ordering above holds for a
**function-scoped** fixture; a module- or session-scoped one would be set up
*before* this pin and then be silently overwritten by it, so keep zone fixtures
function-scoped.

Because the pin substitutes a concrete zone, ``local_timezone``'s own production
default — ``None``, meaning "the system zone, resolved per instant" — is no
longer reached by the tests it displaces. ``tests/test_suite_defaults.py``
restores and exercises it directly so that branch keeps its cover.

It also re-exports the ``databases`` fixture
(``tests.framework_testing.databases``) so a test can build the databases it
writes by name; a fixture defined in a helper module is not collected until a
conftest imports it.
"""

from __future__ import annotations

import datetime as dt

import pytest

# Re-exported so every test can ask for it by name: a fixture defined in a
# helper module is not collected unless a conftest imports it.
from tests.framework_testing.databases import databases  # noqa: F401
from tools.observability import timestamps


@pytest.fixture(autouse=True)
def fixed_local_zone(monkeypatch):
    """Pin the local calendar zone to UTC unless a test asks for another."""
    monkeypatch.setattr(timestamps, "local_timezone", lambda: dt.timezone.utc)
