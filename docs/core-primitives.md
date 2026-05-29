# Core primitives & the medallion layers

This is the framework's foundational vocabulary, introduced by the walking
skeleton (the CSV → raw slice). Every later slice builds on these four shapes.
For the *why* behind each, see the ADRs referenced inline; for domain language
(Case, CasePool, Feed, …) see [`../CONTEXT.md`](../CONTEXT.md).

## Medallion layers

The store is three SQLite databases, one per layer, on a network share:
**raw → silver → gold**. A Feed is ingested and refined upward; the Selection
pipeline reads the ingested silver/gold and writes the SelectionPool back into
gold. (The names are placeholders pending a domain rename — see CONTEXT.)

| Layer  | Holds                                  | Load behaviour |
|--------|----------------------------------------|----------------|
| **raw** | A faithful, schema-light snapshot of the source as landed — the framework's landing zone. | **Full refresh** each run: truncate + reload from the source snapshot, so re-runs are deterministic (ADR-0006). |
| silver | Validated, normalised data. *(later slice)* | Full refresh from raw. |
| gold   | Refined ingest outputs **and** the accumulating SelectionPool / Review Outcomes. *(later slice)* | Accumulates, stamped `run_id` / `load_date`; idempotent re-run via delete-by-run then insert (ADR-0006). |

**This slice implements `raw` only.** raw stays schema-light on purpose: it
mirrors the source so the landing zone is faithful, and schema enforcement
arrives at silver and gold (ADR-0008).

## The four primitives

### `DataHandle` — the opaque tabular carrier
The bulk tier of the two-tier data carrier (ADR-0002). It wraps the concrete
in-memory engine (**pandas today, swappable to e.g. polars later**) so that
engine never leaks into the rest of the system. The public surface is
deliberately tiny:

- `handle.columns -> list[str]`
- `len(handle) -> int`

Only engine-confined code (readers, the store, processors) crosses the seam via
`DataHandle.from_pandas(frame)` / `handle.to_pandas()`. **pandas must never
appear** in a Protocol signature, a pipeline script, or the domain layer — only
behind this seam. Typed domain objects (`Case`, `ReviewOutcome`) are the *other*
tier, materialised on demand at the domain edge (later slice).

### `Reader` — source IO behind one method
A `Reader` encapsulates how one source type is read:

```python
class Reader(Protocol):
    def read(self) -> DataHandle: ...
```

`CsvReader(path)` is the first concrete reader; `Excel`/`Sqlite`/`Sas`/
`SharePoint` follow the same shape (ADR-0004, ADR-0005). Readers are the home of
the concrete engine and are tested against **local fixture files** — no network,
no SAS, no SharePoint. Paths are handled with `pathlib` so they behave
identically on Windows and macOS.

### `Store` — the dumb medallion store + connection factory
`Store(base_dir, busy_timeout_ms=5000)` maps each layer to `<base_dir>/<layer>.db`
and is the single place connections are made (ADR-0001):

- `store.write(layer, table, handle)` — raw writes are truncate + reload.
- `store.read(layer, table) -> DataHandle` — read a table back.

The store holds **no business logic** (no business-rule SQL); it only persists
and returns handles (ADR-0002). The connection factory sets a `busy_timeout` so
read-only clients ride out the single writer's in-place commits instead of
erroring, and stays on the default rollback journal because **WAL is
unavailable over a network share** (ADR-0001).

### `Pipeline` — the deferred fluent builder
A `Pipeline` describes a feed's path through **one layer transition** and runs
**nothing** until a terminus (ADR-0003):

```python
Pipeline("cases", CsvReader(path), store).to("raw")
```

Composing the builder is side-effect-free; `.to(layer)` is what reads the source
and lands it, returning the bulk-tier `DataHandle`. Because the terminus owns
execution, it is the natural home for the cross-cutting concerns added in later
slices — validators, processors, timing, JSONL logging, lineage, atomic
fail-fast runs. (`.with_validator()` / `.with_processor()` / `.run()` /
`.checkpoint(layer)` arrive then.)

## Worked example

```python
from framework.builder import Pipeline
from framework.readers import CsvReader
from framework.store import Store

store = Store("/path/to/share")
landed = Pipeline("cases", CsvReader("feed.csv"), store).to("raw")
print(len(landed), landed.columns)
```

See [`../pipelines/demo_csv_to_raw.py`](../pipelines/demo_csv_to_raw.py) for the
runnable demo.
