```python
"""Drive a streaming ``ChunkReader`` into a ``Writer`` under one run-log step.

The deferred :class:`~framework.run.builder.Pipeline` is single-shot: each read
node calls ``Reader.read()`` once and the builder passes whole ``Dataset``s
between nodes. A ``ChunkReader`` (``chunks(size) -> Iterator[Dataset]``) can't
wire into that graph — a source too big to hold whole is never one ``Dataset`` —
so streaming feeds run as a ``pipelines/<feed>/`` module with a ``run(context)``
callable that loops the chunks itself.

:func:`stream_step` is the one place that loop lives, so every streaming feed
gets identical **fail-fast** and **JSONL** behaviour without re-handwriting it:
it opens a single :meth:`RunLog.step`, drains the reader, writes each bounded
chunk as it streams (so memory and the landed table stay bounded), and records
one run-log record carrying ``rows_in`` / ``rows_out`` / ``rows_excluded``. When
the reader is a filtering wrapper (``KeyFilterChunkReader`` /
``PredicateChunkReader``), its ``rows_scanned`` / ``rows_kept`` counters surface
the filter's effect in that record; for a plain reader, scanned equals written
and nothing is reported excluded.

Fail-fast is inherited from :meth:`RunLog.step`: any exception raised while
streaming (a write failure, a key-type/column error from the reader) is recorded
with ``status="error"`` — and its triage category when it is a
``framework.core.PipelineError`` — then re-raised so the run aborts. Nothing is
swallowed.
"""

from __future__ import annotations

from dataclasses import dataclass

from framework.core.protocols import DEFAULT_CHUNK_SIZE, ChunkReader, Writer
from tools.observability.run_log import RunLog


@dataclass(frozen=True)
class StreamResult:
    """The tally of one :func:`stream_step` pass, returned for further use.

    ``rows_in`` is rows read from the source, ``rows_out`` rows written
    (kept), and ``rows_excluded`` the difference a row filter dropped (``0`` for
    a non-filtering reader). ``chunks`` is the number of bounded chunks written.
    """

    rows_in: int
    rows_out: int
    rows_excluded: int
    chunks: int


def stream_step(
    run_log: RunLog,
    *,
    run_id: str,
    pipeline: str,
    step: str,
    reader: ChunkReader,
    writer: Writer,
    size: int = DEFAULT_CHUNK_SIZE,
    committed: bool = True,
) -> StreamResult:
    """Stream ``reader`` into ``writer`` under one fail-fast run-log step.

    Opens one :meth:`RunLog.step` named ``step`` for ``pipeline`` / ``run_id``,
    then writes each bounded chunk ``reader.chunks(size)`` yields. Because each
    chunk lands as it streams, memory stays bounded by a single chunk and the
    write is *incrementally committed* — hence ``committed`` defaults to ``True``
    (recorded only on the success path; a mid-stream failure records
    ``committed=False``, and the rows already landed are reconciled by the
    writer's per-run load strategy on the next drive).

    Returns a :class:`StreamResult`; the per-step JSONL record is emitted as a
    side effect when the step closes. Any exception propagates after being
    recorded as an ``error`` record — the caller's run aborts (fail-fast).
    """
    written = 0
    chunks = 0
    with run_log.step(run_id, pipeline, step, committed=committed) as metrics:
        metrics.rows_out = 0
        for chunk in reader.chunks(size):
            writer.write(chunk)
            written += len(chunk)
            chunks += 1
            # Update per iteration so a mid-stream failure's error record still
            # shows how far the run got before it aborted.
            metrics.rows_out = written
            _record_scan(metrics, reader, written)
        # Finalise after the stream drains — covers the all-filtered case where
        # the loop body never ran yet the reader still scanned the whole source.
        scanned = _record_scan(metrics, reader, written)
    excluded = scanned - written
    return StreamResult(
        rows_in=scanned, rows_out=written, rows_excluded=excluded, chunks=chunks
    )


def _record_scan(metrics, reader: ChunkReader, written: int) -> int:
    """Reflect the reader's scanned/excluded counts onto the open step metrics.

    A filtering reader exposes ``rows_scanned``; a plain one does not, in which
    case scanned equals what was written and nothing was excluded. Returns the
    scanned count so the caller can finalise the result.
    """
    scanned = getattr(reader, "rows_scanned", None)
    if scanned is None:
        scanned = written
    else:
        metrics.rows_excluded = scanned - written
    metrics.rows_in = scanned
    return scanned

```
