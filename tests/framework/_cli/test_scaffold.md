```python
"""Tests for the new-feed scaffold.

The scaffold renders a feed from the template under
``framework/_cli/scaffold_templates/feed/``: the feed *code* as a subpackage
``pipelines/<feed>/`` and its *test* under
``tests/pipelines/`` (mirroring the source layout). These tests drive the
generator: that it lays the artifacts down in those two homes, substitutes the
feed name everywhere, rewrites the relocated test's imports to absolute, and that
the rendered pipeline actually runs.
"""

from __future__ import annotations

import importlib
import sys

import pytest

from framework.core import RAW
from framework.io import StoreCatalog
from framework.run import RunContext
from tests.framework_testing import read_rows, rows_of
from cli import scaffold


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
        dataset = pipeline.run(RunContext(base_dir=tmp_path / "data", pipeline="widgets"))
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    store = StoreCatalog(tmp_path / "data").store("widgets")
    landed = read_rows(store, RAW, "widgets")
    assert len(landed) == len(dataset) > 0
    # raw accumulates under the run context, so landed rows carry the run's
    # stamps (run_id / load_date / ...) on top of the source columns; the source
    # columns themselves land faithfully.
    source_columns = set(rows_of(dataset)[0])
    assert [{c: row[c] for c in source_columns} for row in landed] == rows_of(dataset)


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


# --- --from-feed-file: seed the scaffold from a real sample CSV ----------------


def _write_feed(path, text):
    path.write_text(text, encoding="utf-8")
    return path


def test_feed_file_seeds_schema_fields_and_infers_dtypes(tmp_path):
    feed = _write_feed(
        tmp_path / "orders.csv",
        "order_id,customer,total,rate\nO1,Acme,100,0.5\nO2,Globex,250,1.5\n",
    )
    scaffold.render("orders", tmp_path, feed_file=feed)

    schema = (tmp_path / "pipelines" / "orders" / "schema.py").read_text("utf-8")
    assert "class OrdersRow:" in schema
    # Field names come from the header; dtypes are inferred from the sample rows.
    assert "order_id: str" in schema
    assert "total: int" in schema
    assert "rate: float" in schema


def test_feed_file_infers_float_for_an_integer_column_with_blanks(tmp_path):
    # An integer column with a blank is nullable; pandas promotes it to float64
    # on read-back, so inferring `int` would fail the silver dtype gate. It must
    # infer `float` to match the type the storage round-trip yields.
    feed = _write_feed(
        tmp_path / "orders.csv",
        "order_id,total\nO1,100\nO2,\nO3,250\n",
    )
    scaffold.render("orders", tmp_path, feed_file=feed)

    schema = (tmp_path / "pipelines" / "orders" / "schema.py").read_text("utf-8")
    assert "total: float" in schema


def test_feed_file_contents_replace_the_bundled_sample(tmp_path):
    body = "order_id,customer,total\nO1,Acme,100\nO2,Globex,250\n"
    feed = _write_feed(tmp_path / "orders.csv", body)
    scaffold.render("orders", tmp_path, feed_file=feed)

    sample = tmp_path / "pipelines" / "orders" / "sample_data" / "orders.csv"
    assert sample.read_text("utf-8") == body


def test_feed_file_seeds_the_tests_sample_rows(tmp_path):
    feed = _write_feed(
        tmp_path / "orders.csv",
        "order_id,customer,total\nO1,Acme,100\nO2,Globex,250\n",
    )
    scaffold.render("orders", tmp_path, feed_file=feed)

    test_text = (tmp_path / "tests" / "pipelines" / "test_orders.py").read_text("utf-8")
    assert '{"order_id": "O1", "customer": "Acme", "total": 100}' in test_text
    assert "record_id" not in test_text  # no leftover template sample rows


def test_clean_identifier_columns_keep_the_schema_driven_validator(tmp_path):
    feed = _write_feed(
        tmp_path / "orders.csv", "order_id,customer\nO1,Acme\nO2,Globex\n"
    )
    scaffold.render("orders", tmp_path, feed_file=feed)

    pipeline = (tmp_path / "pipelines" / "orders" / "pipeline.py").read_text("utf-8")
    assert "RAW_FEED_COLUMNS" not in pipeline
    assert "ColumnValidator([f.name for f in fields(OrdersRow)])" in pipeline


def test_non_identifier_columns_gate_the_validator_on_raw_names(tmp_path):
    feed = _write_feed(
        tmp_path / "cases.csv",
        "Case Number,Adviser Name\nC1,Smith\nC2,Jones\n",
    )
    scaffold.render("cases", tmp_path, feed_file=feed)

    feed_dir = tmp_path / "pipelines" / "cases"
    schema = (feed_dir / "schema.py").read_text("utf-8")
    pipeline = (feed_dir / "pipeline.py").read_text("utf-8")
    test_text = (tmp_path / "tests" / "pipelines" / "test_cases.py").read_text("utf-8")

    # Schema canonicalises the source names to identifiers...
    assert "case_number: str" in schema
    assert "adviser_name: str" in schema
    # ...while the validator gates on the verbatim source names.
    assert 'RAW_FEED_COLUMNS = [\n    "Case Number",\n    "Adviser Name",\n]' in pipeline
    assert "ColumnValidator(RAW_FEED_COLUMNS)" in pipeline
    assert "fields(" not in pipeline  # schema-driven validator dropped
    # The relocated test follows: validator columns, not schema fields.
    assert "from pipelines.cases.pipeline import FEED_NAME, RAW_FEED_COLUMNS" in test_text
    assert "set(RAW_FEED_COLUMNS).issubset(landed[0].keys())" in test_text


def test_feed_file_over_the_column_limit_truncates_with_a_note(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(scaffold, "_MAX_FEED_COLUMNS", 3)
    feed = _write_feed(tmp_path / "wide.csv", "a,b,c,d,e\n1,2,3,4,5\n")
    scaffold.render("wide", tmp_path, feed_file=feed)

    schema = (tmp_path / "pipelines" / "wide" / "schema.py").read_text("utf-8")
    fields = [line for line in schema.splitlines() if line.startswith("    ") and ": " in line]
    assert len(fields) == 3  # kept the first three columns only
    assert "2 column(s) beyond the scaffold's limit of 3 were dropped" in schema
    assert "dropping the remaining 2" in capsys.readouterr().err


def test_feed_file_not_supported_with_case_type(tmp_path):
    feed = _write_feed(tmp_path / "f.csv", "a\n1\n")
    with pytest.raises(ValueError, match="not supported with --case-type"):
        scaffold.render("foo", tmp_path, feed_file=feed, case_type=True)


def test_missing_feed_file_is_reported(tmp_path):
    with pytest.raises(FileNotFoundError):
        scaffold.render("foo", tmp_path, feed_file=tmp_path / "nope.csv")


def test_rendered_feed_from_a_spaced_file_runs_and_its_test_passes(tmp_path):
    # End-to-end: render a non-identifier-column feed from a sample file, then
    # import and run it as a module the way production does, and land its sample.
    repo = tmp_path / "repo"
    feed = _write_feed(
        tmp_path / "cases.csv",
        "Case Number,Adviser Name\nC1,Smith\nC2,Jones\n",
    )
    scaffold.render("widgets", repo, feed_file=feed)

    sys.path.insert(0, str(repo / "pipelines"))
    try:
        pipeline = importlib.import_module("widgets.pipeline")
        importlib.reload(pipeline)
        dataset = pipeline.run(RunContext(base_dir=tmp_path / "data", pipeline="widgets"))
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    store = StoreCatalog(tmp_path / "data").store("widgets")
    landed = read_rows(store, RAW, "widgets")
    assert len(landed) == len(dataset) > 0
    assert {"Case Number", "Adviser Name"}.issubset(landed[0].keys())


```
