"""Generating a subject's baseline migrations from what the code produces.

The load-bearing test here is the last one: it runs the real `sharepoint_cases`
pipeline against its bundled fixture, generates baselines from the databases that
run wrote, applies them to an empty base directory, and asserts the result is the
same shape. That is the whole claim of #689 — the generated DDL reproduces what a
current run creates — and it is checked end to end rather than asserted.
"""

import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import generate_baseline_migrations as generator  # noqa: E402
from tools.baseline_ddl import Column  # noqa: E402
from tools.migrations import MigrationRunner, discover_targets  # noqa: E402


def _database(path, *statements):
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    for statement in statements:
        con.execute(statement)
    con.commit()
    con.close()


def _columns(db_path, table):
    con = sqlite3.connect(db_path)
    try:
        return [(row[1], row[2]) for row in con.execute(f"PRAGMA table_info({table})")]
    finally:
        con.close()


def test_every_database_a_subject_has_gets_a_baseline(tmp_path):
    base = tmp_path / "data"
    _database(base / "cases" / "silver.db", "CREATE TABLE cases (case_id TEXT)")
    _database(base / "cases" / "gold.db", "CREATE TABLE counts (n INTEGER)")
    # Quarantine is a database of the subject like any other, so it earns its own
    # migrations directory rather than being smuggled into silver's.
    _database(base / "cases" / "quarantine.db", "CREATE TABLE rejects (why TEXT)")
    out = tmp_path / "migrations"

    assert (
        generator.generate(
            "cases", base_dir=base, databases=[], out_root=out, to_stdout=False
        )
        == 0
    )

    assert [t.namespace for t in discover_targets(out)] == [
        "cases/gold",
        "cases/quarantine",
        "cases/silver",
    ]


def test_the_generated_sql_recreates_the_tables_it_was_read_from(tmp_path):
    base = tmp_path / "data"
    _database(
        base / "cases" / "silver.db",
        "CREATE TABLE cases (case_id TEXT, opened TIMESTAMP, score REAL)",
        "CREATE TABLE notes (case_id TEXT, note TEXT)",
    )
    out = tmp_path / "migrations"
    generator.generate(
        "cases", base_dir=base, databases=[], out_root=out, to_stdout=False
    )

    rebuilt = tmp_path / "rebuilt.db"
    MigrationRunner(rebuilt, out / "cases" / "silver").apply()

    assert _columns(rebuilt, "cases") == _columns(base / "cases" / "silver.db", "cases")
    assert _columns(rebuilt, "notes") == [("case_id", "TEXT"), ("note", "TEXT")]


def test_the_ledger_and_the_scratch_tables_are_not_part_of_a_baseline(tmp_path):
    # schema_migrations is the runner's own bookkeeping and a staging table is a
    # merge's scratch space stranded by a killed process; neither is data.
    base = tmp_path / "data"
    _database(
        base / "cases" / "silver.db",
        "CREATE TABLE cases (case_id TEXT)",
        "CREATE TABLE schema_migrations (name TEXT PRIMARY KEY)",
        "CREATE TABLE _stage_cases (case_id TEXT)",
    )
    out = tmp_path / "migrations"
    generator.generate(
        "cases", base_dir=base, databases=[], out_root=out, to_stdout=False
    )

    sql = (out / "cases" / "silver" / "0001_create_initial_tables.sql").read_text()
    assert "schema_migrations" not in sql
    assert "_stage_cases" not in sql


def test_a_checked_in_baseline_is_never_overwritten(tmp_path, capsys):
    # Baselines are generated once and maintained by hand: the runner's checksum
    # refuses an edited file, so silently rewriting one would strand every
    # database that had already applied it.
    base = tmp_path / "data"
    _database(base / "cases" / "silver.db", "CREATE TABLE cases (case_id TEXT)")
    out = tmp_path / "migrations"
    generator.generate(
        "cases", base_dir=base, databases=[], out_root=out, to_stdout=False
    )
    existing = (out / "cases" / "silver" / "0001_create_initial_tables.sql").read_text()

    code = generator.generate(
        "cases", base_dir=base, databases=[], out_root=out, to_stdout=False
    )

    assert code == 1
    assert "refusing to overwrite" in capsys.readouterr().err
    assert (
        out / "cases" / "silver" / "0001_create_initial_tables.sql"
    ).read_text() == existing


def test_stdout_mode_writes_nothing(tmp_path, capsys):
    base = tmp_path / "data"
    _database(base / "cases" / "silver.db", "CREATE TABLE cases (case_id TEXT)")
    out = tmp_path / "migrations"

    generator.generate(
        "cases", base_dir=base, databases=[], out_root=out, to_stdout=True
    )

    assert "CREATE TABLE" in capsys.readouterr().out
    assert not out.exists()


def test_a_subject_with_no_databases_is_reported_rather_than_silently_empty(
    tmp_path, capsys
):
    code = generator.generate(
        "absent",
        base_dir=tmp_path / "data",
        databases=[],
        out_root=tmp_path / "migrations",
        to_stdout=False,
    )

    assert code == 1
    assert "no databases" in capsys.readouterr().err


def test_a_live_table_that_disagrees_with_its_declared_schema_is_reported(
    tmp_path, monkeypatch, capsys
):
    # The cross-check earns its place here: a baseline should be faithful (it
    # matches what runs today) *and* intentional (it matches what the feed says
    # it writes). Where the two disagree the generator says so and leaves the
    # judgement to the person running it.
    from dataclasses import dataclass

    @dataclass(frozen=True)
    class Declared:
        case_id: str
        score: int

    monkeypatch.setattr(
        generator, "SCHEMAS", {"cases/silver/cases": Declared}, raising=False
    )
    monkeypatch.setattr(generator, "_load_schemas", lambda: None)
    base = tmp_path / "data"
    _database(
        base / "cases" / "silver.db",
        "CREATE TABLE cases (case_id TEXT, score TEXT, extra TEXT)",
    )

    generator.generate(
        "cases",
        base_dir=base,
        databases=[],
        out_root=tmp_path / "migrations",
        to_stdout=False,
    )

    errors = capsys.readouterr().err
    assert "'score' is TEXT live but INTEGER by declaration" in errors
    assert "live column 'extra' is not declared" in errors
    assert "declared column 'pipeline_run_id' is not in the live table" in errors


def test_without_a_run_to_read_the_declared_schemas_are_the_source(
    tmp_path, monkeypatch
):
    # The scaffold's path: a brand-new feed has no database to introspect, so its
    # baseline can only come from what it declares.
    from dataclasses import dataclass

    @dataclass(frozen=True)
    class Declared:
        case_id: str

    monkeypatch.setattr(
        generator, "SCHEMAS", {"cases/silver/cases": Declared}, raising=False
    )
    monkeypatch.setattr(generator, "_load_schemas", lambda: None)
    out = tmp_path / "migrations"

    code = generator.generate(
        "cases", base_dir=None, databases=["silver"], out_root=out, to_stdout=False
    )

    assert code == 0
    sql = (out / "cases" / "silver" / "0001_create_initial_tables.sql").read_text()
    assert '"case_id" TEXT' in sql
    assert '"pipeline_run_id" TEXT' in sql


def test_the_generated_baseline_matches_what_a_real_run_creates(tmp_path):
    # #689's "done when", end to end and with no fixtures of its own: run the
    # real sharepoint_cases pipeline against its bundled sample, generate from
    # the databases it wrote, apply those migrations to an empty base directory,
    # and compare every table column-for-column and type-for-type.
    pytest.importorskip("pandas")
    from framework.run.run_context import RunContext
    from pipelines.sharepoint_cases import pipeline as feed
    from pipelines.sharepoint_cases.pipeline import LocalJsonListClient

    run_dir = tmp_path / "run"
    feed.run(RunContext(base_dir=run_dir), client=LocalJsonListClient())

    out = tmp_path / "migrations"
    assert (
        generator.generate(
            "sharepoint_cases",
            base_dir=run_dir,
            databases=[],
            out_root=out,
            to_stdout=False,
        )
        == 0
    )

    migrated = tmp_path / "migrated"
    for target in discover_targets(out):
        db_path = migrated / target.subject / f"{target.database}.db"
        MigrationRunner(db_path, target.directory).apply()

        produced = run_dir / target.subject / f"{target.database}.db"
        con = sqlite3.connect(produced)
        tables = sorted(
            row[0]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
            if not generator._is_generated(row[0])
        )
        con.close()
        assert tables, f"{target.namespace} produced no tables"
        for table in tables:
            assert _columns(db_path, table) == _columns(produced, table), (
                f"{target.namespace}.{table}"
            )


def test_the_columns_dataclass_renders_what_it_was_given():
    assert Column("case_id", "TEXT").render() == '"case_id" TEXT'
