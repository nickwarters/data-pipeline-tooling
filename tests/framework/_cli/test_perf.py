"""``python -m cli perf``: the at-a-glance duration view."""

from __future__ import annotations

import datetime as dt

import pandas as pd

import cli
from cli.perf import _clock, _seconds, batch_line, perf_table
from pipelines.pipeline_run_metric.pipeline import main as build_metrics
from tests.framework_testing import build_databases
from tools.observability.run_log import RunLog


def _row(pipeline, date, **values):
    row = {
        "as_of_date": date,
        "level": "pipeline",
        "pipeline": pipeline,
        "step_address": pipeline,
        "window_days": 28,
        "execution_count": 20,
        "ok_count": 20,
        "duration_p50": 60.0,
        "duration_p90": 90.0,
        "duration_p95": 100.0,
        "duration_max": 120.0,
        "failure_rate": 0.0,
        "retry_rate": None,
        "external_wait_p50": None,
        "p50_change_ratio_28d": None,
        "p90_change_ratio_28d": None,
    }
    return {**row, **values}


def test_durations_read_at_a_glance():
    assert [_seconds(v) for v in (0.25, 42, 552, 3725, None)] == [
        "250ms",
        "42.0s",
        "9m12s",
        "1h02m",
        "-",
    ]
    assert _clock(6.5 * 3600) == "06:30"
    assert _clock(86400 + 3600) == "01:00 +1d"


def test_the_slowest_p95_comes_first_and_a_slower_p90_is_flagged():
    frame = pd.DataFrame(
        [
            _row("quick", "2026-10-08", duration_p95=10.0),
            _row("slow", "2026-10-08", duration_p95=900.0, p90_change_ratio_28d=0.5),
            # Too few samples for a p95: ranked by its p90 instead.
            _row("sparse", "2026-10-08", duration_p95=None, duration_p90=300.0),
            _row("slow", "2026-10-01", duration_p95=1.0),  # superseded
        ]
    )
    lines = perf_table(frame, window=28, steps=False)

    names = [line.split()[0] for line in lines[2:]]
    assert names == ["slow", "sparse", "quick"]
    assert lines[2].endswith("SLOWER")
    assert not lines[4].endswith("SLOWER")


def test_a_pipeline_that_has_not_run_lately_says_when_it_last_did():
    frame = pd.DataFrame([_row("daily", "2026-10-08"), _row("retired", "2026-09-01")])
    lines = perf_table(frame, window=28, steps=False)

    assert lines[-1].endswith("last ran 2026-09-01")
    assert "last ran" not in lines[-2]


def test_as_of_shows_the_figures_as_they_stood_then():
    frame = pd.DataFrame(
        [
            _row("p", "2026-10-01", duration_p95=10.0),
            _row("p", "2026-10-08", duration_p95=99.0),
        ]
    )
    [_, _, line] = perf_table(frame, window=28, steps=False, as_of=dt.date(2026, 10, 5))
    assert "10.0s" in line and "1m39s" not in line


def test_the_batch_line_names_when_the_latest_batch_finished():
    batches = pd.DataFrame(
        [
            {
                "run_date": "2026-10-08",
                "finished_after_midnight_seconds": 6.5 * 3600,
                "finish_p50_28d": 6 * 3600,
                "finish_p90_28d": None,
                "items_run": 12,
                "items_failed": 1,
                "items_blocked": 2,
                "queue_wait_max_seconds": 4320,
            }
        ]
    )
    assert batch_line(batches, None) == (
        "Batch 2026-10-08 finished 06:30 (28-day p50 06:00, p90 -); "
        "12 run, 1 failed, 2 blocked; longest queue 1h12m"
    )


def test_perf_reads_what_the_metric_pipeline_published(tmp_path, capsys):
    base_dir = build_databases(tmp_path, "pipeline_run_metric/gold")
    log = RunLog(base_dir / "_runs" / "ingest.log")
    log.record("r1", "ingest", "read", "ok", duration=2.0, rows_out=5)
    log.record("r1", "ingest", "run", "ok", duration=2.5)
    assert build_metrics(["prog", "--base-dir", str(base_dir)]) == 0
    capsys.readouterr()

    assert cli.main(["perf", "--base-dir", str(base_dir)]) == 0

    out = capsys.readouterr().out
    assert "ingest" in out and "2.5s" in out


def test_perf_before_the_metric_pipeline_has_run_says_what_to_do(tmp_path, capsys):
    assert cli.main(["perf", "--base-dir", str(tmp_path)]) == 1

    assert "pipelines/pipeline_run_metric" in capsys.readouterr().err
