"""Operator CLI (`python -m cli`).

Drives the CLI as a subprocess so the tests exercise the same entry point an
operator does: argument parsing, dispatch, exit codes, and console output. These
tests cover the CLI *plumbing* only, so they run against the throwaway fixture
pipelines under ``tests/fixtures/clipipelines/`` rather than the real application
pipelines -- nothing here should break when ``pipelines/ingest`` or
``pipelines/selection`` change. The real pipelines' own end-to-end CLI coverage
lives in ``tests/integration/test_operator_cli_e2e.py``. Everything runs on local
SQLite only, with no external services.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "tests" / "fixtures"


def _cli(*args):
    # Put the fixture pipelines on the import path so `run clipipelines/<name>`
    # resolves to tests/fixtures/clipipelines/<name>/pipeline.py.
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [str(FIXTURES), os.environ.get("PYTHONPATH", "")]
        ),
    }
    return subprocess.run(
        [sys.executable, "-m", "cli", *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )


def test_run_executes_a_pipeline_by_its_path(tmp_path):
    result = _cli(
        "run", "clipipelines/_source", str(tmp_path), "--run-date", "2026-05-29"
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "fixture" / "raw.db").exists()
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_run_passes_params_to_path_addressed_pipeline(tmp_path):
    result = _cli(
        "run",
        "clipipelines/_source",
        str(tmp_path),
        "--run-date",
        "2026-06-22",
        "--param",
        "source_file=/share/upstream/claims/claims_20260622_a.csv",
        "--param",
        "batch=claims-20260622-a",
    )

    assert result.returncode == 0, result.stderr
    assert "source_file=/share/upstream/claims/claims_20260622_a.csv" in result.stdout


def test_run_redrives_a_business_run_under_a_logical_run_id(tmp_path):
    from framework.core import GOLD
    from framework.io import StoreCatalog

    assert (
        _cli(
            "run", "clipipelines/_source", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    def downstream():
        return _cli(
            "run",
            "clipipelines/_downstream",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
            "--logical-run-id",
            "REDRIVE-7",
        )

    assert downstream().returncode == 0, downstream().stderr
    # Re-drive the same business run a second time.
    assert downstream().returncode == 0

    pool = (
        StoreCatalog(tmp_path).store("fixture").reader(GOLD, "pool").read().to_pandas()
    )
    # Replaced under the one logical run id, not accumulated into duplicates.
    assert set(pool["run_id"]) == {"REDRIVE-7"}
    assert set(pool["logical_run_id"]) == {"REDRIVE-7"}
    assert list(pool["case_ref"]) == ["c1", "c2"]


def test_run_downstream_succeeds_after_fresh_source_history(tmp_path):
    # With a current successful _source run on record, the freshness gate passes
    # and _downstream runs to completion.
    assert (
        _cli(
            "run", "clipipelines/_source", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    downstream = _cli(
        "run", "clipipelines/_downstream", str(tmp_path), "--run-date", "2026-05-29"
    )

    assert downstream.returncode == 0, downstream.stderr
    assert "FixturePool" in downstream.stdout


def test_run_unknown_pipeline_reports_clear_error(tmp_path):
    result = _cli("run", "clipipelines/nope", str(tmp_path))

    assert result.returncode != 0
    assert "no pipeline at 'clipipelines/nope'" in result.stderr
    assert "Traceback" not in result.stderr


def test_runs_lists_recent_runs_from_the_registry(tmp_path):
    assert (
        _cli(
            "run", "clipipelines/_source", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("runs", str(tmp_path))

    assert result.returncode == 0, result.stderr
    assert "_source" in result.stdout
    assert "ok" in result.stdout


def test_status_shows_latest_run_per_pipeline(tmp_path):
    assert (
        _cli(
            "run", "clipipelines/_source", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("status", str(tmp_path), "--pipeline", "_source")

    assert result.returncode == 0, result.stderr
    assert "_source" in result.stdout
    assert "ok" in result.stdout


def test_log_summarizes_a_run_log_file(tmp_path):
    assert (
        _cli(
            "run", "clipipelines/_source", str(tmp_path), "--run-date", "2026-05-29"
        ).returncode
        == 0
    )

    result = _cli("log", str(tmp_path), "_source")

    assert result.returncode == 0, result.stderr
    assert "_source" in result.stdout
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
    result = _cli("log", str(tmp_path), "_source")

    assert result.returncode != 0
    assert "no run log" in result.stderr
    assert "Traceback" not in result.stderr


def test_run_stale_upstream_reports_clear_error(tmp_path):
    # _downstream declares _source as a freshness upstream; with only stale
    # _source history the run must abort with a clear stale-upstream message, not
    # a crash. The shared registry catches up from every _runs/*.log, so a record
    # in the upstream's own log is enough to drive the freshness verdict.
    log = tmp_path / "_runs" / "_source.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(
        json.dumps(
            {
                "timestamp": "2026-05-20T00:00:00+00:00",
                "run_id": "old",
                "pipeline": "_source",
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
        "run", "clipipelines/_downstream", str(tmp_path), "--run-date", "2026-05-29"
    )

    assert result.returncode != 0
    assert "upstream _source is stale" in result.stderr
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
