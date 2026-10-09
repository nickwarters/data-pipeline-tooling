"""What a step spent waiting on retries, as recorded."""

from __future__ import annotations

import json

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.run import read, run_pipeline, step
from framework.run.builder import Pipeline
from tools.observability.run_log import RunLog
from tools.observability.waits import measure_waits, note_retry
from tools.retry import RetryingReader, RetryPolicy

WAIT_FIELDS = ("retry_attempts", "retry_wait_seconds")


class Clock:
    """A clock a test moves by hand."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _records(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def _waits(record: dict) -> tuple:
    return tuple(record[name] for name in WAIT_FIELDS)


def _frame() -> Dataset:
    return Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))


# --- the tally ----------------------------------------------------------------


def test_a_retry_counts_its_time_towards_the_open_tally():
    with measure_waits() as waits:
        note_retry(4.5)
    assert (waits.retry_attempts, waits.retry_wait_seconds) == (1, 4.5)


def test_a_closed_inner_tally_adds_to_the_one_around_it():
    with measure_waits() as outer:
        with measure_waits() as inner:
            note_retry(1.5)
        note_retry(1.0)
    assert inner.fields() == {"retry_attempts": 1, "retry_wait_seconds": 1.5}
    assert outer.fields() == {"retry_attempts": 2, "retry_wait_seconds": 2.5}


def test_waits_outside_any_tally_are_dropped_without_error():
    note_retry(1.0)


# --- the retry policy -----------------------------------------------------------


class _SlowFlakyReader:
    """Fails ``fails`` times, each failure taking ``takes`` seconds of ``clock``."""

    def __init__(self, clock: Clock, fails: int, takes: float) -> None:
        self._clock = clock
        self._fails = fails
        self._takes = takes
        self.calls = 0

    def read(self) -> Dataset:
        self.calls += 1
        self._clock.now += self._takes
        if self.calls <= self._fails:
            raise ConnectionError("source briefly unavailable")
        return _frame()


def _policy(clock: Clock, attempts: int = 5, backoff: float = 10.0) -> RetryPolicy:
    def sleep(seconds: float) -> None:
        clock.now += seconds

    return RetryPolicy(
        attempts=attempts,
        retry_on=(ConnectionError,),
        backoff_seconds=backoff,
        sleep=sleep,
        clock=clock,
    )


def test_a_retry_costs_its_failed_attempt_and_the_backoff_after_it():
    clock = Clock()
    reader = RetryingReader(_SlowFlakyReader(clock, fails=2, takes=5), _policy(clock))
    with measure_waits() as waits:
        reader.read()
    # Two failed attempts of 5 s, each followed by 10 s of backoff. The attempt
    # that succeeded is work, not waiting.
    assert (waits.retry_attempts, waits.retry_wait_seconds) == (2, 30)


def test_the_attempt_that_exhausts_the_policy_is_not_a_retry():
    clock = Clock()
    reader = RetryingReader(
        _SlowFlakyReader(clock, fails=99, takes=5), _policy(clock, attempts=3)
    )
    with measure_waits() as waits:
        with pytest.raises(ConnectionError):
            reader.read()
    assert (waits.retry_attempts, waits.retry_wait_seconds) == (2, 30)


# --- what lands in the run log ----------------------------------------------------


def test_the_builder_records_a_steps_waits_and_totals_them_on_the_run(tmp_path):
    clock = Clock()
    log_path = tmp_path / "run.log"
    reader = RetryingReader(_SlowFlakyReader(clock, fails=1, takes=5), _policy(clock))

    def enrich(dataset: Dataset) -> Dataset:
        note_retry(7)
        return dataset

    p = Pipeline("feed", run_log=RunLog(log_path))
    p.transform(enrich, p.read(reader, name="read"), name="enrich")
    p.run()

    by_step = {r["step"]: r for r in _records(log_path)}
    assert _waits(by_step["read"]) == (1, 15)
    assert _waits(by_step["enrich"]) == (1, 7)
    assert _waits(by_step["run"]) == (2, 22)


def test_the_builder_records_the_waits_of_a_step_that_failed(tmp_path):
    clock = Clock()
    log_path = tmp_path / "run.log"
    reader = RetryingReader(
        _SlowFlakyReader(clock, fails=99, takes=5), _policy(clock, attempts=3)
    )

    p = Pipeline("feed", run_log=RunLog(log_path))
    p.read(reader, name="read")
    with pytest.raises(ConnectionError):
        p.run()

    by_step = {r["step"]: r for r in _records(log_path)}
    assert _waits(by_step["read"]) == (2, 30)
    assert _waits(by_step["run"]) == (2, 30)


def test_eager_steps_record_their_waits(tmp_path):
    log_path = tmp_path / "run.log"
    clock = Clock()
    reader = RetryingReader(_SlowFlakyReader(clock, fails=1, takes=12), _policy(clock))

    def handler(context):
        data = read(reader)
        with step("call-service"):
            note_retry(2)
        return data

    run_pipeline(handler, "feed", tmp_path, run_log=RunLog(log_path))

    by_step = {r["step"]: r for r in _records(log_path)}
    assert _waits(by_step["read"]) == (1, 22)
    assert _waits(by_step["call-service"]) == (1, 2)
    assert _waits(by_step["run"]) == (2, 24)


def test_the_runner_records_the_waits_of_a_handler_that_failed(tmp_path):
    log_path = tmp_path / "run.log"

    def handler(context):
        note_retry(6)
        raise RuntimeError("handler failed after retrying")

    with pytest.raises(RuntimeError):
        run_pipeline(handler, "feed", tmp_path, run_log=RunLog(log_path))

    [summary] = _records(log_path)
    assert (summary["step"], summary["status"]) == ("run", "error")
    assert _waits(summary) == (1, 6)


def test_an_eager_step_that_failed_records_its_waits(tmp_path):
    log_path = tmp_path / "run.log"
    clock = Clock()
    reader = RetryingReader(
        _SlowFlakyReader(clock, fails=99, takes=5), _policy(clock, attempts=3)
    )

    def handler(context):
        return read(reader)

    with pytest.raises(ConnectionError):
        run_pipeline(handler, "feed", tmp_path, run_log=RunLog(log_path))

    by_step = {r["step"]: r for r in _records(log_path)}
    assert by_step["read"]["status"] == "error"
    assert _waits(by_step["read"]) == (2, 30)


def test_a_record_written_outside_any_step_carries_no_waits(tmp_path):
    log_path = tmp_path / "run.log"
    RunLog(log_path).record("run-1", "feed", "note", "ok")
    [record] = _records(log_path)
    assert _waits(record) == (None, None)
