"""``python -m cli migrations make`` / ``python -m cli migrate`` (CLI plumbing).

Runs against the real ``migrations/`` tree (there is only one, repo-wide) and a
throwaway ``--base-dir``/``--database``, exactly as an operator would.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "cli", *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )


def test_migrate_plan_against_a_fresh_base_dir_shows_everything_pending(tmp_path):
    result = _cli("migrate", "--base-dir", str(tmp_path), "--plan")

    assert result.returncode == 0, result.stderr
    assert "plan · base-dir" in result.stdout
    assert "profile medallion" in result.stdout
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


def test_migrate_phase_filter_selects_the_layers_that_phase_owns(tmp_path):
    # A subject's silver.db carries no phase/ scope of its own, but silver is an
    # Ingest layer -- `--phase ingest` has to select it, or the filter only ever
    # works under by_phase.
    ingest = _cli("migrate", "--base-dir", str(tmp_path), "--phase", "ingest", "--plan")
    assert ingest.returncode == 0, ingest.stderr
    assert "complaints_a/silver.db" in ingest.stdout
    assert "gold.db" not in ingest.stdout  # gold is Selection, not Ingest

    sync = _cli("migrate", "--base-dir", str(tmp_path), "--phase", "sync", "--plan")
    assert sync.returncode == 0, sync.stderr
    assert "0 database(s)" in sync.stdout  # nothing here belongs to Sync yet


def test_migrate_env_resolves_profile_from_environments(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_DATA_DIR_DEV", str(tmp_path))
    result = _cli("migrate", "--env", "dev", "--plan")

    assert result.returncode == 0, result.stderr
    assert "profile medallion" in result.stdout


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


def test_migrate_reports_a_topology_collision_without_a_traceback(tmp_path):
    # The real declarations collide under `single` (see
    # tests/integration/test_topology_profiles.py and docs/migrations.md); an
    # operator must get an explanation and a non-zero exit, not a traceback.
    result = _cli("migrate", "--base-dir", str(tmp_path), "--profile", "single")

    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "already exists" in result.stderr
    assert "profile single" in result.stderr


def test_migrate_by_layer_profile_plans_the_four_generic_layer_databases(tmp_path):
    result = _cli(
        "migrate", "--base-dir", str(tmp_path), "--profile", "by_layer", "--plan"
    )

    assert result.returncode == 0, result.stderr
    for name in ("raw.db", "silver.db", "gold.db"):
        assert name in result.stdout


def test_migrations_make_reports_nothing_to_do_when_tree_is_current():
    result = _cli("migrations", "make")

    assert result.returncode == 0, result.stderr
    assert "nothing to do" in result.stdout


def test_migrations_make_unknown_feed_errors():
    result = _cli("migrations", "make", "--feed", "does-not-exist")

    assert result.returncode == 1
    assert "unknown feed" in result.stderr
