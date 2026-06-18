"""Tests for the scaffold's ``--case-type`` variant — a cross-tree concern.

The generic scaffold is framework-only and tested under
``tests/framework/_cli/``. The
``--case-type`` variant is different in kind: it renders a case-review-flavoured
slice that declares a Case Type's identity contract and reaches the real
``case_review`` package, so its tests span the framework/application boundary and
live here in ``tests/integration/`` rather than coupling the framework scaffold
test to ``case_review``.

The variant is additive over the generic feed: it declares the Case Type's
identity contract and refines source -> raw -> silver (the settled ingest spine),
deliberately stopping at silver and leaving gold as the author's seam while the
snapshot-vs-join assembly remains open.
"""

from __future__ import annotations

import importlib
import sys

from framework.core import RAW, SILVER
from framework.io import StoreCatalog
from framework.run import RunContext
from framework.testing import read_rows
from framework._cli import scaffold


def test_case_type_variant_lays_down_the_feed_with_its_case_type(tmp_path):
    created = scaffold.render("orders", tmp_path, case_type=True)

    feed_dir = tmp_path / "pipelines" / "orders"
    expected = {
        feed_dir / "__init__.py",
        feed_dir / "schema.py",
        feed_dir / "case_type.py",
        feed_dir / "pipeline.py",
        feed_dir / "sample_data" / "orders.csv",
        tmp_path / "tests" / "pipelines" / "test_orders.py",
    }
    assert expected.issubset(set(created))
    for path in expected:
        assert path.exists(), path


def test_case_type_variant_substitutes_the_identity_contract(tmp_path):
    scaffold.render("orders", tmp_path, case_type=True)
    feed_dir = tmp_path / "pipelines" / "orders"

    # No placeholder tokens survive anywhere in the rendered variant.
    for path in feed_dir.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "myfeed" not in text, path
        assert "Myfeed" not in text, path

    schema = (feed_dir / "schema.py").read_text(encoding="utf-8")
    case_type = (feed_dir / "case_type.py").read_text(encoding="utf-8")
    assert "class OrdersRow" in schema
    # The Case Type declares the identity contract off the rendered schema.
    assert "from case_review.case_type import CaseType" in case_type
    assert "from .schema import OrdersRow" in case_type
    assert 'name="orders"' in case_type
    assert "schema=OrdersRow" in case_type
    assert "natural_key=" in case_type


def test_case_type_variant_refines_to_silver_and_leaves_gold_a_commented_seam(tmp_path):
    scaffold.render("orders", tmp_path, case_type=True)
    pipeline = (tmp_path / "pipelines" / "orders" / "pipeline.py").read_text(
        encoding="utf-8"
    )

    # The settled ingest spine is rendered live: source -> raw -> silver.
    assert "raw_to_silver(" in pipeline
    assert "from framework.recipes import raw_to_silver" in pipeline
    assert "from framework.run import Pipeline" in pipeline

    # Gold is the author's seam, not a live call, so the scaffold makes no bet
    # on the open snapshot-vs-join assembly decision.
    assert "ingest_silver_to_gold" in pipeline  # shown as guidance...
    for line in pipeline.splitlines():
        if "ingest_silver_to_gold" in line:
            assert line.lstrip().startswith("#"), f"gold step must be inert: {line!r}"


def test_rendered_case_type_pipeline_runs_and_refines_to_silver(tmp_path):
    # Render the variant, then import and run its pipeline the way it runs in
    # production -- a module from a root on sys.path, relative intra-package
    # imports, reaching the real case_review + framework packages. Proves the
    # generated Case Type ingest code is wired correctly through to silver.
    repo = tmp_path / "repo"
    scaffold.render("widgets", repo, case_type=True)

    sys.path.insert(0, str(repo / "pipelines"))
    try:
        pipeline = importlib.import_module("widgets.pipeline")
        importlib.reload(pipeline)
        silver = pipeline.run(
            RunContext(base_dir=tmp_path / "data", pipeline="widgets")
        )
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    store = StoreCatalog(tmp_path / "data").store("widgets")
    raw = read_rows(store, RAW, "widgets")
    silver_rows = read_rows(store, SILVER, "widgets")
    assert len(raw) > 0
    assert len(silver_rows) == len(silver) > 0


def test_cli_case_type_flag_renders_the_variant(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(scaffold, "_REPO_ROOT", tmp_path)

    exit_code = scaffold.main(["--case-type", "orders"])

    assert exit_code == 0
    feed_dir = tmp_path / "pipelines" / "orders"
    # The distinguishing artifact of the variant: the declared identity contract.
    assert (feed_dir / "case_type.py").exists()
    assert (tmp_path / "tests" / "pipelines" / "test_orders.py").exists()
    assert "created" in capsys.readouterr().out


def test_cli_without_case_type_flag_stays_the_generic_feed(tmp_path, monkeypatch):
    # The variant is additive: the plain scaffold stays source -> raw, no Case
    # Type, no case_type.py.
    monkeypatch.setattr(scaffold, "_REPO_ROOT", tmp_path)
    assert scaffold.main(["orders"]) == 0
    assert not (tmp_path / "pipelines" / "orders" / "case_type.py").exists()
