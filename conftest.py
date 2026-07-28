"""Root conftest.

Its presence puts the repository root on ``sys.path`` (pytest prepend import
mode), which is exactly how pipelines import the framework in production: the
package is on the path, never pip-installed.
"""

from __future__ import annotations

import pytest

from framework.io.writers import set_require_declared_tables


@pytest.fixture(autouse=True)
def _require_declared_tables_like_dev():
    """Run every test with the require-declared-tables guard on, like ``dev``.

    ``dev`` is where this guard is switched on (#324); the test suite runs as
    if it were dev's process, so a fixture that still relies on a Writer
    creating its table implicitly fails here exactly as it would against a
    real dev base dir -- rather than only once someone remembers to pass
    ``--env dev`` by hand. Reset after each test so one test's guard state
    never leaks into the next (a test exercising ``prod``'s off state, or
    activating an environment itself, would otherwise change the default
    for every test after it).

    Being blanket and autouse, it hides *which* tests depend on the guard --
    accepted deliberately: the guard is a whole-process operating mode, not a
    per-test input, and pinning it per test would mean ~40 opt-ins that all say
    the same thing. The cost it would otherwise carry -- that the guard-*off*
    branch, which every environment but ``dev`` still runs, goes unexercised --
    is paid off explicitly in
    ``tests/framework/io/test_writers/test_require_declared_tables.py``, which
    overrides this fixture to cover both states of every guarded call site.
    """
    set_require_declared_tables(True)
    yield
    set_require_declared_tables(False)
