```python
"""Operator CLI (`python -m cli`).

Drives the CLI as a subprocess so the tests exercise the same entry point an
operator does: argument parsing, dispatch, exit codes, and console output. Every
behaviour runs on the bundled CSV feed + local SQLite only, with no external
services.
"""

import json
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


def test_run_executes_a_pipeline_by_its_path(tmp_path):
    result = _cli("run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29")

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "cases" / "raw.db").exists()
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_run_redrives_a_business_run_under_a_logical_run_id(tmp_path):
    from framework.core import GOLD
    from framework.io import StoreCatalog

    assert (
        _cli(
            "run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    def selection():
        return _cli(
            "run",
            "pipelines/selection",
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
    result = _cli("run", "pipelines/nope", str(tmp_path))

    assert result.returncode != 0
    assert "no pipeline at 'pipelines/nope'" in result.stderr
    assert "Traceback" not in result.stderr


def test_runs_lists_recent_runs_from_the_registry(tmp_path):
    assert (
        _cli(
            "run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("runs", str(tmp_path))

    assert result.returncode == 0, result.stderr
    assert "ingest" in result.stdout
    assert "ok" in result.stdout


def test_status_shows_latest_run_per_pipeline(tmp_path):
    assert (
        _cli(
            "run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("status", str(tmp_path), "--pipeline", "ingest")

    assert result.returncode == 0, result.stderr
    assert "ingest" in result.stdout
    assert "ok" in result.stdout


def test_log_summarizes_a_run_log_file(tmp_path):
    assert (
        _cli(
            "run", "pipelines/ingest", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("log", str(tmp_path), "ingest")

    assert result.returncode == 0, result.stderr
    assert "ingest" in result.stdout
    assert "ok" in result.stdout
    assert "step records" in result.stdout


def test_format_record_includes_zero_row_metrics():
    from cli.operator import _format_record

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
    # Selection declares ingest as a freshness upstream; with only stale ingest
    # history the run must abort with a clear stale-upstream message, not a crash.
    # The shared registry catches up from every _runs/*.log, so a record in the
    # upstream's own log is enough to drive the freshness verdict.
    log = tmp_path / "_runs" / "ingest.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(
        json.dumps(
            {
                "timestamp": "2026-05-20T00:00:00+00:00",
                "run_id": "old",
                "pipeline": "ingest",
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
        "run", "pipelines/selection", str(tmp_path), "--run-date", "2026-05-29"
    )

    assert result.returncode != 0
    assert "upstream ingest is stale" in result.stderr
    assert "Traceback" not in result.stderr


def test_run_validation_failure_reports_clear_error(tmp_path, monkeypatch, capsys):
    # A pipeline whose run(context) fails a data check raises ValidationError; the
    # operator should present the message and a non-zero exit, not a traceback.
    from types import SimpleNamespace

    from cli import operator
    from framework.core import ValidationError

    def boom(_context):
        raise ValidationError("row count 0 below required minimum 1")

    # Stand in for the imported pipelines/<name>/pipeline.py module.
    monkeypatch.setattr(
        operator,
        "_load_pipeline_module",
        lambda pipeline: SimpleNamespace(run=boom, UPSTREAMS=()),
    )

    code = operator.main(["run", "pipelines/boom", str(tmp_path)])

    assert code == 1
    assert "below required minimum" in capsys.readouterr().err

```
