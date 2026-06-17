```python
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

from framework.core import RAW
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


```
