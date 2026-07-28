"""``python -m cli migrations make`` / ``python -m cli migrate`` (CLI plumbing).

Runs against the real ``migrations/`` tree (there is only one, repo-wide) and a
throwaway ``--base-dir``/``--database``, exactly as an operator would.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _cli(*args, cwd=ROOT):
    # ``cwd`` matters: ``DEFAULT_MIGRATIONS_ROOT`` is relative, so running from
    # elsewhere is how a test points the command at a tree of its own. ``ROOT``
    # is on the path either way, so ``-m cli`` still resolves.
    return subprocess.run(
        [sys.executable, "-m", "cli", *args],
        capture_output=True,
        text=True,
        cwd=cwd,
        env={**os.environ, "PYTHONPATH": str(ROOT)},
    )


def test_migrate_plan_against_a_fresh_base_dir_shows_everything_pending(tmp_path):
    result = _cli("migrate", "--base-dir", str(tmp_path), "--plan")

    assert result.returncode == 0, result.stderr
    assert "plan · base-dir" in result.stdout
    assert "pending" in result.stdout


def test_migrate_status_against_a_fresh_base_dir(tmp_path):
    result = _cli("migrate", "--base-dir", str(tmp_path), "--status")

    assert result.returncode == 0, result.stderr
    assert "0 applied" in result.stdout


def test_migrate_apply_then_status_shows_nothing_pending(tmp_path):
    applied = _cli("migrate", "--base-dir", str(tmp_path))
    assert applied.returncode == 0, applied.stderr

    status = _cli("migrate", "--base-dir", str(tmp_path), "--status")
    assert status.returncode == 0, status.stderr
    assert "0 pending" in status.stdout
    assert (tmp_path / "complaints_a" / "silver.db").exists()


def test_migrate_is_idempotent(tmp_path):
    first = _cli("migrate", "--base-dir", str(tmp_path))
    second = _cli("migrate", "--base-dir", str(tmp_path))

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr


def test_migrate_subject_filter_narrows_to_one_subjects_databases(tmp_path):
    result = _cli(
        "migrate", "--base-dir", str(tmp_path), "--subject", "complaints_a", "--plan"
    )

    assert result.returncode == 0, result.stderr
    assert "complaints_a" in result.stdout
    assert "complaints_b" not in result.stdout


def test_migrate_env_resolves_base_dir_from_environments(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_DATA_DIR_DEV", str(tmp_path))
    result = _cli("migrate", "--env", "dev", "--plan")

    assert result.returncode == 0, result.stderr
    assert f"plan · base-dir {tmp_path}" in result.stdout


def test_migrate_explicit_database_and_scope(tmp_path):
    db_path = tmp_path / "scratch.db"
    result = _cli(
        "migrate",
        "--database",
        str(db_path),
        "--scope",
        "subject/complaints_a/silver",
        "--scope",
        "_shared",
    )

    assert result.returncode == 0, result.stderr
    assert db_path.exists()

    # --database resolves no base directory, so the report names none: the one
    # database's own full path is already on every line below the heading.
    plan = _cli("migrate", "--database", str(db_path), "--scope", "_shared", "--plan")
    assert plan.returncode == 0, plan.stderr
    assert plan.stdout.startswith("plan\n")
    assert "base-dir" not in plan.stdout


def test_migrate_explicit_database_rejects_an_unrecognised_scope(tmp_path):
    result = _cli(
        "migrate", "--database", str(tmp_path / "s.db"), "--scope", "layer/bronze"
    )

    assert result.returncode == 1
    assert "not a recognised layer" in result.stderr


def test_migrate_to_rejects_a_non_version(tmp_path):
    result = _cli("migrate", "--base-dir", str(tmp_path), "--to", "yesterday", "--plan")

    assert result.returncode == 1
    assert "--to takes a migration version" in result.stderr


def test_migrate_reports_a_failing_migration_without_a_traceback(tmp_path):
    # A migration SQLite refuses is an operator-facing failure, not a crash:
    # non-zero exit, the file named, no traceback -- and the failing file rolls
    # back whole, leaving the earlier file applied and no ledger row of its own.
    # Planted in a tree of its own, since the repo's committed tree is healthy.
    scope = tmp_path / "migrations" / "subject" / "widgets" / "raw"
    scope.mkdir(parents=True)
    (scope / "0001_create_widgets.sql").write_text(
        "CREATE TABLE widgets (id TEXT);\n", encoding="utf-8"
    )
    (scope / "0002_broken.sql").write_text(
        "CREATE TABLE gadgets (id TEXT);\nINSERT INTO absent VALUES (1);\n",
        encoding="utf-8",
    )

    result = _cli("migrate", "--base-dir", "base", cwd=tmp_path)

    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "0002_broken.sql" in result.stderr
    assert "no such table: absent" in result.stderr
    assert "rolled back" in result.stderr

    con = sqlite3.connect(tmp_path / "base" / "widgets" / "raw.db")
    try:
        tables = {
            row[0]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "widgets" in tables  # the first file's own transaction committed
        assert "gadgets" not in tables  # the failing file left nothing behind
        assert con.execute("SELECT version FROM schema_migrations").fetchall() == [
            ("0001",)
        ]
    finally:
        con.close()


def test_migrations_make_reports_nothing_to_do_when_tree_is_current():
    result = _cli("migrations", "make")

    assert result.returncode == 0, result.stderr
    assert "nothing to do" in result.stdout


def test_migrations_make_unknown_feed_errors():
    result = _cli("migrations", "make", "--feed", "does-not-exist")

    assert result.returncode == 1
    assert "unknown feed" in result.stderr
