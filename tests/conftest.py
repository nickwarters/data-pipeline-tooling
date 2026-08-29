"""Deterministic UTC and named-database fixtures for the test suite.

The UTC override patches ``timestamps.local_timezone``; ``databases`` is
re-exported for tests that build declared database sets.
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
