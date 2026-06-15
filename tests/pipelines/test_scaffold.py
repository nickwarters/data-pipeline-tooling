"""Tests for the new-feed scaffold.

The scaffold renders a feed from the template under ``pipelines/_scaffold_template/``:
the feed *code* as a subpackage ``pipelines/<feed>/`` and its *test* under
``tests/pipelines/`` (mirroring the source layout). These tests drive the
generator: that it lays the artifacts down in those two homes, substitutes the
feed name everywhere, rewrites the relocated test's imports to absolute, and that
the rendered pipeline actually runs.
"""

from __future__ import annotations

import importlib
import sys

from framework.core import RAW, SILVER
from framework.io import StoreCatalog
from framework.testing import read_rows, rows_of
from pipelines import scaffold


def test_render_lays_down_the_feed_code_and_its_test(tmp_path):
    created = scaffold.render("orders", tmp_path)

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


def test_render_substitutes_the_feed_name_everywhere(tmp_path):
    scaffold.render("orders", tmp_path)
    feed_dir = tmp_path / "pipelines" / "orders"
    test_path = tmp_path / "tests" / "pipelines" / "test_orders.py"

    for path in (*feed_dir.rglob("*.py"), test_path):
        text = path.read_text(encoding="utf-8")
        assert "myfeed" not in text, path
        assert "Myfeed" not in text, path

    schema = (feed_dir / "schema.py").read_text(encoding="utf-8")
    pipeline = (feed_dir / "pipeline.py").read_text(encoding="utf-8")
    assert "class OrdersRow" in schema
    assert 'FEED_NAME = "orders"' in pipeline
    # Feed code stays a package, so its intra-package imports stay relative.
    assert "from .schema import OrdersRow" in pipeline


def test_render_rewrites_the_relocated_test_to_absolute_imports(tmp_path):
    # The test moves out of the feed package into tests/pipelines/, so its
    # imports of the feed's own modules must become absolute.
    scaffold.render("orders", tmp_path)
    test_text = (tmp_path / "tests" / "pipelines" / "test_orders.py").read_text(
        encoding="utf-8"
    )
    assert "from pipelines.orders.pipeline import" in test_text
    assert "from pipelines.orders.schema import OrdersRow" in test_text
    assert "from .pipeline import" not in test_text
    assert "from .schema import" not in test_text


def test_render_pascal_cases_a_multi_word_feed_name(tmp_path):
    scaffold.render("review_outcomes", tmp_path)
    schema = (tmp_path / "pipelines" / "review_outcomes" / "schema.py").read_text(
        encoding="utf-8"
    )
    assert "class ReviewOutcomesRow" in schema


def test_rendered_pipeline_runs_and_lands_its_sample_feed(tmp_path):
    # Render the feed, then import and run its pipeline the way it will run in
    # production -- as a module from a root on sys.path, with relative
    # intra-package imports. Proves the generated feed code is wired correctly.
    repo = tmp_path / "repo"
    scaffold.render("widgets", repo)

    # The feed package lives at repo/pipelines/widgets; put repo/pipelines on the
    # path so it imports as the top-level package "widgets" (relative imports and
    # all), without colliding with this repo's own real "pipelines" package.
    sys.path.insert(0, str(repo / "pipelines"))
    try:
        pipeline = importlib.import_module("widgets.pipeline")
        importlib.reload(pipeline)  # in case a prior test imported "widgets"
        dataset = pipeline.run(tmp_path / "data")
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    store = StoreCatalog(tmp_path / "data").store("widgets")
    landed = read_rows(store, RAW, "widgets")
    assert len(landed) == len(dataset) > 0
    assert landed == rows_of(dataset)


def test_cli_creates_the_feed_and_reports_it(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(scaffold, "_REPO_ROOT", tmp_path)

    exit_code = scaffold.main(["orders"])

    assert exit_code == 0
    pipeline = tmp_path / "pipelines" / "orders" / "pipeline.py"
    test_file = tmp_path / "tests" / "pipelines" / "test_orders.py"
    assert pipeline.exists()
    assert test_file.exists()
    out = capsys.readouterr().out
    assert "created" in out
    assert str(pipeline) in out
    assert str(test_file) in out


def test_cli_refuses_to_overwrite_unless_forced(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(scaffold, "_REPO_ROOT", tmp_path)
    assert scaffold.main(["orders"]) == 0
    # Edit the rendered pipeline; a refused re-run must leave it untouched.
    rendered = tmp_path / "pipelines" / "orders" / "pipeline.py"
    rendered.write_text("# hand-edited\n", encoding="utf-8")

    assert scaffold.main(["orders"]) == 1
    assert "already exists" in capsys.readouterr().err
    assert rendered.read_text(encoding="utf-8") == "# hand-edited\n"

    # --force re-renders over the top.
    assert scaffold.main(["orders", "--force"]) == 0
    assert "FEED_NAME" in rendered.read_text(encoding="utf-8")


def test_cli_rejects_an_invalid_feed_name(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(scaffold, "_REPO_ROOT", tmp_path)
    assert scaffold.main(["123orders"]) == 1
    assert not (tmp_path / "pipelines" / "123orders").exists()
    assert "identifier" in capsys.readouterr().err


# A separate, additive variant for a feed whose rows *are* a Case Type: it
# declares the Case Type's identity contract and refines source -> raw -> silver
# (the settled ingest spine), deliberately stopping at silver and leaving gold
# as the author's seam while the snapshot-vs-join assembly remains open.


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
    assert "from framework.run import Pipeline, raw_to_silver" in pipeline

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
        silver = pipeline.run(tmp_path / "data")
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
