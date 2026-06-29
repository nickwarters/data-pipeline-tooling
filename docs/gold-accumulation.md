# Gold accumulation & what "gold" means

This documents the **gold** layer's load semantics — the `AccumulateByRun`
strategy: rows stamped `run_id` / `load_date`, accumulating across runs, with an
idempotent re-run via *delete-by-run then insert*. For the
*why*, see [ADR-0004](adr/0004-per-feed-load-strategy-owned-by-writer.md);
for the surrounding primitives, [core-primitives.md](core-primitives.md); for the
domain terms (CasePool, SelectionPool, Review Outcomes), [`../CONTEXT.md`](../CONTEXT.md).

## Gold appears in every Pipeline — the framework is reused

Gold is the **accumulating** layer of a medallion. Where raw and silver mirror a
*current-state snapshot* and are full-refreshed each run, gold is the layer whose
**history must survive across runs**.

The medallion (`raw → silver → gold`) is reused by every **Pipeline** — the four
end-to-end phases of the platform, each running its own store(s) through the same
primitives (CONTEXT.md). What gold *holds* depends on the Pipeline:

| Pipeline | Scope | What its gold accumulates |
|----------|-------|---------------------------|
| **Ingest** | per Case Type | A Case Type's Feeds refined to gold; the **CasePool** reads this ingested silver/gold. |
| **Selection** | per Case Type | The chosen Cases — the **SelectionPool** — written into gold and emitted as a Deliverable to the platform. |
| **Sync** | platform-wide | The review platform synced into its **own** store; the **Review Outcomes** live here, the full picture of each case *as the platform sees it*. An outcome can change between runs (see below). |
| **Reporting** | platform-wide | Its own `raw → silver → gold` building cross-Pipeline views (Outcomes joined to selected Cases), shaped into Deliverables (CSV / Excel / JSON, or views read in place). |

So `CasePool` and `SelectionPool` belong to the **Ingest** and **Selection**
Pipelines only; **Review Outcomes** belong to the **Sync** store, *not* to
selection gold. The mutable-record behaviour below is most visible in **Sync**,
where an outcome genuinely changes between runs.

## Load behaviour: accumulate, stamped by run

Every gold row is stamped with two columns:

| Column | Meaning |
|--------|---------|
| `run_id` | The **logical load** this row belongs to — a stable, caller-chosen key (e.g. a business date). It is the **idempotency key**. |
| `load_date` | The date this load represents, carried as a plain column for reporting/lineage. |

A run **accumulates**: a later run adds its rows alongside earlier runs' rather
than replacing them, so history is kept.

### Idempotent re-run: delete-by-run then insert

Re-driving the *same* `run_id` must not duplicate that run's rows, yet must not
touch any *other* run's rows. The writer achieves this by scoping a delete to the
run before appending:

```sql
DELETE FROM <table> WHERE run_id = :run_id;   -- clear only this run's prior rows
INSERT INTO <table> ...                        -- then re-insert this run
```

Both statements commit as a **single SQLite transaction** (ADR-0005): if the
insert fails, the delete rolls back, so a failed re-run never half-wipes prior
rows. The result: re-running a given load is safe and deterministic, while the
historical record of prior loads is preserved.

## `run_id` is *not* the run-log's execution id

The run-log (ADR-0005) mints a **fresh uuid `run_id` per `.run()`** to correlate
every record of one execution. Gold's `run_id` is a **different thing** — a
stable, logical load key — and the two are **deliberately not unified**:

- **Log `run_id`** = *this execution* — fresh uuid each `.run()`.
- **Gold `run_id`** = *this logical load* — caller-chosen, the delete-by-run
  idempotency key.

Stamping gold rows with a fresh-per-execution uuid would break idempotency: a
re-run would never match prior rows and would silently duplicate history. So the
`AccumulateByRun` strategy takes `run_id` / `load_date` as **caller-supplied**
values — `AccumulateByRun.from_context(context)` derives them from the shared
`RunContext` so `--logical-run-id` flows straight through. The two are *linked*
without being unified: an accumulated row also carries `execution_id` (the run
log's per-execution `run_id`), so an operator can correlate a logical load's rows
back to the exact execution that wrote them via the `RunRegistry` (ADR-0004).

## How a changing record is represented across runs

The delete-by-run is scoped to `run_id` **only** — never to a business key like
`case_ref` (`framework/io/writers.py`). So gold **never updates a record in place**:
a record that changes between runs produces *one row per run that observed it*,
each stamped with that run's `run_id` / `load_date`. The version axis of a record
is `(case_ref, load_date)`; `run_id` is the *load* identity, not a per-row
version key.

**Worked example — an outcome that changes (most visible in the Sync Pipeline).**
Because raw/silver mirror the current-state source, each run's silver holds the
record's *current* value, and gold accumulates it:

| Run (`run_id`) | source/silver held | gold after the run |
|----------------|--------------------|--------------------|
| `2026-05-30` | C1 = **Pass** | `(C1, Pass, run_id=2026-05-30, load_date=2026-05-30)` |
| `2026-05-31` | C1 = **Fail** (reviewer changed it) | adds `(C1, Fail, run_id=2026-05-31, load_date=2026-05-31)` — the `2026-05-30` row **stays** |

Gold keeps **both** rows. The change is preserved as history; nothing is mutated.

### Reading the "current" value

The always-correct query is *"the row with the greatest `load_date` for each
`case_ref`"*. Two shapes, depending on what a run writes:

- **Full-snapshot runs** (e.g. Sync re-syncing every case each day): the latest
  `run_id` is itself a complete current-state set, so `WHERE run_id = <latest>`
  is a valid fast path. In a daily load you would choose `run_id = the business
  date`, so `run_id`, `load_date`, and "the day" coincide.
- **Subset runs** (e.g. Selection writing only the chosen Cases): the latest
  `run_id` does **not** contain every record, so you must take `max(load_date)`
  per `case_ref` — latest-run alone would miss records last written by an earlier
  run.

Per ADR-0002 this "latest per record" logic lives in **Python** (e.g. on the
CasePool's `fetch_*` retrievals), never in the Writer — the Writer stays a dumb
stamp-and-append. A record that disappears from the source simply stops appearing
in new runs: the current view (max `load_date`) drops it, while its historical
rows remain.

### Two shapes of accumulation, and their costs

`run_id`-stamped accumulation supports two patterns; choose deliberately per Pipeline:

- **Periodic snapshot** — every run re-writes the full set (Sync, ingest). Simple
  and self-correcting, but **unchanged records are re-copied every run**: 10k
  stable records × 100 daily runs ≈ 1M rows, mostly identical. ADR-0004 bounds
  this at ~1M rows; beyond that, change-detection or retention becomes a real
  decision. There is no built-in "is-current" flag — consumers derive it.
- **Event / decision log** — each run appends only new facts (selections made,
  outcomes received) that never restate prior rows. This is what ADR-0004
  originally framed gold around; it grows with events, not with records × runs.

In both, `run_id` is the **unit of replacement**: you can re-drive a whole load
idempotently, but you cannot "correct one record" via delete-by-run — you re-run
the load that produced it.

## Reading gold concurrently

Gold is the one layer that is *both* written by a pipeline and read by others
(the Selection pipeline reads ingested gold). Reads open through the shared
`connect` factory with a `busy_timeout` (ADR-0001), so a read-only client **rides
out** the single writer's in-place commit instead of erroring — it waits for the
lock rather than failing fast. (WAL is unavailable over a network share, so this
is on the default rollback journal.)

## Building a gold hop — compose the write with a strategy

There is no recipe builder for gold; a gold hop is an explicit `Pipeline` whose
**Writer carries the load strategy** that decides the shape. To *accumulate*
validated silver into gold stamped by run, compose an `AccumulateByRun` writer:

```python
from framework.io import AccumulateByRun
from tools.store import StoreRegistry
from framework.run import Pipeline
from tools.medallion import medallion

med = medallion(StoreRegistry("/path/to/share"), "cases")

p = Pipeline("selection_pool")
silver = p.read(med.silver.reader("selection_pool"), name="read")
p.write(
    med.gold.writer("selection_pool", AccumulateByRun.from_context(context)),
    silver,
    name="write",
)
p.run()
```

The `Store` mints the `AccumulateByRunWriter`, which owns the location and the
delete-by-run/insert accumulate behaviour (ADR-0003, ADR-0004); the pipeline makes
no load decision of its own. `AccumulateByRun.from_context(context)` derives the
logical `run_id` / `load_date` from the shared `RunContext`, so a re-drive under
the same `--logical-run-id` replaces that load idempotently.

To enforce the schema on the same footing as silver, insert a `SchemaValidator`
validate step before the write (ADR-0006,
[`schema-enforcement.md`](schema-enforcement.md)) — a belt-and-braces guard for
rows assembled at gold rather than mirrored from ingest; no `SchemaCoercion` is
needed because gold reads already-coerced silver. A breach raises *before* the
Writer's delete-by-run/insert transaction (ADR-0005), so nothing is deleted or
accumulated and prior gold rows stay intact.

### Current-only gold vs accumulation

Not every gold accumulates. **Ingest** gold is *current-only*: the
`case_review.gold.ingest_silver_to_gold` helper reduces accumulated silver to one
row per Case (`DeriveKey → LatestPerKey → UniqueValidator → Refresh`), so its gold
is a current snapshot, not a per-run history. **Selection** / **Sync** gold use
`AccumulateByRun`, where history must survive. *Which* model a Case Type's gold
takes — and how multiple feeds fan into it (snapshot-vs-join) — is a per-Case-Type
choice; the `case_review.gold` helpers are where that assembly lives, in the
application layer rather than the framework (ADR-0013).
