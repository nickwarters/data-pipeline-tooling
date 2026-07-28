# Streaming a huge source: `read_chunks`, chunk filtering, and the run log

Some feeds are **far too big to read whole** — a SAS extract of 100M+ rows — yet
only a small, known subset is wanted (the <100K ids we already track). This guide
covers the seam built for that case: how to stream such a source **inside the
deferred [`Pipeline`](core-primitives.md#pipeline) DAG** with
`Pipeline.read_chunks(...)`, how to filter a stream down to the rows of interest
*before* anything accumulates, and which pairings the builder refuses at wiring
time because they cannot be made chunk-safe.

If your source fits in memory, you don't need any of this — use an ordinary
`Reader` and `Pipeline.read(...)`. Reach here only when a source can't be one
`Dataset`.

> **History.** Until wave 4 of the review remediation the `ChunkReader`
> family had **no** consumer in the DAG: `Pipeline.read()` took a `Reader` and
> called `.read()`, and the only chunk loop in the repository was the standalone
> `tools.observability.stream_step`. A feed that outgrew memory therefore lost
> validators, quarantine, dry run, profiling and per-step run addresses at
> exactly the moment the data got hard. `read_chunks` closes that gap;
> `stream_step` remains as the low-level primitive for a feed that wants no graph
> at all.

## The problem

`SasFileReader` / `ChunkedCsvReader` already **stream** a source as a lazy
sequence of bounded `Dataset`s (`chunks(size) -> Iterator[Dataset]`) and project
to the columns you need *per chunk*, so memory stays bounded. But without a row
filter, **every chunk still lands** — a 100M-row source adds ~500MB to the
database every run, the vast majority of it rows you never needed. Filtering
*after* a whole read is impossible: the 100M rows can never be materialised at
once. The predicate has to be **pushed down into the per-chunk loop**, beside
where column projection already happens.

## `Pipeline.read_chunks` — the DAG seam

```python
def read_chunks(
    self,
    chunk_reader: ChunkReader,
    *,
    name: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    depends_on: list[Node] | None = None,
) -> Node
```

It wires a node exactly as `read()` does. What differs is the *drive*: at
`.run()` the pipeline executes **the whole sub-graph below that node once per
chunk**, so a source of any size flows through the same transforms, validators,
quarantine partitioning, profiling and writes as a small one.

```python
from framework.core import StreamingUniqueValidator
from framework.io import AccumulateByRun, KeyFilterChunkReader, SasFileReader
from framework.run import Pipeline
from tools.medallion import medallion
from tools.store import StoreRegistry


def run(context, *, describe=False):
    med = medallion(StoreRegistry(context.base_dir), "big_feed")

    source = SasFileReader(extract_path, columns=["case_id", "status", "amount"])
    reader = KeyFilterChunkReader(source, "case_id", load_case_pool_ids(context))

    p = Pipeline("big_feed/ingest", run_log=context.run_log)
    rows = p.read_chunks(reader, name="read_source", chunk_size=50_000)
    checked = p.validate(StreamingUniqueValidator("case_id"), rows, name="unique")
    p.write(
        med.raw.writer("raw_big_feed", AccumulateByRun.from_context(context)),
        checked,
        name="land_raw",
    )
    if describe:
        return p.describe()
    return p.run(context)
```

Three properties make the repetition invisible from the outside.

**Only the sub-graph below the streamed source is re-driven.** A node normally
executes once per run and remembers its result; the nodes below the streamed
source forget that memo between chunks, and everything else keeps it. So a
whole-dataset input joined into the stream (a small reference table) is read
**once**, not once per chunk.

**Each step still records exactly once.** The per-chunk records are *folded*
into one record per step: row counts and duration are summed, warn hits and
errors concatenate (a warn raised on every chunk reads once), `committed` is true
if any chunk committed, and one failing chunk makes the step a failure. See
[the run-log section](#what-a-streamed-run-logs) below.

**Every Writer below the source spends the whole drive inside one
chunk-write session,** so many writes land as one logical load rather than as
fifty loads that overwrite each other. See
[the accumulating-load section](#writers-the-load-happens-once-not-once-per-chunk).

Memory stays bounded by one chunk: nothing in the driver holds a chunk once the
next one arrives, and only the summed counts survive the iteration.

## What the builder refuses, and when

Every refusal happens **when the graph is wired** — before a byte is read — and
raises `PipelineGraphError` naming the component and the reason. A multi-hour
read that discovers its sink was unusable is the failure mode these exist to
prevent.

| Wiring | Refused because |
| --- | --- |
| `write` / `quarantine` with a Writer that replaces its target (`Refresh` → `SqliteTruncateReloadWriter`, and every file Writer) | It writes each dataset as if it were the whole load, so each chunk would replace the one before it and the target would hold only the last. |
| `validate` with `UniqueValidator` or `VolumeAnomalyValidator` | The check needs the whole population. Handed one chunk it would answer about that chunk and report a pass the data never earned. |
| `explain` under a streamed source | The row trace keeps a verdict for **every** row it considers, so it would hold the whole source in memory — the one thing chunked reading exists to avoid. |
| A second `read_chunks` in one pipeline | The graph is driven once per chunk of *one* source; two streams have no defined interleaving. Land one and read it back. |

A Validator says it needs the whole dataset by carrying `whole_dataset = True`
(`framework.core.needs_whole_dataset` is the predicate). Absence means
chunk-safe, which is the common case: a per-row or per-column check (required
columns, value rules, a column-name diff) reaches the same verdict on a slice as
on the whole.

### Streaming forms of the whole-dataset checks

`StreamingUniqueValidator(columns, *, max_keys=None)` is the uniqueness check
that survives a chunk boundary: it carries the keys it has seen in a set, so a
key repeated in a later chunk is caught even though the two rows were never in
memory together. The set grows with the number of **distinct keys**, not with the
size of the source, so it is affordable exactly when the key space is the bounded
thing and the row space is not. `max_keys` makes that bound enforceable —
exceeding it raises rather than letting the guard quietly become the memory
problem it was meant to avoid.

A volume check has no streaming form and does not want one: run it against the
**landed** table in the following raw → silver pipeline, where the row count is a
cheap `SELECT` rather than a thing to hold in memory.

## Writers: the load happens once, not once per chunk

A Writer that can take a streamed source implements `writing_chunks()` — a
context manager yielding the Writer to use for the drive
(`framework.core.ChunkWritable`; `framework.io.writing_chunks` /
`supports_chunk_writes` are the helpers). Anything once-per-load happens when the
session opens.

| Writer / strategy | Under a chunked read |
| --- | --- |
| `AccumulateByRun` | The delete-by-`logical_run_id` that makes a re-drive idempotent runs **once, when the session opens**, and every chunk after it appends. A per-chunk delete would delete the chunks this same run had already landed. |
| `InsertOrIgnore`, `UpsertStrategy`, `InsertIfAbsent` | Taken unchanged — each write is already independent, so nothing has to happen once per load. |
| `QuarantineWriter` | The run's prior rejects are cleared with the **first** chunk that has any, then appended to. A run that rejects nothing writes and clears nothing, exactly as a whole-dataset quarantine of the same run does. |
| `Refresh` (`SqliteTruncateReloadWriter`), `CsvWriter` / `ExcelWriter` / `JsonWriter` | **Refused at wiring time.** They replace their target wholesale, and a file Writer additionally reads the whole existing file back — the opposite of bounded memory. |

Since #324 the session-open clear also **requires the target table to already
exist**, subject to the same require-declared-tables guard every other Writer
reads (`framework.io.writers.require_declared_tables_enabled`,
[ADR 0016](adr/0016-migrations-own-table-structure.md)): a missing table
raises `MissingTableError` before a single chunk is read, rather than lazily
on the first chunk's `write` — a stream that turns out to write zero chunks
would otherwise never touch the append Writer at all, and a missing table
should fail the session loudly. This does not change *when* or *how many*
transactions the session commits — only whether it may create the table it
is about to clear.

Because the clear is committed when the session opens and each chunk commits as
it lands, a stream that aborts part-way leaves that run **partially landed**.
That is safe precisely because `AccumulateByRun` is keyed by `logical_run_id`:
the next drive of the same logical run replaces it wholesale (see
[resolving-a-failed-run.md](resolving-a-failed-run.md)).

`RetryingWriter` composes with all of this: it forwards `writing_chunks()` to the
Writer it wraps and retries each chunk. It deliberately does **not** advertise a
session the wrapped Writer lacks, so wrapping a `Refresh` writer in retry does
not turn the wiring-time refusal into a run-time surprise.

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

## Retrying a stream

`RetryingChunkReader(inner, policy)` is the streaming counterpart of
`RetryingReader`. The streaming readers are the ones most exposed to transient
failure — they reach network shares and remote SAS extracts — and they were
previously the only readers retry could not cover, since a `ChunkReader` has no
`read()` to wrap.

**The semantics, chosen explicitly:** a failure is retried **only while the stream
has yielded nothing**, and the retry re-opens the source and iterates from the
beginning. Once a chunk has been handed downstream that is no longer safe — the
consumer has already written those rows, so restarting would land them twice —
and a `ChunkReader` cannot be resumed from where it broke, because nothing in the
contract says where that was. A mid-stream failure therefore propagates and the
run aborts, exactly as it does without retry.

That is not the weak half of the bargain it sounds like: opening the source is
where the transient failures this exists for actually happen — the share
unreachable, the extract not yet released, the handle refused. Resumability is a
property of a *source*, and a source that has one can offer it as its own reader.

Both retry decorators now delegate `describe()` through the component they wrap,
so `Pipeline.describe()` renders `Retrying(CsvReader(path='...'), attempts=3)`
instead of the bare string `RetryingReader`. Applying retry no longer costs the
plan the line saying where the data comes from.

## What a streamed run logs

The record schema is unchanged — a streamed read emits the **same fields in the
same order** as any other step ([run-log-format.md](run-log-format.md)); no field
was added for streaming. What differs is only what the numbers mean:

- **One record per step**, as for a one-shot read. The step name is whatever the
  author passed to `read_chunks(..., name=...)`, and `step_address` is the usual
  `<pipeline>.<step>` — freshness and dependency checks key on it unchanged.
- `rows_in` / `rows_out` / `rows_quarantined` / `rows_excluded` / `duration` are
  **summed across chunks**.
- For a filtering reader, the read step's `rows_in` is the **whole source
  scanned** and `rows_excluded` what the filter dropped — including a tail (or a
  whole source) the filter emptied, which yields no chunk at all yet was still
  read.
- `warn_hits` and `errors` concatenate, dropping a repeat, so a warn raised on
  every chunk appears once.
- `profile` is the payload of the last chunk profiled; a profile step under a
  stream describes a chunk, not the source.
- The `run` summary's `rows_in` is the whole source scanned and `rows_out` what
  the graph's leaves produced across the whole drive — not the size of whichever
  chunk happened to be last.

## Dry-running a stream

A dry run must not read a source it exists to avoid reading, so the drive
**stops after the first chunk**: one chunk shows the shape every later chunk has.
The read step's preview note says so (`preview of the first chunk only; the full
stream was not read`) rather than implying it saw the source. No chunk-write
session is opened at all under a dry run — opening one commits the load's
once-per-run work (clearing the run's prior rows), which is exactly the kind of
commit a preview promises not to make.

## `stream_step` — the low-level primitive

`tools.observability.stream_step` predates the DAG seam and remains for a feed
that wants no graph at all: it opens one `RunLog.step`, drains a `ChunkReader`
into a `Writer`, and records one JSONL record with `rows_in` / `rows_out` /
`rows_excluded`. It now opens the Writer's `writing_chunks()` session when the
Writer has one, so an `AccumulateByRun` sink under it accumulates the run's
chunks instead of each chunk deleting the last. A Writer with no session is
written to directly, as before.

**Prefer `read_chunks`.** `stream_step` fuses read → filter → write into one
opaque step; the DAG seam gives you the validators, quarantine, dry run,
profiling and per-step addresses that a feed at this size needs most.

## Feeding the rest of the pipeline

A streamed read is the `source → raw` (or `→ silver`) hop where the source is too
big. Once the bounded ~100K rows are landed, everything downstream (raw → silver
→ gold) is ordinary single-shot builder territory reading via `SqliteReader` —
including the whole-dataset checks (`UniqueValidator`, `VolumeAnomalyValidator`)
that the streamed hop had to refuse.

### Fail-fast comes for free

Nothing here catches anything. If a chunk write raises, or the reader raises (a
missing key column, a key-type error), the step records `status="error"` with the
message and the run aborts. The error record also shows the **partial progress**
(the counts summed up to the abort) before it stopped.

**Give expected failures a triage category.** A *raw* `ValueError` (e.g. the
reader's "key column not in chunk") has no `.category`, which the log reads as "a
genuine bug". A misconfigured key column is really a config error, so raise a
[`PipelineError`](core-primitives.md) subclass and the record carries
`"error_category":"config"`:

```python
from framework.core import PipelineError, ErrorCategory

class FeedConfigError(PipelineError):
    category = ErrorCategory.CONFIG

if "case_id" not in expected_columns:
    raise FeedConfigError("source is missing the case_id key column")
```

## See also

- [core-primitives.md](core-primitives.md#chunkreader--streaming-a-source-too-big-to-hold-whole) — the `ChunkReader` seam and the filter wrappers.
- [run-log-format.md](run-log-format.md) — the JSONL record schema and the run registry.
- [operator-cli.md](operator-cli.md) — running a `pipelines/<feed>/` module by location.
- [public-api.md](public-api.md) — the `framework.io` filter surface.
- [Python-only processing, dumb store, opaque Dataset carrier](adr/0002-python-processing-opaque-dataset-carrier.md) — the opaque carrier, and the amendment recording why streaming was needed after all.
