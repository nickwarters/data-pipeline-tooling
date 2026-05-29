# Core primitives & the medallion layers

This is the framework's foundational vocabulary. The walking skeleton (the CSV →
raw slice, #2) introduced `DataHandle`, `Reader`, `Store`, and the `Pipeline`
builder; slice #14 added the **`Writer`** port and reshaped the builder terminus
to `.write_to(writer).run()`. Every later slice builds on these shapes. For the
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
> (the seam that keeps `store` and `writers` cycle-free). Still ahead: silver/gold
> *processors* and validators on the `.run()` terminus.

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

### `Pipeline` — the deferred fluent builder
A `Pipeline` describes a feed's path and runs **nothing** until `.run()`
(ADR-0003):

```python
Pipeline("cases", CsvReader(path)).write_to(writer).run()
```

`.write_to(writer)` composes in the destination Writer (deferred). `.run()` is
the terminus: it reads the source, hands the bulk-tier `DataHandle` to the
Writer, and returns it. The builder makes **no** write decisions — no layer
logic, no refresh-vs-accumulate branching; that all lives on the Writer. Because
the terminus owns execution, it is the natural home for the cross-cutting
concerns added in later slices — validators, processors, timing, JSONL logging,
lineage, atomic fail-fast runs. (`.with_validator()` / `.with_processor()` /
`.checkpoint(writer)` arrive then.)

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
