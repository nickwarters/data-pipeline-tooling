```python
"""Tests for ``stream_step`` — the streaming read→filter→write run-log drive.

Drives a real filtering ``ChunkReader`` into a capturing writer under a real
``RunLog`` and asserts both the landed rows and the single JSONL record
(``rows_in`` / ``rows_out`` / ``rows_excluded``, fail-fast on error).
"""

import json
from pathlib import Path

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.errors import PipelineError
from framework.io.readers import KeyFilterChunkReader
from tools.observability.run_log import RunLog
from tools.observability.stream import stream_step


class _ListChunkReader:
    """A ChunkReader over an in-memory list of row dicts, split into chunks."""

    def __init__(self, rows):
        self._rows = rows

    def chunks(self, size=10_000):
        for start in range(0, len(self._rows), size):
            window = self._rows[start : start + size]
            if window:
                yield Dataset.from_pandas(pd.DataFrame(window))


class _CapturingWriter:
    """A Writer that keeps every chunk it is handed."""

    def __init__(self):
        self.chunks = []

    def write(self, dataset: Dataset) -> None:
        self.chunks.append(dataset)

    def rows(self):
        return [r for c in self.chunks for r in c.to_pandas().to_dict("records")]


def _records(log_path: Path):
    return [json.loads(line) for line in log_path.read_text().splitlines()]


def _filtered_reader(n, allowed):
    rows = [{"id": i, "val": i * 10} for i in range(n)]
    return KeyFilterChunkReader(_ListChunkReader(rows), "id", allowed)


def test_streams_only_kept_rows_and_returns_the_tally(tmp_path):
    run_log = RunLog(tmp_path / "runs.log")
    writer = _CapturingWriter()
    reader = _filtered_reader(100, allowed={3, 50, 99})

    result = stream_step(
        run_log,
        pipeline_run_id="run-1",
        pipeline="big/ingest",
        step="ingest_big",
        reader=reader,
        writer=writer,
        size=10,
    )

    assert [r["id"] for r in writer.rows()] == [3, 50, 99]
    assert (result.rows_in, result.rows_out, result.rows_excluded) == (100, 3, 97)
    assert result.chunks == 3  # the three chunks that held a match each survive


def test_emits_one_ok_jsonl_record_with_filter_counts(tmp_path):
    run_log = RunLog(tmp_path / "runs.log")
    reader = _filtered_reader(100, allowed={3, 50, 99})

    stream_step(
        run_log,
        pipeline_run_id="run-1",
        pipeline="big/ingest",
        step="ingest_big",
        reader=reader,
        writer=_CapturingWriter(),
        size=10,
    )

    records = _records(run_log.path)
    assert len(records) == 1
    rec = records[0]
    assert rec["status"] == "ok"
    assert rec["step"] == "ingest_big"
    assert (rec["rows_in"], rec["rows_out"], rec["rows_excluded"]) == (100, 3, 97)
    assert rec["committed"] is True


def test_all_filtered_source_records_the_full_scan_and_zero_kept(tmp_path):
    # No id matches: the loop body never runs, yet the reader still scans the
    # whole source -> rows_in is the full scan, rows_out 0, all excluded.
    run_log = RunLog(tmp_path / "runs.log")
    writer = _CapturingWriter()
    reader = _filtered_reader(20, allowed=set())

    result = stream_step(
        run_log,
        pipeline_run_id="run-1",
        pipeline="big/ingest",
        step="ingest_big",
        reader=reader,
        writer=writer,
        size=5,
    )

    assert writer.rows() == []
    assert (result.rows_in, result.rows_out, result.rows_excluded) == (20, 0, 20)
    rec = _records(run_log.path)[0]
    assert (rec["rows_in"], rec["rows_out"], rec["rows_excluded"]) == (20, 0, 20)


def test_plain_reader_reports_nothing_excluded(tmp_path):
    # A non-filtering ChunkReader has no rows_scanned counter: scanned == written.
    run_log = RunLog(tmp_path / "runs.log")
    writer = _CapturingWriter()
    reader = _ListChunkReader([{"id": i} for i in range(7)])

    result = stream_step(
        run_log,
        pipeline_run_id="run-1",
        pipeline="plain/ingest",
        step="ingest",
        reader=reader,
        writer=writer,
        size=3,
    )

    assert (result.rows_in, result.rows_out, result.rows_excluded) == (7, 7, 0)


def test_failure_mid_stream_is_recorded_as_error_with_category_and_reraised(tmp_path):
    run_log = RunLog(tmp_path / "runs.log")
    reader = _filtered_reader(100, allowed=set(range(100)))  # keep everything

    class _ExplodingWriter:
        def __init__(self):
            self.calls = 0

        def write(self, dataset):
            self.calls += 1
            if self.calls == 2:
                # Base PipelineError defaults to the OPERATIONAL category.
                raise PipelineError("disk full")

    with pytest.raises(PipelineError, match="disk full"):
        stream_step(
            run_log,
            pipeline_run_id="run-1",
            pipeline="big/ingest",
            step="ingest_big",
            reader=reader,
            writer=_ExplodingWriter(),
            size=10,
        )

    rec = _records(run_log.path)[0]
    assert rec["status"] == "error"
    assert rec["error_category"] == "operational"
    assert rec["errors"] == ["disk full"]
    # Fail-fast: the error path never marks the step committed.
    assert rec["committed"] is False
    # The partial progress before the abort is still visible (one chunk written).
    assert rec["rows_out"] == 10

```
