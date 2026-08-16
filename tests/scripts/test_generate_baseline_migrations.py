"""Generating a subject's baseline migrations from the databases themselves.

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


def _baseline(out, subject, database):
    return (out / subject / database / "0001_create_initial_tables.sql").read_text()


def test_every_database_a_subject_has_gets_a_baseline(tmp_path):
    base = tmp_path / "data"
    _database(base / "cases" / "silver.db", "CREATE TABLE cases (case_id TEXT)")
    _database(base / "cases" / "gold.db", "CREATE TABLE counts (n INTEGER)")
    # Quarantine is a database of the subject like any other, so it earns its own
    # migrations directory rather than being smuggled into silver's.
    _database(base / "cases" / "quarantine.db", "CREATE TABLE rejects (why TEXT)")
    out = tmp_path / "migrations"

    code = generator.generate("cases", base_dir=base, out_root=out, to_stdout=False)
    assert code == 0

    assert [t.namespace for t in discover_targets(out)] == [
        "cases/gold",
        "cases/quarantine",
        "cases/silver",
    ]


def test_the_baseline_is_the_databases_own_create_statement(tmp_path):
    # The point of #689 after review: the statement is copied, not rebuilt. What
    # lands in the file is what `sqlite3 <db> .schema` would print, down to the
    # spacing, so nothing about the shape passes through a model of it.
    base = tmp_path / "data"
    declared = 'CREATE TABLE "cases" (\n  "case_id" TEXT NOT NULL,\n  score REAL\n)'
    _database(base / "cases" / "silver.db", declared)
    out = tmp_path / "migrations"

    generator.generate("cases", base_dir=base, out_root=out, to_stdout=False)

    assert declared + ";" in _baseline(out, "cases", "silver")


def test_the_generated_sql_recreates_the_tables_it_was_read_from(tmp_path):
    base = tmp_path / "data"
    _database(
        base / "cases" / "silver.db",
        "CREATE TABLE cases (case_id TEXT, opened TIMESTAMP, score REAL)",
        "CREATE TABLE notes (case_id TEXT, note TEXT)",
    )
    out = tmp_path / "migrations"
    generator.generate("cases", base_dir=base, out_root=out, to_stdout=False)

    rebuilt = tmp_path / "rebuilt.db"
    MigrationRunner(rebuilt, out / "cases" / "silver").apply()

    assert _columns(rebuilt, "cases") == _columns(base / "cases" / "silver.db", "cases")
    assert _columns(rebuilt, "notes") == [("case_id", "TEXT"), ("note", "TEXT")]


def test_constraints_and_indexes_survive_because_the_statement_is_copied(tmp_path):
    # What deriving DDL from a dataclass could never carry: a primary key, a NOT
    # NULL, an index. Copying the statement means they cost nothing to keep.
    base = tmp_path / "data"
    _database(
        base / "cases" / "silver.db",
        "CREATE TABLE cases (case_id TEXT PRIMARY KEY, opened TIMESTAMP NOT NULL)",
        "CREATE INDEX cases_opened ON cases (opened)",
    )
    out = tmp_path / "migrations"
    generator.generate("cases", base_dir=base, out_root=out, to_stdout=False)

    rebuilt = tmp_path / "rebuilt.db"
    MigrationRunner(rebuilt, out / "cases" / "silver").apply()

    con = sqlite3.connect(rebuilt)
    try:
        info = list(con.execute("PRAGMA table_info(cases)"))
        indexes = [row[1] for row in con.execute("PRAGMA index_list(cases)")]
    finally:
        con.close()

    assert [(row[1], row[3], row[5]) for row in info] == [
        ("case_id", 0, 1),  # notnull, pk
        ("opened", 1, 0),
    ]
    assert "cases_opened" in indexes


def test_regenerating_an_unchanged_database_is_byte_identical(tmp_path):
    # So a checked-in baseline can be diffed against the database it claims to
    # describe, and the diff means something.
    base = tmp_path / "data"
    _database(
        base / "cases" / "silver.db",
        "CREATE TABLE cases (case_id TEXT)",
        "CREATE TABLE notes (note TEXT)",
    )
    first = tmp_path / "first"
    second = tmp_path / "second"
    generator.generate("cases", base_dir=base, out_root=first, to_stdout=False)
    generator.generate("cases", base_dir=base, out_root=second, to_stdout=False)

    assert _baseline(first, "cases", "silver") == _baseline(second, "cases", "silver")


def test_a_checked_in_baseline_is_never_overwritten(tmp_path, capsys):
    # Baselines are generated once and maintained by hand: the runner's checksum
    # refuses an edited file, so silently rewriting one would strand every
    # database that had already applied it.
    base = tmp_path / "data"
    _database(base / "cases" / "silver.db", "CREATE TABLE cases (case_id TEXT)")
    out = tmp_path / "migrations"
    generator.generate("cases", base_dir=base, out_root=out, to_stdout=False)
    existing = _baseline(out, "cases", "silver")

    code = generator.generate("cases", base_dir=base, out_root=out, to_stdout=False)

    assert code == 1
    assert "refusing to overwrite" in capsys.readouterr().err
    assert _baseline(out, "cases", "silver") == existing


def test_stdout_mode_writes_nothing(tmp_path, capsys):
    base = tmp_path / "data"
    _database(base / "cases" / "silver.db", "CREATE TABLE cases (case_id TEXT)")
    out = tmp_path / "migrations"

    generator.generate("cases", base_dir=base, out_root=out, to_stdout=True)

    assert "CREATE TABLE" in capsys.readouterr().out
    assert not out.exists()


def test_a_subject_with_no_databases_is_reported_rather_than_silently_empty(
    tmp_path, capsys
):
    code = generator.generate(
        "absent",
        base_dir=tmp_path / "data",
        out_root=tmp_path / "migrations",
        to_stdout=False,
    )

    assert code == 1
    assert "no databases" in capsys.readouterr().err


def test_an_empty_database_is_noted_and_gets_no_directory(tmp_path, capsys):
    # A database file a run touched but never wrote a table into has nothing to
    # declare. Creating an empty migrations directory for it would put it under
    # migration control, which is exactly the state that makes a Writer refuse.
    base = tmp_path / "data"
    _database(base / "cases" / "silver.db", "CREATE TABLE cases (case_id TEXT)")
    _database(base / "cases" / "gold.db")
    out = tmp_path / "migrations"

    code = generator.generate("cases", base_dir=base, out_root=out, to_stdout=False)
    assert code == 0

    assert "gold.db holds no tables" in capsys.readouterr().err
    assert not (out / "cases" / "gold").exists()


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
            "sharepoint_cases", base_dir=run_dir, out_root=out, to_stdout=False
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
            if row[0] != "schema_migrations"
        )
        con.close()
        assert tables, f"{target.namespace} produced no tables"
        for table in tables:
            assert _columns(db_path, table) == _columns(produced, table), (
                f"{target.namespace}.{table}"
            )
