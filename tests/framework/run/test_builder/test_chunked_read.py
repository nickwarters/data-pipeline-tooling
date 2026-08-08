"""``Pipeline.read_chunks`` — a source too big to hold whole, inside the DAG.

The streaming readers used to live beside the builder: nothing consumed a
``ChunkReader``, so a feed that outgrew memory lost validators, quarantine,
profiling, dry run and per-step run-log records at exactly the moment the data
got hard. These tests hold the seam that ends that to the properties that make
it trustworthy rather than merely present.

Three of them are the reason it exists at all. Memory must stay bounded across a
multi-chunk drive — asserted through weak references to the chunks themselves,
so a driver that accumulated them would fail. Each step must still record
*once*, with its counts summed across chunks, or a fifty-chunk read would be
fifty times the log a one-shot read is. And the pairings that cannot be made
chunk-safe — a Writer that replaces its target, a check that needs the whole
population — must be refused when the graph is wired, before a byte is read.
"""

from __future__ import annotations

import gc
import weakref
from dataclasses import dataclass
from typing import Annotated

import pandas as pd
import pytest

from framework.core import Range, SchemaValidator
from framework.core.dataset import Dataset
from framework.core.validators import (
    RowCountValidator,
    StreamingUniqueValidator,
    UniqueValidator,
    ValidationError,
    VolumeAnomalyValidator,
)
from framework.io.readers import DatasetReader, PredicateChunkReader
from framework.io.strategy import AccumulateByRun
from framework.io.writers import (
    QuarantineWriter,
    SqliteInsertOrIgnoreWriter,
    SqliteTruncateReloadWriter,
)
from framework.run.builder import Pipeline, PipelineGraphError
from framework.run.run_context import RunContext
from framework.transform.quarantine import SchemaValueRulePartitioner
from tests.framework_testing import RecordingRunLog


@dataclass
class SmallId:
    """A schema whose value rule rejects the tail of the streamed source."""

    id: Annotated[int, Range(maximum=24)]
    val: int


class ListChunkReader:
    """A ChunkReader over rows held in memory, handed out ``size`` at a time."""

    def __init__(self, rows: list[dict], location: dict | None = None) -> None:
        self._rows = rows
        self._location = location

    def chunks(self, size: int = 10_000):
        if self._location is not None:
            self.data_locations = [self._location]
        for start in range(0, len(self._rows), size):
            window = self._rows[start : start + size]
            if window:
                yield Dataset.from_pandas(pd.DataFrame(window))

    def describe(self) -> str:
        return f"ListChunkReader(rows={len(self._rows)})"


class CountingWriter:
    """A Writer that tallies what it was handed without keeping any of it."""

    def __init__(self) -> None:
        self.rows = 0
        self.writes = 0

    def write(self, dataset: Dataset) -> None:
        self.rows += len(dataset)
        self.writes += 1

    def writing_chunks(self):
        from contextlib import nullcontext

        return nullcontext(self)


class CapturingWriter:
    """A Writer that keeps every dataset it is handed."""

    def __init__(self) -> None:
        self.written: list[Dataset] = []

    def write(self, dataset: Dataset) -> None:
        self.written.append(dataset)

    def writing_chunks(self):
        from contextlib import nullcontext

        return nullcontext(self)

    def rows(self) -> list[dict]:
        return [
            row
            for dataset in self.written
            for row in dataset.to_pandas().to_dict("records")
        ]


def _rows(n: int, *, start: int = 0) -> list[dict]:
    return [{"id": i, "val": i * 10} for i in range(start, start + n)]


# --------------------------------------------------------------------------
# It composes: the sub-graph below a streamed source runs for every chunk
# --------------------------------------------------------------------------


def test_every_chunk_flows_through_the_transform_and_reaches_the_writer():
    writer = CapturingWriter()
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(_rows(25)), name="read", chunk_size=10)
    shaped = p.transform(
        lambda ds: Dataset.from_pandas(
            ds.to_pandas().assign(doubled=lambda f: f.val * 2)
        ),
        source,
        name="shape",
    )
    p.write(writer, shaped, name="write")
    p.run()

    landed = writer.rows()
    assert len(landed) == 25
    assert [row["doubled"] for row in landed[:3]] == [0, 20, 40]
    # Three chunks of 10/10/5, each written as it streamed.
    assert len(writer.written) == 3


def test_an_empty_chunk_passes_the_schema_gate_and_still_reaches_the_writer():
    """A quiet window mid-stream is not a breach — it is a chunk with no rows.

    A source that hands back nothing for a window types its columns as nothing
    can: ``object``. The schema gate has no value to check, so the chunk flows
    through the same hops as a populated one rather than aborting the drive.
    """

    class QuietWindowReader:
        """Yields a populated chunk, then a quiet one, then another populated."""

        def chunks(self, size: int = 10_000):
            yield Dataset.from_pandas(pd.DataFrame(_rows(2)))
            yield Dataset.from_pandas(pd.DataFrame({"id": [], "val": []}, dtype=object))
            yield Dataset.from_pandas(pd.DataFrame(_rows(2, start=2)))

        def describe(self) -> str:
            return "QuietWindowReader()"

    writer = CapturingWriter()
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(QuietWindowReader(), name="read", chunk_size=10)
    p.validate(SchemaValidator(SmallId), source, name="schema")
    p.write(writer, source, name="write")
    p.run()

    assert len(writer.rows()) == 4
    assert len(writer.written) == 3


def test_a_whole_dataset_input_joined_into_a_stream_is_read_once_not_per_chunk():
    """The memo is dropped only below the streamed source, not everywhere."""
    reads = []

    class CountingReader:
        def read(self) -> Dataset:
            reads.append(1)
            return Dataset.from_pandas(pd.DataFrame({"id": [1], "ref": ["x"]}))

    writer = CountingWriter()
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(_rows(30)), name="read", chunk_size=10)
    side = p.read(CountingReader(), name="ref")
    joined = p.transform(lambda chunk, ref: chunk, source, side, name="join")
    p.write(writer, joined, name="write")
    p.run()

    assert writer.rows == 30
    assert sum(reads) == 1


# --------------------------------------------------------------------------
# Memory: the point of the whole seam
# --------------------------------------------------------------------------


def test_no_chunk_is_still_held_once_the_next_one_has_been_driven():
    """The bounded-memory proof: peak live chunks, measured *during* the drive.

    Checking liveness after ``run()`` returns is not enough — a driver that
    hoarded every chunk and dropped the pile on the way out would pass that.
    So the reader collects and counts before handing over each new chunk: what
    is still alive at that moment is the drive's actual high-water mark.
    """
    seen: list[weakref.ref] = []
    peak_alive = 0

    class WeakRefReader(ListChunkReader):
        def chunks(self, size: int = 10_000):
            nonlocal peak_alive
            for chunk in super().chunks(size):
                # Before yielding the next chunk, take the high-water mark of
                # how much of the source the drive is still holding on to.
                gc.collect()
                peak_alive = max(peak_alive, sum(1 for r in seen if r() is not None))
                seen.append(weakref.ref(chunk))
                yield chunk

    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(WeakRefReader(_rows(500)), name="read", chunk_size=50)
    shaped = p.transform(lambda ds: ds, source, name="shape")
    p.write(CountingWriter(), shaped, name="write")
    p.run()

    assert len(seen) == 10
    # At most the chunk just driven is still reachable when the next arrives.
    # A driver that accumulated would climb with the source instead, which is
    # the failure this seam exists to stop.
    assert peak_alive <= 1, f"drive held {peak_alive} chunks at once"

    gc.collect()
    alive = [ref for ref in seen if ref() is not None]
    # And nothing outlives the run but the read node's final result.
    assert len(alive) <= 1


# --------------------------------------------------------------------------
# Recording: one record per step, counts summed
# --------------------------------------------------------------------------


def test_each_step_records_once_however_many_chunks_it_took():
    run_log = RecordingRunLog()
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(ListChunkReader(_rows(100)), name="read", chunk_size=10)
    shaped = p.transform(lambda ds: ds, source, name="shape")
    p.write(CountingWriter(), shaped, name="write")
    p.run()

    assert [r["step"] for r in run_log.records] == ["read", "shape", "write", "run"]


def test_the_single_record_per_step_carries_the_counts_summed_across_chunks():
    run_log = RecordingRunLog()
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(ListChunkReader(_rows(100)), name="read", chunk_size=10)
    p.write(CountingWriter(), source, name="write")
    p.run()

    [read] = run_log.records_for_step("read")
    assert (read["rows_in"], read["rows_out"]) == (100, 100)
    [write] = run_log.records_for_step("write")
    assert (write["rows_in"], write["rows_out"]) == (100, 100)
    assert write["committed"] is True
    [summary] = run_log.records_for_step("run")
    assert summary["rows_in"] == 100
    assert summary["rows_out"] == 100


def test_a_filtering_source_reports_the_whole_scan_not_just_the_survivors():
    """The 100M-row / 100K-allow-list case, in miniature."""
    run_log = RecordingRunLog()

    def keep_low(chunk: Dataset) -> Dataset:
        frame = chunk.to_pandas()
        return Dataset.from_pandas(frame[frame["id"] < 25])

    reader = PredicateChunkReader(ListChunkReader(_rows(100)), keep_low)
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(reader, name="read", chunk_size=10)
    p.write(CountingWriter(), source, name="write")
    p.run()

    [read] = run_log.records_for_step("read")
    assert read["rows_in"] == 100
    assert read["rows_out"] == 25
    assert read["rows_excluded"] == 75


def test_a_source_the_filter_empties_still_records_what_it_scanned():
    """No chunk is yielded at all, yet the source was read end to end."""
    run_log = RecordingRunLog()
    reader = PredicateChunkReader(
        ListChunkReader(_rows(40)),
        lambda chunk: Dataset.from_pandas(chunk.to_pandas().iloc[:0]),
    )
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(reader, name="read", chunk_size=10)
    p.write(CountingWriter(), source, name="write")
    p.run()

    [read] = run_log.records_for_step("read")
    assert read["rows_in"] == 40
    assert read["rows_out"] == 0
    assert read["rows_excluded"] == 40
    # Nothing flowed downstream, so no write step ran at all.
    assert run_log.records_for_step("write") == []


def test_a_streamed_step_keeps_the_address_a_one_shot_step_would_have():
    run_log = RecordingRunLog()
    p = Pipeline("cases/big", run_log=run_log)
    source = p.read_chunks(ListChunkReader(_rows(20)), name="read", chunk_size=10)
    p.write(CountingWriter(), source, name="write")
    p.run()

    assert {r["step"]: r["step_address"] for r in run_log.records} == {
        "read": "cases/big.read",
        "write": "cases/big.write",
        "run": "cases/big",
    }


def test_a_failure_part_way_through_the_stream_still_records_the_steps_so_far():
    run_log = RecordingRunLog()
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(ListChunkReader(_rows(25)), name="read", chunk_size=10)
    # Passes for a full chunk, trips on the short final one.
    p.validate(RowCountValidator(minimum=10), source, name="check")

    with pytest.raises(ValidationError):
        p.run()

    [read] = run_log.records_for_step("read")
    assert read["status"] == "ok"
    assert read["rows_in"] == 25
    [check] = run_log.records_for_step("check")
    assert check["status"] == "error"
    assert check["error_category"] == "data"


def test_a_warn_raised_on_every_chunk_is_reported_once():
    run_log = RecordingRunLog()
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(ListChunkReader(_rows(30)), name="read", chunk_size=10)
    p.validate(RowCountValidator(minimum=1000), source, name="check", severity="warn")
    p.run()

    [check] = run_log.records_for_step("check")
    assert check["status"] == "ok"
    assert len(check["warn_hits"]) == 1


# --------------------------------------------------------------------------
# Wire-time refusals
# --------------------------------------------------------------------------


def test_a_writer_that_replaces_its_target_is_refused_when_the_graph_is_wired(tmp_path):
    p = Pipeline("big")
    source = p.read_chunks(ListChunkReader(_rows(10)), name="read", chunk_size=5)
    writer = SqliteTruncateReloadWriter(tmp_path / "raw.db", "feed")

    with pytest.raises(PipelineGraphError) as caught:
        p.write(writer, source, name="write")

    assert "SqliteTruncateReloadWriter" in str(caught.value)
    assert "only the last" in str(caught.value)


def test_the_same_writer_is_fine_under_an_ordinary_read(tmp_path):
    """The refusal is about the pairing, not about the Writer."""
    p = Pipeline("small")
    read = p.read(
        DatasetReader(Dataset.from_pandas(pd.DataFrame(_rows(3)))), name="read"
    )
    assert p.write(
        SqliteTruncateReloadWriter(tmp_path / "raw.db", "feed"), read, name="write"
    )


def test_a_whole_dataset_validator_is_refused_when_the_graph_is_wired():
    p = Pipeline("big")
    source = p.read_chunks(ListChunkReader(_rows(10)), name="read", chunk_size=5)

    with pytest.raises(PipelineGraphError) as caught:
        p.validate(UniqueValidator("id"), source, name="unique")

    assert "UniqueValidator" in str(caught.value)
    assert "StreamingUniqueValidator" in str(caught.value)


def test_a_volume_check_is_refused_too_since_a_chunk_is_not_a_run():
    p = Pipeline("big")
    source = p.read_chunks(ListChunkReader(_rows(10)), name="read", chunk_size=5)

    class _NoHistory:
        def recent_row_counts(self, pipeline, limit=10, step="read"):
            return []

    with pytest.raises(PipelineGraphError) as caught:
        p.validate(VolumeAnomalyValidator(_NoHistory(), "big"), source, name="volume")

    assert "VolumeAnomalyValidator" in str(caught.value)


def test_explain_is_refused_under_a_stream_because_the_trace_holds_every_row():
    p = Pipeline("big")
    source = p.read_chunks(ListChunkReader(_rows(10)), name="read", chunk_size=5)

    with pytest.raises(PipelineGraphError) as caught:
        p.explain(CapturingWriter(), source, id_column="id")

    assert "whole source in memory" in str(caught.value)


def test_a_second_streamed_source_in_one_pipeline_is_refused():
    p = Pipeline("big")
    p.read_chunks(ListChunkReader(_rows(10)), name="read", chunk_size=5)

    with pytest.raises(PipelineGraphError) as caught:
        p.read_chunks(ListChunkReader(_rows(10)), name="other", chunk_size=5)

    assert "already streams a source" in str(caught.value)


def test_a_non_positive_chunk_size_is_refused():
    p = Pipeline("big")
    with pytest.raises(PipelineGraphError):
        p.read_chunks(ListChunkReader(_rows(10)), name="read", chunk_size=0)


# --------------------------------------------------------------------------
# The streaming uniqueness check: the variant that does survive a boundary
# --------------------------------------------------------------------------


def test_the_streaming_unique_check_catches_a_key_repeated_in_a_later_chunk():
    rows = _rows(20) + [{"id": 3, "val": 999}]
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(rows), name="read", chunk_size=10)
    p.validate(StreamingUniqueValidator("id"), source, name="unique")

    with pytest.raises(ValidationError) as caught:
        p.run()

    assert "duplicate key(s)" in str(caught.value)


def test_the_streaming_unique_check_passes_a_source_with_no_repeats():
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(_rows(30)), name="read", chunk_size=7)
    p.validate(StreamingUniqueValidator("id"), source, name="unique")
    p.run()


def test_the_streaming_unique_check_starts_clean_on_a_second_run():
    """Its key set is per read; carrying it over would fail the re-drive."""
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(_rows(20)), name="read", chunk_size=10)
    p.validate(StreamingUniqueValidator("id"), source, name="unique")
    p.run()
    p.run()


def test_the_streaming_unique_check_refuses_to_become_the_memory_problem():
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(_rows(50)), name="read", chunk_size=10)
    p.validate(StreamingUniqueValidator("id", max_keys=15), source, name="unique")

    with pytest.raises(ValidationError) as caught:
        p.run()

    assert "max_keys=15" in str(caught.value)


# --------------------------------------------------------------------------
# The accumulating load: the delete belongs to the run, not to each chunk
# --------------------------------------------------------------------------


def _landed(db_path, table="feed") -> pd.DataFrame:
    import sqlite3

    with sqlite3.connect(db_path) as con:
        return pd.read_sql(f"SELECT * FROM {table}", con)


def _accumulating_pipeline(db_path, rows, context, *, chunk_size=10):
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(rows), name="read", chunk_size=chunk_size)
    strategy = AccumulateByRun.from_context(context)
    writer = strategy.writer_for(db_path, "feed")
    p.write(writer, source, name="write")
    return p


def test_every_chunk_of_a_run_survives_the_accumulating_load(tmp_path):
    """The sharpest hazard: a per-chunk delete would leave only the last chunk."""
    db = tmp_path / "raw.db"
    context = RunContext(
        pipeline="big", logical_run_id="2026-07-27", load_date="2026-07-27"
    )
    _accumulating_pipeline(db, _rows(35), context).run(context)

    assert len(_landed(db)) == 35


def test_re_driving_the_same_logical_run_replaces_it_rather_than_doubling_it(tmp_path):
    db = tmp_path / "raw.db"
    context = RunContext(
        pipeline="big", logical_run_id="2026-07-27", load_date="2026-07-27"
    )
    _accumulating_pipeline(db, _rows(35), context).run(context)
    _accumulating_pipeline(db, _rows(35), context).run(context)

    landed = _landed(db)
    assert len(landed) == 35
    assert set(landed["logical_run_id"]) == {"2026-07-27"}


def test_a_re_drive_that_now_yields_nothing_still_clears_the_run(tmp_path):
    """The clear is the run's, so it happens even with no chunk to follow it."""
    db = tmp_path / "raw.db"
    context = RunContext(
        pipeline="big", logical_run_id="2026-07-27", load_date="2026-07-27"
    )
    _accumulating_pipeline(db, _rows(20), context).run(context)
    _accumulating_pipeline(db, [], context).run(context)

    assert len(_landed(db)) == 0


def test_a_streamed_run_never_touches_another_logical_runs_rows(tmp_path):
    db = tmp_path / "raw.db"
    first = RunContext(
        pipeline="big", logical_run_id="2026-07-26", load_date="2026-07-26"
    )
    second = RunContext(
        pipeline="big", logical_run_id="2026-07-27", load_date="2026-07-27"
    )
    _accumulating_pipeline(db, _rows(15), first).run(first)
    _accumulating_pipeline(db, _rows(15, start=100), second).run(second)
    _accumulating_pipeline(db, _rows(15, start=100), second).run(second)

    landed = _landed(db)
    assert len(landed) == 30
    assert sorted(set(landed["logical_run_id"])) == ["2026-07-26", "2026-07-27"]


def test_a_dry_run_of_a_streamed_load_clears_nothing(tmp_path):
    """Opening the session commits the run's clear — a preview must not."""
    db = tmp_path / "raw.db"
    context = RunContext(
        pipeline="big", logical_run_id="2026-07-27", load_date="2026-07-27"
    )
    _accumulating_pipeline(db, _rows(20), context).run(context)

    preview = RunContext(
        pipeline="big",
        logical_run_id="2026-07-27",
        load_date="2026-07-27",
        dry_run=True,
    )
    _accumulating_pipeline(db, _rows(20), preview).run(preview)

    assert len(_landed(db)) == 20


def test_an_appending_load_takes_the_chunks_as_they_come(tmp_path):
    db = tmp_path / "raw.db"
    writer = SqliteInsertOrIgnoreWriter(db, "feed")
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ListChunkReader(_rows(30)), name="read", chunk_size=10)
    p.write(writer, source, name="write")
    p.run()

    assert len(_landed(db)) == 30


def test_the_run_s_prior_rejects_are_cleared_once_across_a_streamed_quarantine(
    tmp_path,
):
    from dataclasses import dataclass

    @dataclass
    class Small:
        id: Annotated[int, Range(maximum=24)]
        val: int

    db = tmp_path / "quarantine.db"
    context = RunContext(
        pipeline="big", logical_run_id="2026-07-27", load_date="2026-07-27"
    )

    def build():
        p = Pipeline("big", run_log=RecordingRunLog())
        source = p.read_chunks(ListChunkReader(_rows(40)), name="read", chunk_size=10)
        p.quarantine(
            SchemaValueRulePartitioner(SmallId),
            QuarantineWriter(db, "rejects"),
            source,
        )
        return p

    build().run(context)
    first = len(_landed(db, "rejects"))
    build().run(context)

    assert first == 15  # ids 25..39
    assert len(_landed(db, "rejects")) == 15


# --------------------------------------------------------------------------
# Dry run and describe
# --------------------------------------------------------------------------


def test_a_dry_run_previews_the_first_chunk_and_reads_no_further():
    chunks_taken = []

    class ObservingReader(ListChunkReader):
        def chunks(self, size: int = 10_000):
            for chunk in super().chunks(size):
                chunks_taken.append(len(chunk))
                yield chunk

    context = RunContext(pipeline="big", dry_run=True)
    report = context.dry_run_report
    writer = CountingWriter()
    p = Pipeline("big", run_log=RecordingRunLog())
    source = p.read_chunks(ObservingReader(_rows(100)), name="read", chunk_size=10)
    p.write(writer, source, name="write")
    p.run(context)

    assert chunks_taken == [10]
    assert writer.rows == 0
    assert "first chunk only" in report.step("read").note


def test_the_plan_names_the_streamed_source_and_its_chunk_size():
    p = Pipeline("big")
    p.read_chunks(ListChunkReader(_rows(10)), name="read", chunk_size=250)

    assert "[ReadChunks] read [chunk_size=250]" in p.describe()


def test_a_profile_step_runs_over_a_streamed_source():
    payloads = []

    class Profiler:
        def profile(self, dataset):
            payloads.append(len(dataset))
            return {"columns": [{"name": "id"}]}, []

    run_log = RecordingRunLog()
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(ListChunkReader(_rows(25)), name="read", chunk_size=10)
    p.profile(Profiler(), source)
    p.run()

    assert payloads == [10, 10, 5]
    [record] = run_log.records_for_step("profile")
    assert record["profile"] == {"columns": [{"name": "id"}]}


# --------------------------------------------------------------------------
# Data locations: reported per chunk, recorded once
# --------------------------------------------------------------------------


def test_a_streamed_read_records_one_location_however_many_chunks_it_took():
    location = {"namespace": "file", "name": "/d/big.csv"}
    run_log = RecordingRunLog()
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(
        ListChunkReader(_rows(25), location), name="read", chunk_size=10
    )
    p.write(CountingWriter(), source, name="write")
    p.run()

    [record] = run_log.records_for_step("read")
    assert record["data_locations"] == [location]


def test_a_write_under_a_streamed_source_records_its_target_once(tmp_path):
    db = tmp_path / "raw.db"
    context = RunContext(
        pipeline="big", logical_run_id="2026-07-27", load_date="2026-07-27"
    )
    run_log = RecordingRunLog()
    p = Pipeline("big", run_log=run_log)
    source = p.read_chunks(ListChunkReader(_rows(35)), name="read", chunk_size=10)
    writer = AccumulateByRun.from_context(context).writer_for(db, "feed")
    p.write(writer, source, name="write")
    p.run(context)

    [record] = run_log.records_for_step("write")
    assert record["data_locations"] == [
        {"namespace": f"sqlite:{db.as_posix()}", "name": "feed"}
    ]
