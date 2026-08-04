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
from tests.framework_testing import RecordingRunLog
from tools.observability.run_log import RunLog
from tools.retry import (
    RetryingChunkReader,
    RetryingReader,
    RetryingWriter,
    RetryPolicy,
)

_SOURCE = {"namespace": "file", "name": "/d/orders.csv"}
_TARGET = {"namespace": "sqlite:/d/raw.db", "name": "orders"}


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
        self.data_locations = [_SOURCE]
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
        self.data_locations = [_TARGET]
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


# --------------------------------------------------------------------------
# Streaming: the readers most exposed to a transient failure were the ones
# retry could not reach, since a ChunkReader has no read() to wrap.
# --------------------------------------------------------------------------


class FlakyChunkReader:
    """A ChunkReader that fails on its first ``fails`` attempts to open."""

    def __init__(self, error: Exception, fails: int, rows: int = 6) -> None:
        self._error = error
        self._fails = fails
        self._rows = rows
        self.attempts = 0

    def chunks(self, size: int = 10_000):
        self.attempts += 1
        if self.attempts <= self._fails:
            raise self._error
        self.data_locations = [_SOURCE]
        for start in range(0, self._rows, size):
            frame = pd.DataFrame(
                {"id": list(range(start, min(start + size, self._rows)))}
            )
            yield Dataset.from_pandas(frame)

    def describe(self) -> str:
        return f"FlakyChunkReader(rows={self._rows})"


class BreakingMidStreamReader:
    """A ChunkReader that yields one chunk and then fails."""

    def __init__(self, error: Exception) -> None:
        self._error = error
        self.attempts = 0

    def chunks(self, size: int = 10_000):
        self.attempts += 1
        yield Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
        raise self._error


def test_a_chunk_reader_that_fails_to_open_is_retried_from_the_start():
    inner = FlakyChunkReader(ConnectionError("share unreachable"), fails=2)
    reader = RetryingChunkReader(
        inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,))
    )

    rows = sum(len(chunk) for chunk in reader.chunks(size=2))

    assert rows == 6
    assert inner.attempts == 3
    assert len(reader.retry_attempts) == 2


def test_a_failure_after_the_first_chunk_is_not_retried():
    """Restarting would re-hand rows a consumer has already written."""
    inner = BreakingMidStreamReader(ConnectionError("dropped mid-stream"))
    reader = RetryingChunkReader(
        inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,))
    )

    with pytest.raises(ConnectionError):
        list(reader.chunks(size=10))

    assert inner.attempts == 1


def test_a_non_transient_chunk_failure_is_not_retried():
    inner = FlakyChunkReader(FileNotFoundError("no such extract"), fails=1)
    reader = RetryingChunkReader(
        inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,))
    )

    with pytest.raises(FileNotFoundError):
        list(reader.chunks(size=10))

    assert inner.attempts == 1


def test_a_retried_chunk_reader_still_reports_the_filters_scan():
    from framework.io.readers import PredicateChunkReader

    inner = PredicateChunkReader(
        FlakyChunkReader(ConnectionError("x"), fails=0, rows=10),
        lambda chunk: Dataset.from_pandas(chunk.to_pandas().head(1)),
    )
    reader = RetryingChunkReader(inner, RetryPolicy(attempts=2, retry_on=(OSError,)))

    list(reader.chunks(size=5))

    assert reader.rows_scanned == 10
    assert reader.rows_kept == 2


def test_a_plain_retried_reader_reports_no_scan_tally():
    reader = RetryingChunkReader(
        FlakyChunkReader(ConnectionError("x"), fails=0),
        RetryPolicy(attempts=2, retry_on=(OSError,)),
    )

    assert getattr(reader, "rows_scanned", None) is None


# --------------------------------------------------------------------------
# describe(): retry is an operational concern and must not cost the plan
# the line saying where the data comes from.
# --------------------------------------------------------------------------


def test_the_plan_shows_the_wrapped_reader_through_the_retry_decorator(tmp_path):
    from framework.io.readers import CsvReader

    inner = CsvReader(tmp_path / "feed.csv")
    reader = RetryingReader(inner, RetryPolicy(attempts=3, retry_on=(OSError,)))

    rendered = reader.describe()
    assert rendered.startswith("Retrying(CsvReader(path=")
    assert "attempts=3" in rendered


def test_the_plan_shows_the_wrapped_chunk_reader_too():
    reader = RetryingChunkReader(
        FlakyChunkReader(ConnectionError("x"), fails=0),
        RetryPolicy(attempts=2, retry_on=(OSError,)),
    )

    assert reader.describe() == "Retrying(FlakyChunkReader(rows=6), attempts=2)"


def test_the_plan_shows_the_wrapped_writer_through_the_retry_decorator(tmp_path):
    from framework.io.writers import SqliteTruncateReloadWriter

    writer = RetryingWriter(
        SqliteTruncateReloadWriter(tmp_path / "raw.db", "feed"),
        RetryPolicy(attempts=2, retry_on=(OSError,)),
    )

    assert "SqliteTruncateReloadWriter" in writer.describe()


def test_the_pipeline_plan_names_the_source_behind_a_retrying_reader(tmp_path):
    from framework.io.readers import CsvReader

    p = Pipeline("flaky-feed")
    p.read(
        RetryingReader(
            CsvReader(tmp_path / "feed.csv"),
            RetryPolicy(attempts=2, retry_on=(OSError,)),
        ),
        name="read",
    )

    # The node line names the step; the reader's own summary is what retry used
    # to erase, so assert it can still be rendered from the wrapped component.
    assert "CsvReader" in p._nodes[0].reader.describe()


# --------------------------------------------------------------------------
# Retry composes with a chunked load rather than blocking it.
# --------------------------------------------------------------------------


def test_retry_does_not_advertise_a_chunked_load_the_inner_writer_cannot_take(tmp_path):
    from framework.io.writers import SqliteTruncateReloadWriter, supports_chunk_writes

    writer = RetryingWriter(
        SqliteTruncateReloadWriter(tmp_path / "raw.db", "feed"),
        RetryPolicy(attempts=2, retry_on=(OSError,)),
    )

    assert supports_chunk_writes(writer) is False


def test_retry_passes_a_chunked_load_through_to_a_writer_that_takes_one(tmp_path):
    import sqlite3

    from framework.io.writers import SqliteInsertOrIgnoreWriter, supports_chunk_writes

    inner = SqliteInsertOrIgnoreWriter(tmp_path / "raw.db", "feed")
    writer = RetryingWriter(inner, RetryPolicy(attempts=2, retry_on=(OSError,)))
    assert supports_chunk_writes(writer) is True

    from framework.io.writers import writing_chunks

    with writing_chunks(writer) as chunk_writer:
        for start in (0, 2):
            frame = pd.DataFrame({"id": [start, start + 1]})
            chunk_writer.write(Dataset.from_pandas(frame))

    with sqlite3.connect(tmp_path / "raw.db") as con:
        assert pd.read_sql("SELECT * FROM feed", con)["id"].tolist() == [0, 1, 2, 3]


# --------------------------------------------------------------------------
# Data locations survive the decorator: a silently blank field is the failure
# mode.
# --------------------------------------------------------------------------


def test_a_read_node_behind_retry_still_records_the_source():
    run_log = RecordingRunLog()
    p = Pipeline("orders", run_log=run_log)
    reader = RetryingReader(
        FlakyReader(ConnectionError("briefly unavailable"), fails=1),
        RetryPolicy(attempts=3, retry_on=(ConnectionError,)),
    )
    r = p.read(reader, name="read")
    p.write(_MuteWriter(), r, name="write")
    p.run()

    [record] = run_log.records_for_step("read")
    assert record["data_locations"] == [_SOURCE]


def test_a_write_node_behind_retry_still_records_the_target():
    run_log = RecordingRunLog()
    p = Pipeline("orders", run_log=run_log)
    r = p.read(FlakyReader(ConnectionError("x"), fails=0), name="read")
    writer = RetryingWriter(
        FlakyWriter(ConnectionError("briefly unavailable"), fails=1),
        RetryPolicy(attempts=3, retry_on=(ConnectionError,)),
    )
    p.write(writer, r, name="write")
    p.run()

    [record] = run_log.records_for_step("write")
    assert record["data_locations"] == [_TARGET]


def test_a_retried_chunk_reader_forwards_what_the_source_reported():
    inner = FlakyChunkReader(ConnectionError("share unreachable"), fails=1)
    reader = RetryingChunkReader(
        inner, RetryPolicy(attempts=3, retry_on=(ConnectionError,))
    )

    list(reader.chunks(size=2))

    assert reader.data_locations == [_SOURCE]


def test_a_nested_chunk_write_session_still_reaches_the_innermost_writer(tmp_path):
    from framework.io.writers import SqliteInsertOrIgnoreWriter, writing_chunks

    db = tmp_path / "raw.db"
    writer = RetryingWriter(
        SqliteInsertOrIgnoreWriter(db, "feed"),
        RetryPolicy(attempts=2, retry_on=(OSError,)),
    )

    with writing_chunks(writer) as chunk_writer:
        chunk_writer.write(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
        assert chunk_writer.data_locations == [
            {"namespace": f"sqlite:{db.as_posix()}", "name": "feed"}
        ]


def test_a_wrapped_component_that_reports_nothing_forwards_an_empty_list():
    reader = RetryingReader(
        FlakyReader(ConnectionError("x"), fails=99),
        RetryPolicy(attempts=1, retry_on=(ConnectionError,)),
    )

    assert reader.data_locations == []


class _MuteWriter:
    def write(self, dataset: Dataset) -> None:
        pass

```
