```python
"""Tests for the new-feed scaffold under ``cli/scaffold_templates/feed``.

They cover generated locations, substitution, imports, and execution.
"""

from __future__ import annotations

import importlib
import sys

import pytest

from cli import scaffold
from framework.io import CsvReader
from framework.run import RunContext
from framework.run.run_context import active_context
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    read_rows,
    rows_of,
)
from tools.medallion import medallion
from tools.store import StoreRegistry


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


def test_the_rendered_steps_are_wired_inline(tmp_path):
    repo = tmp_path / "repo"
    scaffold.render("widgets", repo)
    # The steps are wired in the generated feed, not composed from a shared one.
    assert "recipe" not in (repo / "pipelines" / "widgets" / "pipeline.py").read_text(
        "utf-8"
    )

    rows = [{"record_id": "1", "label": "a", "amount": 1}]
    sys.path.insert(0, str(repo / "pipelines"))
    try:
        pipeline = importlib.import_module("widgets.pipeline")
        importlib.reload(pipeline)
        writer, rejects = RecordingWriter(), RecordingWriter()

        # Eager execution records the generated steps.
        raw_log = RecordingRunLog()
        with active_context(RunContext(pipeline="widgets", run_log=raw_log)):
            pipeline.to_raw(given_rows(rows), writer)
        raw_steps = [record["step"] for record in raw_log.records]

        silver_log = RecordingRunLog()
        with active_context(RunContext(pipeline="widgets", run_log=silver_log)):
            pipeline.to_silver(given_rows(rows), writer, rejects)
        silver_steps = [record["step"] for record in silver_log.records]
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    # Every step names the layer it lands in, so the two run logs together read
    # raw:read / silver:read rather than read / read-2.
    assert raw_steps == ["raw:read", "raw:column_validator", "raw:write"]
    # Scaffolded without a feed file, so RENAME is empty and no rename runs.
    # The select runs either way: silver keeps the declared columns and drops
    # anything else raw carried, which is what its baseline declares.
    assert silver_steps == [
        "silver:read",
        "silver:select",
        "silver:coerce",
        "silver:quarantine",
        "silver:schema_validator",
        "silver:write",
    ]


def test_rendered_pipeline_runs_and_lands_its_sample_feed(tmp_path):
    # Render the feed, then import and run its pipeline the way it will run in
    # production -- as a module from a root on sys.path, with relative
    # intra-package imports. Proves the generated feed code is wired correctly.
    repo = tmp_path / "repo"
    scaffold.render("widgets", repo)

    # Import the generated package from its temporary pipelines root without
    # colliding with the repository's production package.
    sys.path.insert(0, str(repo / "pipelines"))
    try:
        pipeline = importlib.import_module("widgets.pipeline")
        importlib.reload(pipeline)  # in case a prior test imported "widgets"
        dataset = pipeline.run(
            RunContext(base_dir=tmp_path / "data", pipeline="widgets")
        )
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    med = medallion(StoreRegistry(tmp_path / "data"), "widgets")
    landed = read_rows(med.raw, "widgets")
    assert len(landed) == len(dataset) > 0
    # Compare raw with the source because silver is coerced and reshaped.
    source = rows_of(
        CsvReader(repo / "pipelines" / "widgets" / "sample_data" / "widgets.csv")
    )
    source_columns = set(source[0])
    assert [{c: row[c] for c in source_columns} for row in landed] == source


def test_rendered_pipeline_main_runs_and_records_a_run(tmp_path, capsys):
    # Drive generated main, including run_pipeline dispatch.
    repo = tmp_path / "repo"
    scaffold.render("widgets", repo)
    base_dir = tmp_path / "data"

    sys.path.insert(0, str(repo / "pipelines"))
    try:
        pipeline = importlib.import_module("widgets.pipeline")
        importlib.reload(pipeline)
        exit_code = pipeline.main(["prog", "--base-dir", str(base_dir)])
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    assert exit_code == 0
    assert "rows source -> raw -> silver -> gold" in capsys.readouterr().out
    # A source feed has no subject, so the run records under _runs/<feed>.log.
    assert (base_dir / "_runs" / "widgets.log").exists()
    med = medallion(StoreRegistry(base_dir), "widgets")
    assert len(read_rows(med.raw, "widgets")) > 0


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
    assert '"order_id": "O1"' in test_text
    assert "record_id" not in test_text  # no leftover template sample rows


def test_clean_identifier_columns_keep_the_schema_driven_validator(tmp_path):
    feed = _write_feed(
        tmp_path / "orders.csv", "order_id,customer\nO1,Acme\nO2,Globex\n"
    )
    scaffold.render("orders", tmp_path, feed_file=feed)

    pipeline = (tmp_path / "pipelines" / "orders" / "pipeline.py").read_text("utf-8")
    assert "RAW_FEED_COLUMNS" not in pipeline
    # ``to_raw``'s column gate is driven by the schema's own fields.
    assert "expected = [f.name for f in fields(OrdersRow)]" in pipeline


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
    assert (
        'RAW_FEED_COLUMNS = [\n    "Case Number",\n    "Adviser Name",\n]' in pipeline
    )
    assert "expected = RAW_FEED_COLUMNS" in pipeline
    assert "fields(" not in pipeline  # schema-driven validator dropped
    # The relocated test follows: validator columns, not schema fields.
    assert (
        "from pipelines.cases.pipeline import FEED_NAME, RAW_FEED_COLUMNS" in test_text
    )
    assert "set(RAW_FEED_COLUMNS).issubset(landed[0].keys())" in test_text


def test_feed_file_over_the_column_limit_truncates_with_a_note(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.setattr(scaffold, "_MAX_FEED_COLUMNS", 3)
    feed = _write_feed(tmp_path / "wide.csv", "a,b,c,d,e\n1,2,3,4,5\n")
    scaffold.render("wide", tmp_path, feed_file=feed)

    schema = (tmp_path / "pipelines" / "wide" / "schema.py").read_text("utf-8")
    fields = [
        line for line in schema.splitlines() if line.startswith("    ") and ": " in line
    ]
    assert len(fields) == 3  # kept the first three columns only
    assert "2 column(s) beyond the scaffold's limit of 3 were dropped" in schema
    assert "remaining 2 still land in raw" in capsys.readouterr().err


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
        dataset = pipeline.run(
            RunContext(base_dir=tmp_path / "data", pipeline="widgets")
        )
    finally:
        sys.path.remove(str(repo / "pipelines"))
        for name in list(sys.modules):
            if name == "widgets" or name.startswith("widgets."):
                del sys.modules[name]

    med = medallion(StoreRegistry(tmp_path / "data"), "widgets")
    landed = read_rows(med.raw, "widgets")
    assert len(landed) == len(dataset) > 0
    assert {"Case Number", "Adviser Name"}.issubset(landed[0].keys())


def _function_body(text: str, name: str) -> str:
    start = text.index(f"def {name}(")
    nxt = text.find("\ndef ", start + 1)
    return text[start:] if nxt == -1 else text[start:nxt]


def test_feed_file_seeds_structural_rejection_rows_missing_a_column(tmp_path):
    # Generated negative tests remain structurally invalid after seeding.
    feed = _write_feed(
        tmp_path / "cases.csv",
        "Case Number,Adviser Name\nC1,Smith\nC2,Jones\n",
    )
    scaffold.render("cases", tmp_path, feed_file=feed)

    test_text = (tmp_path / "tests" / "pipelines" / "test_cases.py").read_text("utf-8")
    assert "invalid_col" not in test_text  # the template sentinel is gone

    for name in (
        "test_to_raw_gates_source_columns",
        "test_to_silver_aborts_on_structural_breaches",
    ):
        body = _function_body(test_text, name)
        assert '"Case Number": "C1"' in body  # seeded with the real feed columns
        assert '"Adviser Name"' not in body  # ...minus the dropped required one

    # A non-rejection block is seeded with the full rows, dropped column included.
    quarantine = _function_body(
        test_text, "test_to_silver_quarantines_value_rule_breaches"
    )
    assert '"Case Number": "C1", "Adviser Name": "Smith"' in quarantine


# --- migrations --------------------------------------------------------------
#
# Baselines cover every database a generated feed writes.


def _migration(root, feed, database):
    return (
        root / "migrations" / feed / database / "0001_create_initial_tables.sql"
    ).read_text(encoding="utf-8")


def test_a_scaffolded_feed_declares_every_database_it_writes(tmp_path):
    scaffold.render("orders", tmp_path)

    databases = sorted(p.name for p in (tmp_path / "migrations" / "orders").iterdir())

    # Quarantine included: a reject table is a table like any other, and a feed
    # whose reject table is undeclared would abort the first time it rejected a
    # row — a failure that only shows up on the bad-data path.
    assert databases == ["gold", "quarantine", "raw", "silver"]


def test_the_case_type_variant_declares_nothing_for_gold(tmp_path):
    # It stops at silver, because how silver is assembled into gold is
    # per-Case-Type and an open decision. A gold baseline would be a guess.
    scaffold.render("claims", tmp_path, case_type=True)

    databases = sorted(p.name for p in (tmp_path / "migrations" / "claims").iterdir())

    assert databases == ["quarantine", "raw", "silver"]


def test_the_baseline_declares_the_schema_plus_what_the_wiring_stamps(tmp_path):
    scaffold.render("orders", tmp_path)

    silver = _migration(tmp_path, "orders", "silver")

    for column in ("record_id", "label", "amount"):
        assert f'"{column}"' in silver
    # AccumulateByRun stamps the business run and its date; every table-backed
    # Writer stamps the run that wrote the row.
    for column in ("logical_run_id", "load_date", "pipeline_run_id"):
        assert f'"{column}"' in silver
    assert '"amount" INTEGER' in silver
    assert '"record_id" TEXT' in silver


def test_the_reject_table_carries_the_rule_that_rejected_the_row(tmp_path):
    scaffold.render("orders", tmp_path)

    assert '"failed_rule"' in _migration(tmp_path, "orders", "quarantine")


def test_raw_is_declared_in_the_sources_own_column_names(tmp_path):
    # Raw lands the source faithfully and the rename to canonical names happens
    # at silver, so a header that is not a clean identifier is declared as it
    # arrives — the same split RAW_FEED_COLUMNS / RENAME make in the code.
    feed = _write_feed(tmp_path / "cases.csv", "Case Number,Adviser Name\nC1,Smith\n")
    scaffold.render("cases", tmp_path, feed_file=feed)

    assert '"Case Number"' in _migration(tmp_path, "cases", "raw")
    assert '"case_number"' in _migration(tmp_path, "cases", "silver")


def test_a_scaffolded_feed_runs_against_its_own_migrations(tmp_path, monkeypatch):
    # Apply migrations before running the generated feed.
    import sys

    from framework.run.run_context import RunContext
    from tests.framework_testing import build_databases

    scaffold.render("orders", tmp_path)
    (tmp_path / "pipelines" / "__init__.py").write_text("", encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    for name in list(sys.modules):
        if name.startswith("pipelines"):
            monkeypatch.delitem(sys.modules, name, raising=False)

    from pipelines.orders import pipeline as feed  # noqa: PLC0415

    base_dir = tmp_path / "data"
    build_databases(base_dir, "orders", migrations_root=tmp_path / "migrations")
    feed.run(RunContext(base_dir=base_dir, pipeline="orders"))

    landed = _rows(base_dir / "orders" / "gold.db", "orders")
    assert landed


_MAX = scaffold._MAX_FEED_COLUMNS


def _feed_file(tmp_path, headers):
    import csv  # noqa: PLC0415

    path = tmp_path / "source.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        for row in range(3):
            writer.writerow([f"v{row}_{i}" for i in range(len(headers))])
    return path


def test_a_narrow_feed_file_scaffolds_and_runs_against_its_own_migrations(
    tmp_path, monkeypatch
):
    # Exercise the capped feed-file path end to end.
    import importlib  # noqa: PLC0415
    import sys  # noqa: PLC0415

    from framework.run.run_context import RunContext  # noqa: PLC0415
    from tests.framework_testing import build_databases  # noqa: PLC0415

    header = ["Ref Code", "Some Label", "amount"]
    scaffold.render("narrow", tmp_path, feed_file=_feed_file(tmp_path, header))
    (tmp_path / "pipelines" / "__init__.py").write_text("", encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    for name in list(sys.modules):
        if name.startswith("pipelines"):
            monkeypatch.delitem(sys.modules, name, raising=False)

    feed_module = importlib.import_module("pipelines.narrow.pipeline")
    base_dir = tmp_path / "data"
    build_databases(base_dir, "narrow", migrations_root=tmp_path / "migrations")
    feed_module.run(RunContext(base_dir=base_dir, pipeline="narrow"))

    # raw carries the source's own spellings, silver the canonical ones.
    assert "Ref Code" in _columns(base_dir / "narrow" / "raw.db", "narrow")
    assert "ref_code" in _columns(base_dir / "narrow" / "silver.db", "narrow")


def test_a_source_wider_than_the_cap_runs_and_stops_at_raw(tmp_path, monkeypatch):
    # Raw keeps all source columns; silver and gold keep only capped canonical columns.
    import importlib  # noqa: PLC0415
    import sys  # noqa: PLC0415

    from framework.run.run_context import RunContext  # noqa: PLC0415
    from tests.framework_testing import build_databases  # noqa: PLC0415

    header = [f"Ref Code {i}!" for i in range(_MAX + 5)]
    scaffold.render("wide", tmp_path, feed_file=_feed_file(tmp_path, header))
    (tmp_path / "pipelines" / "__init__.py").write_text("", encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    for name in list(sys.modules):
        if name.startswith("pipelines"):
            monkeypatch.delitem(sys.modules, name, raising=False)

    feed_module = importlib.import_module("pipelines.wide.pipeline")
    base_dir = tmp_path / "data"
    build_databases(base_dir, "wide", migrations_root=tmp_path / "migrations")
    feed_module.run(RunContext(base_dir=base_dir, pipeline="wide"))

    raw = _columns(base_dir / "wide" / "raw.db", "wide")
    assert f"Ref Code {_MAX + 4}!" in raw  # the last source column, verbatim

    for database in ("silver", "gold"):
        landed = _columns(base_dir / database.join(["wide/", ".db"]), "wide")
        assert f"ref_code_{_MAX - 1}" in landed  # the last declared field
        assert f"Ref Code {_MAX}!" not in landed  # ...and nothing past the cap
        assert f"ref_code_{_MAX}" not in landed


def test_raw_mirrors_the_whole_feed_file_while_silver_follows_the_capped_schema(
    tmp_path,
):
    # Raw declares every source column; capped silver and gold declare the selection.
    header = [f"Ref Code {i}!" for i in range(_MAX + 5)]
    scaffold.render("wide", tmp_path, feed_file=_feed_file(tmp_path, header))

    raw = _migration(tmp_path, "wide", "raw")
    for column in header:
        assert f'"{column}"' in raw

    for database in ("silver", "gold"):
        sql = _migration(tmp_path, "wide", database)
        assert '"ref_code_1"' in sql
        # ...and nothing past the cap, under either spelling.
        assert f'"Ref Code {_MAX}!"' not in sql
        assert f'"ref_code_{_MAX + 1}"' not in sql


def test_the_dropped_columns_warning_says_where_they_go(tmp_path, capsys):
    # Dropped columns remain in raw and are omitted from silver.
    header = [f"col_{i}" for i in range(_MAX + 5)]
    scaffold.render("wide", tmp_path, feed_file=_feed_file(tmp_path, header))

    warning = capsys.readouterr().err
    assert "remaining 5 still land in raw" in warning
    assert "SELECT_RAW_COLUMNS drops them at silver" in warning


def _columns(db_path, table):
    import sqlite3

    con = sqlite3.connect(db_path)
    try:
        return [row[1] for row in con.execute(f"PRAGMA table_info({table})")]
    finally:
        con.close()


def _rows(db_path, table):
    import sqlite3

    con = sqlite3.connect(db_path)
    try:
        return con.execute(f'SELECT * FROM "{table}"').fetchall()
    finally:
        con.close()


def test_the_template_fields_the_plan_assumes_are_the_templates_own(tmp_path):
    # The plan hard-codes the template's declared fields, because there is no
    # feed file to read them from. If the template's schema changes and this map
    # does not, a scaffolded feed's baseline would silently describe the old one.
    scaffold.render("orders", tmp_path)
    schema_text = (tmp_path / "pipelines" / "orders" / "schema.py").read_text("utf-8")

    for name, _ in scaffold._TEMPLATE_FIELDS:
        assert f"    {name}:" in schema_text
    declared = [
        line.split(":")[0].strip()
        for line in schema_text.splitlines()
        if line.startswith("    ") and ":" in line and not line.strip().startswith("#")
    ]
    assert declared == [name for name, _ in scaffold._TEMPLATE_FIELDS]

```
