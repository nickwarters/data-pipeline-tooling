```python
"""Retry policy at the reader/writer edges.

A ``RetryPolicy`` retries only the transient I/O failures it is told to (an
explicit allowlist), and ``RetryingReader`` / ``RetryingWriter`` apply it at the
read/write seam so the retry stays scoped to the edge — never around validation
or business rules. Tests drive flaky test doubles, never a real network or DB.
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.run.builder import Pipeline
from tools.observability.run_log import RunLog
from tools.retry import RetryingReader, RetryingWriter, RetryPolicy


class FlakyReader:
    """A Reader that raises a transient error for its first ``fails`` reads."""

    def __init__(self, error: Exception, fails: int) -> None:
        self._error = error
        self._fails = fails
        self.calls = 0

    def read(self) -> Dataset:
        self.calls += 1
        if self.calls <= self._fails:
            raise self._error
        return Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))


def test_transient_read_failure_succeeds_after_retry():
    # The canonical transient edge: the source is briefly unavailable, then the
    # next attempt lands. The retry is invisible to the caller — it gets the
    # Dataset, not the error.
    inner = FlakyReader(ConnectionError("source briefly unavailable"), fails=1)
    reader = RetryingReader(inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,)))

    dataset = reader.read()

    assert len(dataset) == 2
    assert inner.calls == 2  # one failure + one success


def test_non_retryable_failure_aborts_immediately():
    # A configuration error (here, a missing file) is not on the allowlist, so it
    # propagates on the first attempt — retry never masks a non-transient fault.
    inner = FlakyReader(FileNotFoundError("source.csv is missing"), fails=99)
    reader = RetryingReader(inner, RetryPolicy(attempts=5, retry_on=(ConnectionError,)))

    with pytest.raises(FileNotFoundError):
        reader.read()

    assert inner.calls == 1  # aborted without a second attempt


class FlakyWriter:
    """A Writer that raises a transient error for its first ``fails`` writes."""

    def __init__(self, error: Exception, fails: int) -> None:
        self._error = error
        self._fails = fails
        self.calls = 0
        self.written: Dataset | None = None

    def write(self, dataset: Dataset) -> None:
        self.calls += 1
        if self.calls <= self._fails:
            raise self._error
        self.written = dataset


def test_transient_write_failure_succeeds_after_retry():
    # The sink edge is the dual of the source edge: a brief lock/unavailability is
    # retried, and the dataset eventually lands.
    inner = FlakyWriter(ConnectionError("sink briefly unavailable"), fails=1)
    writer = RetryingWriter(inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,)))

    writer.write(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    assert inner.calls == 2
    assert inner.written is not None and len(inner.written) == 1


def test_exhausting_attempts_reraises_the_transient_error():
    # If every attempt fails, the run still aborts: the transient error is
    # re-raised after the last try rather than swallowed.
    inner = FlakyReader(ConnectionError("still down"), fails=99)
    reader = RetryingReader(inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,)))

    with pytest.raises(ConnectionError):
        reader.read()

    assert inner.calls == 3  # exactly `attempts` tries, then re-raise


def test_backoff_is_slept_between_attempts_via_injected_sleep():
    # Backoff waits between attempts, through an injectable sleep so the wait is
    # cross-platform and tests stay fast. One success after two failures means
    # two waits.
    slept: list[float] = []
    inner = FlakyReader(ConnectionError("transient"), fails=2)
    policy = RetryPolicy(
        attempts=5,
        retry_on=(ConnectionError,),
        backoff_seconds=0.25,
        sleep=slept.append,
    )

    RetryingReader(inner, policy).read()

    assert slept == [0.25, 0.25]


def _read_log(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_run_log_records_retry_attempts_and_final_outcome(tmp_path):
    # AC: a transient edge failure that succeeds after retry is visible in the
    # structured run log — the retried attempt is recorded on the read step, and
    # the step's final outcome is `ok` because the retry recovered.
    log_path = tmp_path / "run.log"
    inner = FlakyReader(ConnectionError("source briefly unavailable"), fails=1)
    reader = RetryingReader(inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,)))

    p = Pipeline("flaky-feed", run_log=RunLog(log_path))
    p.read(reader, name="read")
    p.run()

    [read_record] = [r for r in _read_log(log_path) if r["step"] == "read"]
    assert read_record["status"] == "ok"
    assert len(read_record["warn_hits"]) == 1
    assert "retry read" in read_record["warn_hits"][0]


def test_run_log_records_a_non_retryable_abort(tmp_path):
    # AC: a non-retryable failure aborts immediately and is recorded as an error
    # on the read step — no retry, no masking.
    log_path = tmp_path / "run.log"
    inner = FlakyReader(FileNotFoundError("source.csv is missing"), fails=99)
    reader = RetryingReader(inner, RetryPolicy(attempts=5, retry_on=(ConnectionError,)))

    p = Pipeline("flaky-feed", run_log=RunLog(log_path))
    p.read(reader, name="read")

    with pytest.raises(FileNotFoundError):
        p.run()

    [read_record] = [r for r in _read_log(log_path) if r["step"] == "read"]
    assert read_record["status"] == "error"
    assert read_record["warn_hits"] == []
    assert inner.calls == 1


def test_policy_wraps_a_bare_remote_client_call():
    # A RetryPolicy is a standalone collaborator: a remote client (SharePoint/SAS
    # fetch) can call through it directly, without a Reader/Writer wrapper, and
    # still get the transient-only retry semantics.
    calls = {"n": 0}

    def fetch() -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("remote briefly unavailable")
        return "rows"

    policy = RetryPolicy(attempts=3, retry_on=(ConnectionError,))

    assert policy.call(fetch) == "rows"
    assert calls["n"] == 2

```
