"""Tests for the new-feed scaffold (issue #97).

The scaffold renders a self-contained feed subpackage from the template under
``pipelines/_scaffold_template/``. These tests drive the generator: that it lays
down the four artifacts, substitutes the feed name everywhere, and that the
rendered pipeline actually runs from an arbitrary location via relative imports.
"""

from __future__ import annotations

import importlib
import sys

from framework.io import RAW, StoreCatalog
from framework.testing import read_rows, rows_of

from pipelines import scaffold


def test_render_lays_down_the_four_feed_artifacts(tmp_path):
    created = scaffold.render("orders", tmp_path)

    feed_dir = tmp_path / "orders"
    expected = {
        feed_dir / "__init__.py",
        feed_dir / "schema.py",
        feed_dir / "pipeline.py",
        feed_dir / "sample_data" / "orders.csv",
        feed_dir / "test_orders.py",
    }
    assert expected.issubset(set(created))
    for path in expected:
        assert path.exists(), path


def test_render_substitutes_the_feed_name_everywhere(tmp_path):
    scaffold.render("orders", tmp_path)
    feed_dir = tmp_path / "orders"

    for path in feed_dir.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "myfeed" not in text, path
        assert "Myfeed" not in text, path

    schema = (feed_dir / "schema.py").read_text(encoding="utf-8")
    pipeline = (feed_dir / "pipeline.py").read_text(encoding="utf-8")
    assert "class OrdersRow" in schema
    assert 'FEED_NAME = "orders"' in pipeline
    assert "from .schema import OrdersRow" in pipeline


def test_render_pascal_cases_a_multi_word_feed_name(tmp_path):
    scaffold.render("review_outcomes", tmp_path)
    schema = (tmp_path / "review_outcomes" / "schema.py").read_text(encoding="utf-8")
    assert "class ReviewOutcomesRow" in schema


def test_rendered_pipeline_runs_and_lands_its_sample_feed(tmp_path):
    # Render the feed into a package root, then import and run it the way it will
    # run in production -- as a module from a root on sys.path, with relative
    # intra-package imports. Proves the generated code is wired correctly.
    pkg_root = tmp_path / "pkg"
    pkg_root.mkdir()
    scaffold.render("widgets", pkg_root)

    sys.path.insert(0, str(pkg_root))
    try:
        pipeline = importlib.import_module("widgets.pipeline")
        importlib.reload(pipeline)  # in case a prior test imported "widgets"
        dataset = pipeline.run(tmp_path / "data")
    finally:
        sys.path.remove(str(pkg_root))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    store = StoreCatalog(tmp_path / "data").store("widgets")
    landed = read_rows(store, RAW, "widgets")
    assert len(landed) == len(dataset) > 0
    assert landed == rows_of(dataset)


def test_cli_creates_the_feed_and_reports_it(tmp_path, capsys):
    exit_code = scaffold.main(["orders", "--dest", str(tmp_path)])

    assert exit_code == 0
    assert (tmp_path / "orders" / "pipeline.py").exists()
    out = capsys.readouterr().out
    assert "created" in out
    assert str(tmp_path / "orders" / "pipeline.py") in out


def test_cli_refuses_to_overwrite_unless_forced(tmp_path, capsys):
    assert scaffold.main(["orders", "--dest", str(tmp_path)]) == 0
    # Edit the rendered pipeline; a refused re-run must leave it untouched.
    rendered = tmp_path / "orders" / "pipeline.py"
    rendered.write_text("# hand-edited\n", encoding="utf-8")

    assert scaffold.main(["orders", "--dest", str(tmp_path)]) == 1
    assert "already exists" in capsys.readouterr().err
    assert rendered.read_text(encoding="utf-8") == "# hand-edited\n"

    # --force re-renders over the top.
    assert scaffold.main(["orders", "--dest", str(tmp_path), "--force"]) == 0
    assert "FEED_NAME" in rendered.read_text(encoding="utf-8")


def test_cli_rejects_an_invalid_feed_name(tmp_path, capsys):
    assert scaffold.main(["123orders", "--dest", str(tmp_path)]) == 1
    assert not (tmp_path / "123orders").exists()
    assert "identifier" in capsys.readouterr().err
