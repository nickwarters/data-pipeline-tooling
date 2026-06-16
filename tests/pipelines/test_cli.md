```python
"""Operator CLI (`python -m pipelines.cli`).

Drives the CLI as a subprocess so the tests exercise the same entry point an
operator does: argument parsing, dispatch, exit codes, and console output. Every
behaviour runs on the bundled CSV feed + local SQLite only, with no external
services.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def _cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "pipelines.cli", *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )


def test_run_executes_a_registered_pipeline(tmp_path):
    result = _cli("run", "cases", "ingest", str(tmp_path), "--run-date", "2026-05-29")

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "cases" / "raw.db").exists()
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_run_redrives_a_business_run_under_a_logical_run_id(tmp_path):
    from framework.core import GOLD
    from framework.io import StoreCatalog

    assert (
        _cli(
            "run", "cases", "ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    def selection():
        return _cli(
            "run",
            "cases",
            "selection",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
            "--logical-run-id",
            "REDRIVE-7",
        )

    assert selection().returncode == 0, selection().stderr
    # Re-drive the same business run a second time.
    assert selection().returncode == 0

    pool = (
        StoreCatalog(tmp_path)
        .store("cases")
        .reader(GOLD, "selection_pool")
        .read()
        .to_pandas()
    )
    # Replaced under the one logical run id, not accumulated into duplicates.
    assert set(pool["run_id"]) == {"REDRIVE-7"}
    assert set(pool["logical_run_id"]) == {"REDRIVE-7"}
    assert list(pool["case_ref"]) == ["c1", "c2"]


def test_run_unknown_pipeline_reports_clear_error(tmp_path):
    result = _cli("run", "cases", "nope", str(tmp_path))

    assert result.returncode != 0
    assert "unknown pipeline 'nope'" in result.stderr
    assert "Traceback" not in result.stderr


def test_runs_lists_recent_runs_from_the_registry(tmp_path):
    assert (
        _cli(
            "run", "cases", "ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("runs", str(tmp_path))

    assert result.returncode == 0, result.stderr
    assert "cases/ingest" in result.stdout
    assert "ok" in result.stdout


def test_status_shows_latest_run_for_a_case_type(tmp_path):
    assert (
        _cli(
            "run", "cases", "ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("status", str(tmp_path), "--case-type", "cases")

    assert result.returncode == 0, result.stderr
    assert "cases/ingest" in result.stdout
    assert "ok" in result.stdout


def test_log_summarizes_a_run_log_file(tmp_path):
    assert (
        _cli(
            "run", "cases", "ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("log", str(tmp_path), "cases")

    assert result.returncode == 0, result.stderr
    assert "cases/ingest" in result.stdout
    assert "ok" in result.stdout
    assert "step records" in result.stdout


def test_orchestrate_once_runs_demo_set_and_writes_both_registries(tmp_path):
    result = _cli(
        "orchestrate",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
        "--once",
    )

    assert result.returncode == 0, result.stderr
    assert "cases/ingest  succeeded" in result.stdout
    assert "cases/selection  succeeded" in result.stdout
    assert (tmp_path / "_orchestration" / "runs.db").exists()
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_format_record_includes_zero_row_metrics():
    from pipelines.cli import _format_record

    line = _format_record(
        {
            "step": "write",
            "status": "ok",
            "rows_in": None,
            "rows_out": 0,
            "rows_quarantined": 0,
            "rows_excluded": 0,
            "duration": None,
            "errors": [],
            "warn_hits": [],
        }
    )

    assert "rows_in=" not in line
    assert "rows_out=0" in line
    assert "rows_quarantined=0" in line
    assert "rows_excluded=0" in line


def test_status_without_a_registry_reports_clear_error(tmp_path):
    result = _cli("status", str(tmp_path))

    assert result.returncode != 0
    assert "no run registry" in result.stderr
    assert "Traceback" not in result.stderr


def test_log_without_a_log_file_reports_clear_error(tmp_path):
    result = _cli("log", str(tmp_path), "cases")

    assert result.returncode != 0
    assert "no run log" in result.stderr
    assert "Traceback" not in result.stderr


def test_run_stale_upstream_reports_clear_error(tmp_path):
    # Selection declares Ingest as a freshness upstream; with no recent Ingest
    # history the run must abort with a clear stale-upstream message, not a crash.
    log = tmp_path / "_runs" / "cases.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(
        json.dumps(
            {
                "timestamp": "2026-05-20T00:00:00+00:00",
                "run_id": "old",
                "pipeline": "cases/ingest",
                "step": "run",
                "status": "ok",
                "errors": [],
                "warn_hits": [],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    result = _cli(
        "run", "cases", "selection", str(tmp_path), "--run-date", "2026-05-29"
    )

    assert result.returncode != 0
    assert "upstream cases/ingest is stale" in result.stderr
    assert "Traceback" not in result.stderr


def test_run_validation_failure_reports_clear_error(tmp_path, monkeypatch, capsys):
    # A pipeline that fails a data check raises ValidationError; the operator
    # should see the message and a non-zero exit, not an unhandled traceback.
    from framework.run import PipelineRunner
    from framework.validate import ValidationError
    from pipelines import cli

    def boom(_context):
        raise ValidationError("row count 0 below required minimum 1")

    runner = PipelineRunner()
    runner.register("cases", "ingest", boom)
    monkeypatch.setattr(cli, "build_runner", lambda: runner)

    code = cli.main(["run", "cases", "ingest", str(tmp_path)])

    assert code == 1
    assert "below required minimum" in capsys.readouterr().err

```
