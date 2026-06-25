"""End-to-end: the operator CLI driving the *real* application pipelines.

The bulk of the CLI's coverage (`tests/framework/_cli/`) runs against throwaway
fixture pipelines so it stays insulated from how `ingest`/`selection` behave.
This module is the deliberate cross-tree exception: a smoke check that
`python -m cli run pipelines/<name>` actually imports and runs the real
on-disk pipelines through their genuine raw -> silver -> gold path, including the
real `selection` -> `ingest` freshness relationship. It lives under
`tests/integration/` because spanning the framework/CLI and `pipelines/` trees is
expected here, not in the unit-level CLI tests.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "cli", *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )


def test_dry_run_previews_without_touching_any_artifact(tmp_path):
    # Land real data first so there is something to preview.
    first = _cli("run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29")
    assert first.returncode == 0, first.stderr
    raw_db = tmp_path / "cases" / "raw.db"
    registry = tmp_path / "_registry" / "runs.db"
    before = {p: p.stat().st_mtime_ns for p in (raw_db, registry)}

    result = _cli(
        "run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29", "--dry-run"
    )

    assert result.returncode == 0, result.stderr
    # Non-destructive: neither the store nor the run registry was touched.
    after = {p: p.stat().st_mtime_ns for p in (raw_db, registry)}
    assert after == before
    assert "dry run" in result.stdout.lower()
    assert "[Read]" in result.stdout
    assert "rows" in result.stdout


def test_cli_runs_real_ingest_then_selection_end_to_end(tmp_path):
    ingest = _cli("run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29")
    assert ingest.returncode == 0, ingest.stderr
    assert (tmp_path / "cases" / "raw.db").exists()
    assert (tmp_path / "_registry" / "runs.db").exists()

    selection = _cli(
        "run", "pipelines/selection", str(tmp_path), "--run-date", "2026-05-29"
    )

    assert selection.returncode == 0, selection.stderr
    assert "SelectionPool" in selection.stdout
