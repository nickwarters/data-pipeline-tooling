"""What a step spent waiting on: retries and external calls, as recorded."""

from __future__ import annotations

import json

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.run import read, run_pipeline, step, write
from framework.run.builder import Pipeline
from tools.integrations.remote import SharePointReader, SharePointWriter
from tools.observability.run_log import RunLog
from tools.observability.waits import external_call, measure_waits, note_retry
from tools.retry import RetryingReader, RetryPolicy

WAIT_FIELDS = (
    "retry_attempts",
    "retry_wait_seconds",
    "external_calls",
    "external_wait_seconds",
)


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


def test_an_external_call_counts_its_time_towards_the_open_tally():
    clock = Clock()
    with measure_waits() as waits:
        with external_call(clock):
            clock.now += 4.5
    assert (waits.external_calls, waits.external_wait_seconds) == (1, 4.5)


def test_a_failed_external_call_still_counts_the_time_it_waited():
    clock = Clock()
    with measure_waits() as waits:
        with pytest.raises(TimeoutError):
            with external_call(clock):
                clock.now += 30
                raise TimeoutError("service did not answer")
    assert (waits.external_calls, waits.external_wait_seconds) == (1, 30)


def test_an_external_call_inside_another_is_counted_once():
    clock = Clock()
    with measure_waits() as waits:
        with external_call(clock):
            with external_call(clock):
                clock.now += 2
    assert (waits.external_calls, waits.external_wait_seconds) == (1, 2)


def test_a_closed_inner_tally_adds_to_the_one_around_it():
    clock = Clock()
    with measure_waits() as outer:
        with measure_waits() as inner:
            with external_call(clock):
                clock.now += 3
            note_retry(1.5)
        with external_call(clock):
            clock.now += 1
    assert inner.fields() == {
        "retry_attempts": 1,
        "retry_wait_seconds": 1.5,
        "external_calls": 1,
        "external_wait_seconds": 3,
    }
    assert outer.fields() == {
        "retry_attempts": 1,
        "retry_wait_seconds": 1.5,
        "external_calls": 2,
        "external_wait_seconds": 4,
    }


def test_waits_outside_any_tally_are_dropped_without_error():
    with external_call():
        pass
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
        with external_call(clock):
            clock.now += 7
        return dataset

    p = Pipeline("feed", run_log=RunLog(log_path))
    p.transform(enrich, p.read(reader, name="read"), name="enrich")
    p.run()

    by_step = {r["step"]: r for r in _records(log_path)}
    assert _waits(by_step["read"]) == (1, 15, 0, 0)
    assert _waits(by_step["enrich"]) == (0, 0, 1, 7)
    assert _waits(by_step["run"]) == (1, 15, 1, 7)


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
    assert _waits(by_step["read"]) == (2, 30, 0, 0)
    assert _waits(by_step["run"]) == (2, 30, 0, 0)


def test_eager_steps_record_their_waits(tmp_path):
    log_path = tmp_path / "run.log"
    clock = Clock()

    class SlowFetcher:
        def fetch(self, site, list_name, auth):
            clock.now += 12
            return _frame()

    class SlowPusher:
        def push(self, site, list_name, auth, dataset, strategy):
            clock.now += 3

    def handler(context):
        # The SharePoint seams time themselves on the real clock, so only
        # their call counts are pinned here.
        data = read(SharePointReader("site", "Cases", fetcher=SlowFetcher()))
        with step("call-service"):
            with external_call(clock):
                clock.now += 2
        return write(SharePointWriter("site", "Out", pusher=SlowPusher()), data)

    run_pipeline(handler, "feed", tmp_path, run_log=RunLog(log_path))

    by_step = {r["step"]: r for r in _records(log_path)}
    assert by_step["read"]["external_calls"] == 1
    assert by_step["write"]["external_calls"] == 1
    assert _waits(by_step["call-service"]) == (0, 0, 1, 2)
    assert by_step["run"]["external_calls"] == 3


def test_a_record_written_outside_any_step_carries_no_waits(tmp_path):
    log_path = tmp_path / "run.log"
    RunLog(log_path).record("run-1", "feed", "note", "ok")
    [record] = _records(log_path)
    assert _waits(record) == (None, None, None, None)
