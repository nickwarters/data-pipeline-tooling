"""A feed lands under its own feed name, never under its identity namespace.

The two are separate declarations that happen to coincide today, so a feed whose
``NAMESPACE`` is changed must keep writing to the same place on disk.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from framework.run import RunContext
from tests.framework_testing import read_rows
from tools.medallion import medallion
from tools.store import StoreRegistry

COMPLAINTS_FEEDS = ["complaints_a", "complaints_b", "complaints_c"]


def _feed(name: str):
    import importlib

    return importlib.import_module(f"pipelines.{name}.pipeline")


@pytest.mark.parametrize("feed_name", COMPLAINTS_FEEDS)
def test_complaints_operational_paths_do_not_follow_identity_namespace(
    feed_name, monkeypatch, tmp_path
):
    module = _feed(feed_name)
    landing = tmp_path / "landing_zone"
    landing.mkdir()
    sample = (
        Path(__file__).parent.parent.parent
        / "pipelines"
        / feed_name
        / "sample_data"
        / f"{feed_name}.csv"
    )
    shutil.copy(sample, landing / f"{feed_name}.csv")

    monkeypatch.setattr(module, "NAMESPACE", f"changed_{feed_name}")
    module.run(RunContext(base_dir=tmp_path, pipeline=module.FEED_NAME))

    med = medallion(StoreRegistry(tmp_path), module.FEED_NAME)
    assert read_rows(med.raw, module.FEED_NAME)
    assert read_rows(med.silver, module.FEED_NAME)
    assert not (tmp_path / f"changed_{feed_name}").exists()
