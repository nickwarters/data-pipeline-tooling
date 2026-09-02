"""Tests for the scaffold's ``--case-type`` variant — a cross-tree concern.

The generic scaffold is framework-only and tested under
``tests/framework/_cli/``. The
``--case-type`` variant is different in kind: it renders a case-review-flavoured
slice that declares a Case Type's identity contract, so its tests span the
framework/application boundary and live here in ``tests/integration/`` rather
than coupling the framework scaffold test to the application contract.

The variant is additive over the generic feed: it declares the Case Type's
identity contract and refines source -> raw -> silver (the declared ingest spine),
deliberately stopping at silver and leaving gold as the author's seam while the
snapshot-vs-join assembly remains open.
"""

from __future__ import annotations

import importlib
import sys

from cli import scaffold
from tests.framework_testing import read_rows
from tools.medallion import medallion
from tools.store import StoreRegistry


def test_case_type_variant_lays_down_the_feed_with_its_identity(tmp_path):
    created = scaffold.render("orders", tmp_path, case_type=True)

    feed_dir = tmp_path / "pipelines" / "orders"
    expected = {
        feed_dir / "__init__.py",
        feed_dir / "schema.py",
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
    assert "class OrdersRow" in schema
    assert 'NAMESPACE = "orders"' in schema
    assert 'NATURAL_KEY = ("record_id",)' in schema
    assert not (feed_dir / "case_type.py").exists()


def test_case_type_variant_refines_to_silver_and_leaves_gold_a_commented_seam(tmp_path):
    scaffold.render("orders", tmp_path, case_type=True)
    pipeline = (tmp_path / "pipelines" / "orders" / "pipeline.py").read_text(
        encoding="utf-8"
    )

    # The rendered ingest spine is source -> raw -> silver.
    assert "silver = to_silver(" in pipeline
    assert "med.silver.writer(" in pipeline
    # Rendered against the eager steps, so they execute where they're written.
    assert "from framework.run import (" in pipeline
    assert "    read," in pipeline
    assert "    write," in pipeline

    # Gold is the author's seam, not a live call, so the scaffold makes no bet
    # on the open snapshot-vs-join assembly decision. The seam sketches the
    # reduction inline rather than pointing at a shared builder -- there isn't
    # one, deliberately.
    assert "def to_gold(" in pipeline  # shown as guidance...
    assert "DeriveKey(" in pipeline
    for line in pipeline.splitlines():
        if "def to_gold(" in line or "DeriveKey(" in line:
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
        exit_code = pipeline.main(["prog", "--base-dir", str(tmp_path / "data")])
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    med = medallion(StoreRegistry(tmp_path / "data"), "widgets")
    raw = read_rows(med.raw, "widgets")
    silver_rows = read_rows(med.silver, "widgets")
    assert exit_code == 0
    assert len(raw) > 0
    assert len(silver_rows) == len(raw)


def test_cli_case_type_flag_renders_the_variant(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(scaffold, "_REPO_ROOT", tmp_path)

    exit_code = scaffold.main(["--case-type", "orders"])

    assert exit_code == 0
    feed_dir = tmp_path / "pipelines" / "orders"
    # The distinguishing artifact of the variant: identity beside its schema.
    schema = (feed_dir / "schema.py").read_text(encoding="utf-8")
    assert 'NAMESPACE = "orders"' in schema
    assert 'NATURAL_KEY = ("record_id",)' in schema
    assert not (feed_dir / "case_type.py").exists()
    assert (tmp_path / "tests" / "pipelines" / "test_orders.py").exists()
    assert "created" in capsys.readouterr().out


def test_cli_without_case_type_flag_stays_the_generic_feed(tmp_path, monkeypatch):
    # The variant is additive: the plain scaffold stays source -> raw, no Case
    # Type, no identity declarations.
    monkeypatch.setattr(scaffold, "_REPO_ROOT", tmp_path)
    assert scaffold.main(["orders"]) == 0
    feed_dir = tmp_path / "pipelines" / "orders"
    assert not (feed_dir / "case_type.py").exists()
    schema = (feed_dir / "schema.py").read_text(encoding="utf-8")
    assert "NAMESPACE" not in schema
    assert "NATURAL_KEY" not in schema
