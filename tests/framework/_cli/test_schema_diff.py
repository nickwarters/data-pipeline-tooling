"""``python -m cli schema diff`` (CLI plumbing: args, exit codes, output).

Unlike ``test_operator.py``, this can't run against throwaway fixture
pipelines: ``collect_declared_tables()`` walks the real ``pipelines/`` package
by design (the whole point is diffing what the *real* feeds declare), so these
tests exercise the CLI against one real, small feed (``complaints_a``) rather
than the full bundled set -- the full-set, all-clean assertion belongs to
``tests/integration/test_declared_tables_match_pipelines.py``, which is also
the self-testing guard for the declaration/live comparison itself.
"""

from __future__ import annotations

import shutil
import sqlite3
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


def test_diff_against_an_empty_base_dir_is_pending_not_drifted(tmp_path):
    result = _cli("schema", "diff", "--base-dir", str(tmp_path))

    assert result.returncode == 0, result.stderr
    assert "0 drifted" in result.stdout
    assert "pending" in result.stdout
    assert "not yet landed" in result.stdout


def _land_complaints_a(base_dir: Path) -> None:
    """Run the real ``complaints_a`` feed under ``base_dir`` -- raw + silver."""
    landing = base_dir / "landing_zone"
    landing.mkdir(exist_ok=True)
    shutil.copy(
        ROOT / "pipelines" / "complaints_a" / "sample_data" / "complaints_a.csv",
        landing / "complaints_a.csv",
    )
    run = _cli("run", "pipelines/complaints_a", "--base-dir", str(base_dir))
    assert run.returncode == 0, run.stderr


def _alter_live_silver(base_dir: Path, statement: str) -> None:
    """Plant a shape change on the landed silver table, behind the pipeline's back."""
    con = sqlite3.connect(base_dir / "complaints_a" / "silver.db")
    try:
        con.execute(statement)
        con.commit()
    finally:
        con.close()


def test_diff_reports_clean_for_a_landed_feed_matching_its_declaration(tmp_path):
    _land_complaints_a(tmp_path)

    result = _cli("schema", "diff", "--base-dir", str(tmp_path))

    assert result.returncode == 0, result.stderr
    # This feed's two databases landed exactly as declared, so neither appears
    # in the report at all -- every *other* feed is still pending (nothing else
    # ran under this fresh base_dir), and pending is not drift.
    assert "complaints_a" not in result.stdout
    assert "0 drifted" in result.stdout


def test_diff_exits_non_zero_and_names_an_undeclared_live_column(tmp_path):
    _land_complaints_a(tmp_path)
    _alter_live_silver(
        tmp_path, "ALTER TABLE complaints_a ADD COLUMN adviser_code TEXT"
    )

    result = _cli("schema", "diff", "--base-dir", str(tmp_path))

    assert result.returncode == 1
    assert "complaints_a/silver.db  complaints_a" in result.stdout
    assert "+ adviser_code   live only (undeclared)" in result.stdout
    assert "1 drifted" in result.stdout


def test_diff_exits_non_zero_when_a_declared_column_is_missing_from_a_live_table(
    tmp_path,
):
    # The other direction, and the one a "pending" state must not swallow: the
    # table does exist, so a column it should have and doesn't is real drift.
    _land_complaints_a(tmp_path)
    _alter_live_silver(tmp_path, "ALTER TABLE complaints_a DROP COLUMN label")

    result = _cli("schema", "diff", "--base-dir", str(tmp_path))

    assert result.returncode == 1
    assert "- label   declared, missing" in result.stdout
    assert "1 drifted" in result.stdout


def test_diff_counts_a_namespace_two_feeds_share_only_once(tmp_path):
    # pipelines/ingest and pipelines/selection both declare tables in
    # "cases/gold"; a database is one database however many feeds land in it.
    result = _cli("schema", "diff", "--base-dir", str(tmp_path))

    assert result.returncode == 0, result.stderr
    assert result.stdout.count("cases/gold.db") == 1


def test_diff_reports_an_actionable_error_for_an_unresolvable_env(
    tmp_path, monkeypatch
):
    monkeypatch.delenv("PIPELINE_DATA_DIR_PROD", raising=False)
    result = _cli("schema", "diff", "--env", "prod")

    assert result.returncode == 1
    assert "PIPELINE_DATA_DIR_PROD" in result.stderr


def test_diff_rejects_an_unknown_environment_name():
    result = _cli("schema", "diff", "--env", "not-a-real-env")

    assert result.returncode == 1
    assert "unknown environment" in result.stderr
