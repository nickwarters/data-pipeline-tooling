```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _run(*args):
    return subprocess.run(
        [sys.executable, "-m", "cli", "run", *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )


def _record_run(log_path: Path, *, timestamp: str) -> None:
    record = {
        "timestamp": timestamp,
        "run_id": "old-ingest",
        "pipeline": "ingest",
        "step": "run",
        "status": "ok",
        "rows_in": None,
        "rows_out": None,
        "rows_quarantined": None,
        "rows_excluded": None,
        "duration": 0,
        "errors": [],
        "warn_hits": [],
    }
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(record) + "\n", encoding="utf-8")


def test_pipeline_run_cli_ingest_succeeds(tmp_path):
    result = _run("pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29")

    assert result.returncode == 0
    assert (tmp_path / "cases" / "raw.db").exists()
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_pipeline_run_cli_selection_succeeds_after_ingest_history(tmp_path):
    ingest = _run("pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29")
    assert ingest.returncode == 0

    selection = _run("pipelines/selection", str(tmp_path), "--run-date", "2026-05-29")

    assert selection.returncode == 0
    assert "SelectionPool" in selection.stdout


def test_pipeline_run_cli_selection_fails_when_ingest_history_is_stale(tmp_path):
    # Seed an old successful ingest run; the shared registry catches up from
    # every _runs/*.log, so selection sees the stale upstream and aborts.
    _record_run(
        tmp_path / "_runs" / "ingest.log",
        timestamp="2026-05-27T00:00:00+00:00",
    )

    result = _run("pipelines/selection", str(tmp_path), "--run-date", "2026-05-29")

    assert result.returncode != 0
    assert "upstream ingest is stale" in result.stderr


def test_unknown_pipeline_path_reports_clear_error(tmp_path):
    result = _run("pipelines/nope", str(tmp_path))

    assert result.returncode != 0
    assert "no pipeline at 'pipelines/nope'" in result.stderr
    assert "Traceback" not in result.stderr

```
