# Core primitives & the medallion layers

This is the framework's foundational vocabulary. The walking skeleton (the CSV →
raw slice, #2) introduced `DataHandle`, `Reader`, `Store`, and the `Pipeline`
builder; slice #14 added the **`Writer`** port and reshaped the builder terminus
to `.write_to(writer).run()`; slice #3 added the **`Validator`** port and made
`.run()` fail-fast and atomic; slice #4 added the **`RunLog`** primitive and
wired structured JSONL observability into the terminus. Every later slice builds
on these shapes. For the
*why* behind each, see the ADRs referenced inline; for domain language (Case,
CasePool, Feed, Reference Data, …) see [`../CONTEXT.md`](../CONTEXT.md).

## Medallion layers

A medallion is three SQLite databases, one per layer (raw, silver, gold), on a
network share: **raw → silver → gold**. Each **subject** — a Case Type or a
shared Reference Data set — owns its **own** medallion, isolated from every
other subject's files (ADR-0001 amendment: blast-radius isolation, independent
onboarding). A Feed is ingested and refined upward; the Selection pipeline reads
the ingested silver/gold and writes the SelectionPool back into gold. (The layer
names are placeholders pending a domain rename — see CONTEXT.)

| Layer  | Holds                                  | Load behaviour |
|--------|----------------------------------------|----------------|
| **raw** | A faithful, schema-light snapshot of the source as landed — the framework's landing zone. | **Full refresh** each run: truncate + reload from the source snapshot, so re-runs are deterministic (ADR-0006). |
| silver | Validated, normalised data. *(later slice)* | Full refresh from raw. |
| gold   | Refined ingest outputs **and** the accumulating SelectionPool / Review Outcomes. *(later slice)* | Accumulates, stamped `run_id` / `load_date`; idempotent re-run via delete-by-run then insert (ADR-0006). |

raw stays schema-light on purpose: it mirrors the source so the landing zone is
faithful, and schema enforcement arrives at silver and gold (ADR-0008).

> **Build status.** The **per-subject `Store`** has landed: `Store(subject_dir)`
> *mints* that subject's layer-appropriate Writers/Readers over its own
> `<subject_dir>/{raw,silver,gold}.db`, and the legacy global `Store.write`/`read`
> is retired. The shared `connect` factory now lives in `framework.connection`
> (the seam that keeps `store` and `writers` cycle-free). **Validators** now
> attach to the builder (`.with_validator()` / `.with_post_validator()`) and
> `.run()` is fail-fast and atomic. **Structured JSONL observability** has
> landed: a `RunLog` composed onto the builder emits one JSON record per step
> plus a run summary to a `.log` file (and human-readable lines to the console)
> — the seam the future run-registry ingests (ADR-0007;
> [format doc](run-log-format.md)). Still ahead: silver/gold *processors*, the
> `SchemaValidator` derived from a Case Type's dataclass (ADR-0008), and the
> run-registry that ingests the JSONL (ADR-0005).

## The primitives

### `DataHandle` — the opaque tabular carrier
The bulk tier of the two-tier data carrier (ADR-0002). It wraps the concrete
in-memory engine (**pandas today, swappable to e.g. polars later**) so that
engine never leaks into the rest of the system. The public surface is
deliberately tiny:

- `handle.columns -> list[str]`
- `len(handle) -> int`

Only engine-confined code (readers, writers, the store, processors) crosses the
seam via `DataHandle.from_pandas(frame)` / `handle.to_pandas()`. **pandas must
never appear** in a Protocol signature, a pipeline script, or the domain layer —
only behind this seam. Typed domain objects (`Case`, `ReviewOutcome`) are the
*other* tier, materialised on demand at the domain edge (later slice).

### `Reader` — source IO behind one method
A `Reader` encapsulates how one source type is read:

```python
class Reader(Protocol):
    def read(self) -> DataHandle: ...
```

`CsvReader(path)` reads a source feed; `SqliteReader(db_path, table)` is the
read-side dual of the Sqlite Writers — it reads one table from a layer db back
into a `DataHandle` (a subject's own layer, or another subject's read-only
Reference Data medallion, joined in Python — ADR-0002). `Excel`/`Sas`/
`SharePoint` follow the same shape (ADR-0004, ADR-0005). Readers are the home of
the concrete engine and are tested against **local fixture files** — no network,
no SAS, no SharePoint. Paths are handled with `pathlib` so they behave
identically on Windows and macOS.

### `Writer` — the destination, behind one method
A `Writer` is the component-role **dual of `Reader`**: a Reader brings data in,
a Writer takes it out (ADR-0003 amendment).

```python
class Writer(Protocol):
    def write(self, handle: DataHandle) -> None: ...
```

A Writer owns **both** its target location (a layer db file + table) **and** its
load strategy (ADR-0006). Swapping the Writer is how you target a different
database — the builder never learns about medallion layers or load rules. Two
concrete writers ship now:

- `SqliteTruncateReloadWriter(db_path, table)` — **full refresh** (truncate +
  reload). Used for raw/silver, which mirror a current-state source snapshot.
- `AccumulateByRunWriter(db_path, table, run_id, load_date)` — **accumulate by
  run** for gold: stamps each row `run_id` / `load_date` and makes a re-driven
  run idempotent via *delete-by-run then insert* (a stub for the gold layer).

### `Store` — one subject's medallion, minting its Writers/Readers
`Store(subject_dir, busy_timeout_ms=5000)` is the mouth of **one subject's**
medallion (a Case Type or a Reference Data set — ADR-0001 amendment): its three
files `<subject_dir>/{raw,silver,gold}.db`, isolated from every other subject's.
It holds **no business logic** (ADR-0002) and makes **no** load decision
(ADR-0003 amendment) — it merely mints the layer-appropriate component:

- `store.writer(layer, table)` — raw/silver get a `SqliteTruncateReloadWriter`
  (full refresh); gold gets an `AccumulateByRunWriter` and so requires
  `run_id` / `load_date` (stamped per the run that mints it).
- `store.reader(layer, table)` — a `SqliteReader` over the same file.

The strategy lives on the Writer the store mints, not on the store. A new
subject's directory is created on first write, so onboarding migrates nothing.

The connection factory `connect(db_path, busy_timeout_ms)` lives in
`framework.connection` — the single place connections are configured (ADR-0001),
which Readers, Writers, and the Store all open through. Keeping it in its own
module is the seam that lets the `Store` mint Writers/Readers without a
`store`↔`writers` import cycle. It sets a `busy_timeout` so read-only clients
ride out the single writer's in-place commits instead of erroring, and stays on
the default rollback journal because **WAL is unavailable over a network
share**.

### `Validator` — a fail-fast check at a layer boundary
A `Validator` states an expectation about a feed's data and **raises**
`ValidationError` when the data breaks it:

```python
class Validator(Protocol):
    def validate(self, handle: DataHandle) -> None: ...   # raises on failure
```

Two ship now, both reading only the handle's public shape (so they stay behind
the DataHandle seam — ADR-0002):

- `ColumnValidator(required_columns)` — every required column is present
  (presence, not dtype).
- `RowCountValidator(minimum=…, maximum=…)` — row count within an inclusive
  `[min, max]`; either bound is optional (`None` leaves that side open).

A Validator knows only how to *check*; it does **not** decide what a failure
means. **Severity is set where the Validator is attached to the builder**
(`severity="error" | "warn"`, default `error` — ADR-0007), so the same Validator
can abort one pipeline and merely warn another. The richer `SchemaValidator`
derived from a Case Type's dataclass (ADR-0008) will be a later Validator of this
same shape, attached as a silver/gold post-validator.

### `RunLog` — structured JSONL run observability
A `RunLog` is the observability seam (ADR-0007). Composed onto the builder
(`Pipeline(name, reader, run_log=RunLog(path))`), it emits **one JSON object per
line** to a `.log` file — and a human-readable line per record to the console —
for each step of a run plus a final `run` summary:

```python
class RunLog:
    def record(self, run_id, pipeline, step, status, *,
               rows_in=None, rows_out=None, duration=None,
               errors=None, warn_hits=None) -> None: ...
    def step(self, run_id, pipeline, step, rows_in=None): ...  # times a block
```

Every record of a single run carries the same `run_id` (minted by `.run()`,
exposed as `pipeline.run_id`), so the deferred run-registry (ADR-0005) can group
a run without parsing free text. The builder owns no path or format knowledge —
it just drives the sink; when no `RunLog` is composed a null sink keeps `.run()`
branch-free while emitting nothing. The full record schema, the per-step
breakdown, and the fail-fast/warn examples live in
[`run-log-format.md`](run-log-format.md).

### `Pipeline` — the deferred fluent builder
A `Pipeline` describes a feed's path and runs **nothing** until `.run()`
(ADR-0003):

```python
(
    Pipeline("cases", CsvReader(path))
    .with_validator(ColumnValidator(["case_ref"]))        # pre: gate the input
    .with_post_validator(RowCountValidator(minimum=1))     # post: gate the output
    .write_to(writer)
    .run()
)
```

`.with_validator(v, severity="error")` attaches a **pre**-validator (checks the
input); `.with_post_validator(v, severity="error")` attaches a **post**-validator
(checks the output that is about to be written). `.write_to(writer)` composes in
the destination Writer. All deferred — nothing runs until `.run()`.

`.run()` is the terminus and is **fail-fast and atomic** (ADR-0007): it reads the
source, runs the pre-validators, (processors transform the handle here in a later
slice), runs the post-validators, then hands the bulk-tier `DataHandle` to the
Writer and returns it.

- An **error**-severity failure aborts the run by raising `ValidationError`
  *before* the Writer is ever called — so a bad dataset never reaches the layer
  and **nothing partial lands**. (The write itself is also a single SQLite
  transaction owned by the Writer, so gold's delete-by-run + insert is
  all-or-nothing even on a mid-write error.)
- A **warn**-severity failure logs a warning naming the problem and the run
  continues — the explicit, deliberate escape hatch for known-tolerable
  conditions.

The builder still makes **no** write decisions — no layer logic, no
refresh-vs-accumulate branching; that all lives on the Writer. Because the
terminus owns execution, it is the home of the cross-cutting concerns: it now
mints the run's `run_id`, times each step, and drives the composed `RunLog`
(timing + structured JSONL logging — landed in #4). Processors and lineage
remain ahead (`.with_processor()` / `.checkpoint(writer)` arrive then).

## Worked example

```python
from framework.builder import Pipeline
from framework.readers import CsvReader
from framework.store import Store

# The "cases" subject's medallion mints the raw Writer over its own raw.db.
store = Store("/path/to/share/cases")
landed = (
    Pipeline("cases", CsvReader("feed.csv"))
    .write_to(store.writer("raw", "cases"))
    .run()
)
print(len(landed), landed.columns)
```

See [`../pipelines/demo_csv_to_raw.py`](../pipelines/demo_csv_to_raw.py) for the
runnable demo.
