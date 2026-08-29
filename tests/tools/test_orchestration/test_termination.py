"""Test that ``Decision.was_due``, not mutable reason prose, controls termination."""

import datetime as dt
from dataclasses import replace

from tools.calendar import WorkingDayCalendar
from tools.orchestration import (
    ManualOnly,
    OrchestrationDecision,
    OrchestrationPassResult,
    Orchestrator,
    PipelineSet,
    ScheduledPipeline,
    Weekdays,
)

RUN_DATE = dt.date(2026, 6, 12)  # a Friday


def _decision(status: str, *, was_due: bool, reason: str) -> OrchestrationDecision:
    return OrchestrationDecision(
        orchestration_run_id="orch-1",
        item_key=f"cases/{status}/{RUN_DATE.isoformat()}",
        set_name="cases",
        pipeline=status,
        run_date=RUN_DATE,
        status=status,
        reason=reason,
        was_due=was_due,
    )


def _empty_orchestrator() -> Orchestrator:
    return Orchestrator((), WorkingDayCalendar())


# Every decision shape one pass can produce, with the reason text each carries
# today. The first two are the ones that were recognised by their prose.
_PASS = (
    _decision("skipped", was_due=False, reason="disabled"),
    _decision("skipped", was_due=False, reason="schedule daily is not due on saturday"),
    _decision("succeeded", was_due=True, reason=""),
    _decision("failed", was_due=True, reason="feed_a failed"),
    _decision("blocked", was_due=True, reason="upstream feed_a is stale: ..."),
    _decision("skipped", was_due=True, reason="already failed in this run"),
)


def test_rewording_every_reason_leaves_termination_unchanged():
    orchestrator = _empty_orchestrator()
    original = OrchestrationPassResult("orch-1", _PASS)
    reworded = OrchestrationPassResult(
        "orch-1",
        tuple(
            replace(decision, reason=f"REWORDED({decision.reason})")
            for decision in _PASS
        ),
    )

    assert orchestrator._all_due_terminal(original) is True
    assert orchestrator._all_due_terminal(reworded) is (
        orchestrator._all_due_terminal(original)
    )


def test_a_pass_with_nothing_due_is_not_terminal():
    # Unchanged semantics: a pass where no item was due has not "settled" — the
    # loop keeps polling until it goes idle, exactly as it did before.
    orchestrator = _empty_orchestrator()
    result = OrchestrationPassResult("orch-1", _PASS[:2])

    assert orchestrator._all_due_terminal(result) is False


def test_rewording_a_skip_reason_does_not_make_a_dead_pass_look_settled():
    # Skip reason wording must not move skipped items into the due set and make
    # the loop exit early.
    orchestrator = _empty_orchestrator()
    reworded = OrchestrationPassResult(
        "orch-1",
        (
            _decision("skipped", was_due=False, reason="disabled by the overrides"),
            _decision("skipped", was_due=False, reason="not due today"),
        ),
    )

    assert orchestrator._all_due_terminal(reworded) is False


def test_a_due_item_still_running_keeps_the_loop_going():
    orchestrator = _empty_orchestrator()
    result = OrchestrationPassResult(
        "orch-1",
        (*_PASS[:2], _decision("running", was_due=True, reason="in flight")),
    )

    assert orchestrator._all_due_terminal(result) is False


class _NoopInvoker:
    def run(
        self, path, base_dir, *, run_date, logical_run_id, freshness_days, freshness
    ):
        return None


def test_a_loop_of_only_not_due_items_still_polls_until_idle(tmp_path):
    # A set where nothing is due never reaches "all due work settled", so the
    # loop runs out its idle budget instead. Pinned because it is the case the
    # reason-string filter got wrong in both directions.
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("pipelines/ingest", ManualOnly()),
                    ScheduledPipeline("pipelines/selection", Weekdays(), enabled=False),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_NoopInvoker(),
    )

    results = orchestrator.run_until_complete(
        tmp_path, run_date=RUN_DATE, poll_seconds=0, max_idle_polls=2
    )

    assert len(results) == 2
    assert all(not d.was_due for result in results for d in result.decisions)


def test_a_loop_stops_as_soon_as_every_due_item_has_settled(tmp_path):
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("pipelines/ingest", Weekdays()),
                    ScheduledPipeline("pipelines/manual", ManualOnly()),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_NoopInvoker(),
    )

    results = orchestrator.run_until_complete(
        tmp_path, run_date=RUN_DATE, poll_seconds=0, max_idle_polls=3
    )

    assert len(results) == 1
    statuses = {d.pipeline: (d.status, d.was_due) for d in results[0].decisions}
    assert statuses == {"ingest": ("succeeded", True), "manual": ("skipped", False)}


def test_a_pass_whose_only_due_item_is_gated_still_settles(tmp_path, monkeypatch):
    # earliest_run is an eligibility gate, never a sleep: the gated item records
    # a terminal skipped, so the day's work settles and the loop stops rather
    # than polling until the window opens. The clock is substituted rather than
    # frozen by an argument, because each pass must re-read it.
    import tools.orchestration as orchestration

    monkeypatch.setattr(
        orchestration,
        "local_now",
        lambda: dt.datetime.combine(RUN_DATE, dt.time(9, 0)),
    )
    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline(
                        "pipelines/nightly", Weekdays(), earliest_run="23:00"
                    ),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_NoopInvoker(),
    )

    results = orchestrator.run_until_complete(
        tmp_path, run_date=RUN_DATE, poll_seconds=0, max_idle_polls=3
    )

    assert len(results) == 1
    decision = results[0].decisions[0]
    assert (decision.status, decision.was_due) == ("skipped", True)


def test_the_decision_store_records_whether_an_item_was_due(tmp_path):
    from tools.orchestration import OrchestrationStore

    orchestrator = Orchestrator(
        (
            PipelineSet(
                "cases",
                (
                    ScheduledPipeline("pipelines/ingest", Weekdays()),
                    ScheduledPipeline("pipelines/manual", ManualOnly()),
                ),
            ),
        ),
        WorkingDayCalendar(),
        invoker=_NoopInvoker(),
    )

    orchestrator.run_due_once(tmp_path, run_date=RUN_DATE)

    records = OrchestrationStore(tmp_path / "_orchestration" / "runs.db").records()
    assert [(r["pipeline"], r["was_due"]) for r in records] == [
        ("ingest", 1),
        ("manual", 0),
    ]
