# Streaming a huge source: chunk filtering, the run log, and fail-fast

Some feeds are **far too big to read whole** — a SAS extract of 100M+ rows — yet
only a small, known subset is wanted (the <100K ids we already track). This guide
covers the seam built for that case (#287): how to filter a stream down to the
rows of interest *before* anything accumulates, why it runs as a streaming
pipeline module rather than a deferred DAG node, and how to keep the same
**fail-fast + JSONL run-log** guarantees the deferred builder gives you.

If your source fits in memory, you don't need any of this — use an ordinary
`Reader` and the deferred [`Pipeline`](core-primitives.md#pipeline) builder. Reach
here only when a source can't be one `Dataset`.

## The problem

`SasFileReader` / `ChunkedCsvReader` already **stream** a source as a lazy
sequence of bounded `Dataset`s (`chunks(size) -> Iterator[Dataset]`) and project
to the columns you need *per chunk*, so memory stays bounded. But without a row
filter, **every chunk still lands** — a 100M-row source adds ~500MB to the
database every run, the vast majority of it rows you never needed. Filtering
*after* a whole read is impossible: the 100M rows can never be materialised at
once. The predicate has to be **pushed down into the per-chunk loop**, beside
where column projection already happens.

## The two filter seams

Both wrap *any* `ChunkReader` (`ChunkedCsvReader`, `SasFileReader`, a future one)
and are themselves `ChunkReader`s, so they compose and keep the readers
single-purpose. Because the filter runs **per chunk, before concatenation**, a
100M-row source with a 100K allow-list lands ~100K rows with memory bounded by a
single chunk.

### `KeyFilterChunkReader` — id allow-list (semi-join)

The headline case: keep only rows whose key is in a known set of ids-of-interest.

```python
from framework.io import SasFileReader, KeyFilterChunkReader

ids_of_interest = load_case_ids()        # bounded ~100K; a plain in-memory set

source = SasFileReader("extract.sas7bdat.gz", columns=["case_id", "status", "amount"])
reader = KeyFilterChunkReader(source, key_column="case_id", allowed_keys=ids_of_interest)

for chunk in reader.chunks(size=50_000):
    write_to_silver(chunk)               # ~100K rows land, not 100M

print(reader.rows_scanned, reader.rows_kept)   # e.g. 104_000_000  87_431
```

**Type alignment is handled, not silently dropped.** The same logical id arrives
as different Python types per source — a SAS numeric id streams in as a float
(`3.0`) while the allow-list holds an `int` (`3`); a SAS character id streams in
as space-padded `bytes` (`b'A   '`) while the allow-list holds a `str` (`"A"`).
Both sides are normalised before the membership test, so `3.0` matches `3` and
`b'A  '` matches `"A"` rather than a float-vs-int / bytes-vs-str mismatch
dropping every row. A missing key (`None`/`NaN`) never matches.

**Growth is bounded.** The allow-list may grow run-over-run, but it stays an
in-memory set capped at ~100K — pass the current set in at construction each run;
a wider set simply keeps the newly-tracked ids too.

### `PredicateChunkReader` — any per-chunk filter

The general form `KeyFilterChunkReader` is built on: apply any `ChunkFilter`
(`Callable[[Dataset], Dataset]`) per chunk — a value threshold, a date window, a
multi-column rule.

```python
from framework.io import ChunkedCsvReader, PredicateChunkReader
from framework.core import Dataset

def keep_large_orders(chunk: Dataset) -> Dataset:
    frame = chunk.to_pandas()
    return Dataset.from_pandas(frame[frame["total"] > 1000])

reader = PredicateChunkReader(ChunkedCsvReader("orders.csv"), keep_large_orders)
```

A chunk the filter empties yields **nothing** (consistent with the underlying
readers' zero-row-chunk skip), and both wrappers expose `rows_scanned` /
`rows_kept` for the most recent `chunks()` pass.

## Why this is a streaming module, not a deferred DAG node

The deferred [`Pipeline`](core-primitives.md#pipeline) builder is **single-shot
by construction**: a read node calls `Reader.read()` exactly once and gets one
whole `Dataset`, and the builder only knows `Reader` / `Processor` / `Validator`
/ `Writer` — *not* `ChunkReader`. There is no `chunks()` anywhere in it. A source
too big to be one `Dataset` therefore can't be a `read()` node at all, filtered
or not. That's not a limitation of the filter — *any* `ChunkReader` lives beside
the deferred graph, by design.

> Note the allow-list itself is **not** the reason. Passing `allowed_keys` at
> construction is ordinary config injection — the same as handing a `CsvReader` a
> path. The one genuine wrinkle is that the allow-list is *data sourced from
> elsewhere* (the CasePool), so in a pure DAG you'd want it as an upstream side
> input; today you resolve it eagerly in Python. The framework already has a
> concept for that shape — [`JoinDependency`](processors.md), the lazy external
> read-only side input — and sourcing the allow-list that way is a natural future
> improvement.

So a streaming feed is a `pipelines/<feed>/` module with a `run(context)`
callable (driven by `python -m cli run pipelines/<feed>`, see
[operator-cli.md](operator-cli.md)) that loops the chunks itself. It is still a
**first-class pipeline** — outside the node-graph *builder*, inside the
pipeline-module + operator-CLI convention.

And it **feeds an ordinary pipeline**: the streaming filter is just the
`source → raw` (or `→ silver`) hop where the source is too big. Once the bounded
~100K rows are landed, everything downstream (raw → silver → gold) is normal
deferred-builder territory reading via `SqliteReader`.

## Recording it: `stream_step` (fail-fast + JSONL)

The deferred builder's `.run()` wraps each node in `RunLog.step(...)` to get
[fail-fast and JSONL observability](run-log-format.md). A streaming module drives
the same `RunLog` itself — `tools.observability.stream_step` is the one place that
loop lives, so every streaming feed gets identical behaviour without
re-handwriting it. It opens **one** run-log step, drains the reader, writes each
bounded chunk as it streams, and records one JSONL record carrying
`rows_in` / `rows_out` / `rows_excluded` (the JSONL schema already has a
`rows_excluded` field — the filter slots in with no schema change).

```python
# pipelines/big_sas_feed/pipeline.py
from framework.io import SasFileReader, KeyFilterChunkReader, AccumulateByRun
from tools.medallion import medallion
from tools.store import StoreRegistry
from tools.observability.stream import stream_step

def run(context, *, describe=False):
    med = medallion(StoreRegistry(context.base_dir), "big_feed")

    case_ids = load_case_pool_ids(context)            # the bounded allow-list
    source = SasFileReader(extract_path, columns=["case_id", "status", "amount"])
    reader = KeyFilterChunkReader(source, "case_id", case_ids)
    writer = med.raw.writer("raw_big_feed", AccumulateByRun.from_context(context))

    result = stream_step(
        context.run_log,                              # NULL_RUN_LOG if none composed
        run_id=context.run_id,
        pipeline=context.label,
        step="ingest_big_feed",
        reader=reader,
        writer=writer,
        size=50_000,
    )
    return result                                     # StreamResult(rows_in/out/excluded, chunks)
```

That emits one line like:

```json
{"run_id":"a1b2…","pipeline":"big_feed/ingest","step":"ingest_big_feed",
 "status":"ok","rows_in":104000000,"rows_out":87431,"rows_excluded":103912569,
 "duration":812.4,"committed":true,"errors":[],"error_category":null}
```

and the console echo:

```
big_feed/ingest ingest_big_feed: ok rows_in=104000000 rows_out=87431 excluded=103912569 812.4s committed [run a1b2…]
```

Because read → filter → write are fused in a streaming loop, it is honestly *one*
step (you can't cleanly separate "read" from "write" without buffering the whole
source — the very thing you can't do). The filter's effect stays visible *within*
that record via `rows_excluded`.

### Fail-fast comes for free

`stream_step` doesn't catch anything — it lets `RunLog.step` do its job. If any
chunk write raises, or the reader raises (a missing key column, a key-type
error), the step records `status="error"` with the message and re-raises, so the
run aborts. Nothing is swallowed. The error record also shows the **partial
progress** (`rows_out` so far) before the abort.

**Give expected failures a triage category.** On the error path the log records
`error_category` from the exception's `.category` — and a *raw* `ValueError`
(e.g. the reader's "key column not in chunk") has none, which the log reads as
"a genuine bug". A misconfigured key column is really a config error, so raise a
[`PipelineError`](core-primitives.md) subclass instead of letting a bare
`ValueError` escape, and the record carries `"error_category":"config"`:

```python
from framework.core import PipelineError, ErrorCategory

class FeedConfigError(PipelineError):
    category = ErrorCategory.CONFIG

if "case_id" not in expected_columns:
    raise FeedConfigError("source is missing the case_id key column")
```

### `committed` and partial writes

`stream_step` passes `committed=True`, recorded only on the **success** path: a
streaming write commits incrementally, so a completed step durably landed its
rows. A mid-stream failure records `committed=False` even though earlier chunks
are already on disk — the per-step boolean can't express "partially committed".
That partial write is safe because `AccumulateByRun` is keyed by
`run_id`/`load_date`: a re-drive **replaces** that run's rows (see
[gold-accumulation.md](gold-accumulation.md) and
[resolving-a-failed-run.md](resolving-a-failed-run.md)), overwriting the aborted
run's partial landing cleanly. If a multi-hour stream needs progress visibility,
emit lightweight per-N-chunks records via `RunLog.record(...)` directly under a
`"<step>.progress"` name — but keep the `stream_step` record as the single source
of truth; don't log every chunk.

## See also

- [core-primitives.md](core-primitives.md#chunkreader--streaming-a-source-too-big-to-hold-whole) — the `ChunkReader` seam and the filter wrappers.
- [run-log-format.md](run-log-format.md) — the JSONL record schema and the run registry.
- [operator-cli.md](operator-cli.md) — running a `pipelines/<feed>/` module by location.
- [public-api.md](public-api.md) — the `framework.io` filter surface.
