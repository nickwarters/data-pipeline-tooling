# Gold accumulation & what "gold" means

This documents the **gold** layer's load semantics and the `silver_to_gold`
builder introduced in #8: rows stamped `run_id` / `load_date`, accumulating
across runs, with an idempotent re-run via *delete-by-run then insert*. For the
*why*, see [ADR-0006](adr/0006-load-idempotency-refresh-upstream-accumulate-downstream.md);
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

Both statements commit as a **single SQLite transaction** (ADR-0007): if the
insert fails, the delete rolls back, so a failed re-run never half-wipes prior
rows. The result: re-running a given load is safe and deterministic, while the
historical record of prior loads is preserved.

Because a re-run replaces only its own prior rows, the **net-new** rows it
persists is zero. The writer exposes this after `write()` as `rows_written`
(`N` on a fresh write, `0` when the delete-by-run matched prior rows), and the
write step reports it as the run log's `rows_out` — so a re-run reads as `0`,
matching the unchanged table state rather than a misleading fresh load of N. See
[`run-log-format.md`](run-log-format.md).

## `run_id` is *not* the run-log's execution id

The run-log (ADR-0007) mints a **fresh uuid `run_id` per `.run()`** to correlate
every record of one execution. Gold's `run_id` is a **different thing** — a
stable, logical load key — and the two are **deliberately not unified**:

- **Log `run_id`** = *this execution* — fresh uuid each `.run()`.
- **Gold `run_id`** = *this logical load* — caller-chosen, the delete-by-run
  idempotency key.

Stamping gold rows with a fresh-per-execution uuid would break idempotency: a
re-run would never match prior rows and would silently duplicate history. So
`silver_to_gold` takes `run_id` / `load_date` as **caller-supplied** arguments.
(Linking the two for lineage — having the run log *record* the gold `run_id` as
metadata — is deferred to the run-registry, ADR-0005.)

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
  stable records × 100 daily runs ≈ 1M rows, mostly identical. ADR-0006 bounds
  this at ~1M rows; beyond that, change-detection or retention becomes a real
  decision. There is no built-in "is-current" flag — consumers derive it.
- **Event / decision log** — each run appends only new facts (selections made,
  outcomes received) that never restate prior rows. This is what ADR-0006
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

## `silver_to_gold` — accumulate validated silver into gold

The builder wires one subject's table from silver into gold:

```python
from framework.io import StoreCatalog
from framework.recipes import silver_to_gold

store = StoreCatalog("/path/to/share").store("cases")
silver_to_gold(
    store, "selection_pool", run_id="2026-05-30", load_date="2026-05-30"
).run()   # reads silver, accumulates into gold.db stamped by run
```

It reads `store`'s **silver** table and accumulates it into the **gold** table
via the `AccumulateByRunWriter` the `Store` mints — all deferred until `.run()`.
The per-run step order is:

```
read → pre-validate → process → post-validate → write
```

By default the builder is a **pure pass-through**: silver is already
schema-validated upstream, so no validators or processors are attached — it
carries validated silver forward and lets the Writer stamp and accumulate it. The
builder makes no write or load decisions of its own: the `Store` mints the Writer,
which owns its location and accumulate strategy (ADR-0003, ADR-0006).

### Optional `schema=` — validate on the same footing as silver

Pass a Case Type schema to enforce it at the gold boundary too (ADR-0008,
[`schema-enforcement.md`](schema-enforcement.md)):

```python
from tests._schema_fixtures import LandedCase  # any Case Type dataclass

silver_to_gold(
    store, "selection_pool",
    run_id="2026-05-30", load_date="2026-05-30",
    schema=LandedCase,                    # enforced before the gold write
).run()
```

When supplied, `SchemaValidator(schema)` attaches as a **post**-validator, so the
schema is checked on the data about to be written and the step order becomes:

```
read → pre-validate → process → post-validate (schema) → write
```

Because `.run()` is fail-fast and atomic (ADR-0007), a breach raises at
**post-validate** *before* the Writer's delete-by-run/insert transaction — so
nothing is deleted or accumulated and any **prior runs' gold rows stay intact**.
No coercion processor is attached (unlike `raw_to_silver`): gold reads
already-coerced silver, so this is purely a **belt-and-braces** guard for
selection-built rows rather than ingest mirrors. Omit `schema=` and the accumulate
pass-through is unchanged.

## Not yet (follow-on tickets)

- **Row→run lineage.** Recording the gold `run_id` / `load_date` as metadata on
  the run log, linking an execution to the logical load it produced, lands with
  the run-registry (ADR-0005).
