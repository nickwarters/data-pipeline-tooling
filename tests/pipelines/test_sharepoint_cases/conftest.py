"""Fixtures shared by every ``sharepoint_cases`` suite in this package."""

from __future__ import annotations

import pytest

from pipelines.sharepoint_cases.pipeline import FEED_NAME
from tests.framework_testing import build_databases


@pytest.fixture
def base_dir(tmp_path):
    """A base directory with this feed's declared migrations applied.

    ``sharepoint_cases`` is under migration control, so its tables are declared
    by ``migrations/sharepoint_cases/`` rather than created by the first write.
    An end-to-end test against a bare ``tmp_path`` would create tables on first
    write and would not notice a baseline that forgot one, which is exactly what
    these tests are here to catch.
    """
    return build_databases(tmp_path, FEED_NAME)
