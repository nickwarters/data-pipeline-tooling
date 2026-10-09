"""What an orchestration pass records about when its items ran."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from framework.core import Dataset
from framework.run import Pipeline, RunContext
from tools.calendar import WorkingDayCalendar
from tools.observability.run_log import RunLog
from tools.observability.run_store import RunStore
from tools.orchestration import (
    OrchestrationStore,
    Orchestrator,
    PipelineSet,
    Schedule,
    ScheduledPipeline,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
RUN_DATE = dt.date(2026, 6, 12)  # a Friday


@pytest.fixture
def orchestrator(monkeypatch) -> Orchestrator:
    # The fixture pipelines resolve as clipipelines/<name>, run by the default
    # path invoker exactly as `cli orchestrate` runs them.
    monkeypatch.syspath_prepend(str(FIXTURES))
    return Orchestrator(
        (
            PipelineSet(
                "fixture",
                (
                    ScheduledPipeline("clipipelines/_source", Schedule.daily()),
                    ScheduledPipeline(
                        "clipipelines/_downstream", Schedule.manual_only()
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
    )


def test_the_run_summary_names_the_pass_that_started_it(orchestrator, tmp_path):
    result = orchestrator.run_due_once(tmp_path, run_date=RUN_DATE, now=dt.time(12, 0))

    [run] = RunStore(tmp_path).registry().query_runs(pipeline="_source")
    assert run["orchestration_run_id"] == result.orchestration_run_id


def test_a_pipeline_the_handler_runs_names_the_pass_on_its_own_summary(
    orchestrator, tmp_path
):
    # The fixture handler runs a nested Pipeline("fixture"), which writes its
    # own run summary beside the runner's; that one names the pass too.
    result = orchestrator.run_due_once(tmp_path, run_date=RUN_DATE, now=dt.time(12, 0))

    [run] = RunStore(tmp_path).registry().query_runs(pipeline="fixture")
    assert run["orchestration_run_id"] == result.orchestration_run_id


def test_a_failed_pipeline_run_names_the_pass_on_its_summary(tmp_path):
    class FailingReader:
        def read(self) -> Dataset:
            raise ConnectionError("source unavailable")

    log_path = tmp_path / "run.log"
    context = RunContext(
        base_dir=tmp_path,
        pipeline="feed",
        run_log=RunLog(log_path),
        orchestration_run_id="pass-1",
    )
    p = Pipeline("feed")
    p.read(FailingReader(), name="read")
    with pytest.raises(ConnectionError):
        p.run(context=context)

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    [summary] = [r for r in records if r["step"] == "run"]
    assert (summary["status"], summary["orchestration_run_id"]) == ("error", "pass-1")


def test_a_run_started_by_hand_names_no_pass(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(FIXTURES))
    from framework.run import load_pipeline, run_pipeline

    loaded = load_pipeline("clipipelines/_source")
    run_pipeline(loaded.run, loaded.name, tmp_path, run_date=RUN_DATE)

    [run] = RunStore(tmp_path).registry().query_runs(pipeline="_source")
    assert run["orchestration_run_id"] is None


def test_each_decision_records_when_its_pass_and_its_item_started(
    orchestrator, tmp_path
):
    result = orchestrator.run_due_once(tmp_path, run_date=RUN_DATE, now=dt.time(12, 0))

    stored = OrchestrationStore(RunStore(tmp_path).orchestration_path).records()
    by_pipeline = {row["pipeline"]: row for row in stored}
    ran, skipped = by_pipeline["_source"], by_pipeline["_downstream"]
    assert ran["status"] == "succeeded" and skipped["status"] == "skipped"
    # Both carry the pass's start; only the item that ran has a start of its
    # own, and it is not before the pass began.
    assert ran["pass_started_at"] == skipped["pass_started_at"] is not None
    assert ran["started_at"] >= ran["pass_started_at"]
    assert skipped["started_at"] is None
    assert {d.pass_started_at for d in result.decisions} == {ran["pass_started_at"]}
