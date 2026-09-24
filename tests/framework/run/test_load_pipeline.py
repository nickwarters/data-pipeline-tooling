"""``load_pipeline`` tells "no pipeline here" from "a pipeline that won't load"."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest

from framework.run import PipelineLoadError, UnknownPipelineError, load_pipeline


@pytest.fixture
def package(tmp_path, monkeypatch):
    """A fresh, importable top-level package; returns ``(name, dir)``."""
    name = f"loadtest_{uuid.uuid4().hex[:8]}"
    root = tmp_path / name
    root.mkdir()
    (root / "__init__.py").write_text("")
    monkeypatch.syspath_prepend(str(tmp_path))
    yield name, root
    for module in [m for m in sys.modules if m.split(".")[0] == name]:
        del sys.modules[module]


def _pipeline(root: Path, feed: str, source: str) -> None:
    (root / feed).mkdir()
    (root / feed / "__init__.py").write_text("")
    (root / feed / "pipeline.py").write_text(source)


def test_a_path_with_no_pipeline_module_is_unknown(package):
    name, _ = package
    with pytest.raises(UnknownPipelineError, match="no pipeline at"):
        load_pipeline(f"{name}/nope")


def test_a_feed_directory_without_a_pipeline_file_is_unknown(package):
    name, root = package
    (root / "empty").mkdir()
    (root / "empty" / "__init__.py").write_text("")
    with pytest.raises(UnknownPipelineError, match="no pipeline at"):
        load_pipeline(f"{name}/empty")


def test_a_missing_dependency_of_the_pipeline_is_a_load_error(package):
    name, root = package
    _pipeline(root, "orders", "import not_installed_anywhere\n\ndef run(c): ...\n")

    with pytest.raises(PipelineLoadError) as raised:
        load_pipeline(f"{name}/orders")

    message = str(raised.value)
    assert f"pipeline '{name}/orders' exists but could not be loaded" in message
    assert "ModuleNotFoundError: No module named 'not_installed_anywhere'" in message
    assert "pipeline.py:1, in <module>" in message
    assert "  import not_installed_anywhere" in message
    assert isinstance(raised.value.__cause__, ModuleNotFoundError)
    assert raised.value.category == "code"


def test_a_missing_sibling_module_inside_the_feed_is_a_load_error(package):
    # `from .schema import X` with no schema.py: the missing module lives *under*
    # the feed, so it must not be mistaken for the pipeline itself being absent.
    name, root = package
    _pipeline(root, "orders", "from .schema import Row\n\ndef run(c): ...\n")

    with pytest.raises(
        PipelineLoadError, match=rf"No module named '{name}.orders.schema'"
    ):
        load_pipeline(f"{name}/orders")


def test_a_syntax_error_names_the_file_and_line_it_is_on(package):
    name, root = package
    _pipeline(root, "orders", "def run(c):\n    return (\n\nx = = 1\n")

    with pytest.raises(PipelineLoadError) as raised:
        load_pipeline(f"{name}/orders")

    message = str(raised.value)
    assert "raised SyntaxError" in message
    assert "orders" in message and "pipeline.py:" in message


def test_a_top_level_statement_that_raises_names_its_line(package):
    name, root = package
    _pipeline(root, "orders", "LIMIT = int('ten')\n\ndef run(c): ...\n")

    with pytest.raises(PipelineLoadError) as raised:
        load_pipeline(f"{name}/orders")

    message = str(raised.value)
    assert "ValueError: invalid literal for int()" in message
    assert "pipeline.py:1, in <module>" in message
    assert "LIMIT = int('ten')" in message


def test_a_module_without_run_is_still_unknown(package):
    name, root = package
    _pipeline(root, "orders", "X = 1\n")
    with pytest.raises(UnknownPipelineError, match="defines no run"):
        load_pipeline(f"{name}/orders")
