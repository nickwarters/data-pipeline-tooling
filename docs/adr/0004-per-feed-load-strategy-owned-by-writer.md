---
status: accepted
---

# Load strategy is per-feed and owned by the Writer; accumulation is idempotent by logical run

How a layer is loaded — full refresh vs accumulate — is a **per-feed choice
carried by the Writer**, not a property of the layer. `store.writer(layer,
table, strategy)` takes the strategy explicitly and the `Store` only resolves
*which* `<subject>/<layer>.db` the Writer targets (ADR-0001). Two feeds may land
in the same layer with different strategies; the composition machinery makes no
load decision of its own.

The strategies:

- **`Refresh`** — truncate + reload. The layer is a faithful current-state mirror.
- **`AccumulateByRun(logical_run_id, load_date)`** — append, made idempotent by
  **delete-by-logical-run then insert** (`DELETE WHERE run_id = X; INSERT …`).
  Every row is stamped with the logical run id, `load_date`, and `execution_id`.
- **`InsertOrIgnore` / `InsertIfAbsent` / `UpsertStrategy`** — key-aware loads for
  the cases an accumulate or refresh doesn't fit (e.g. minting stable surrogate
  keys, or merging on a business key).

## Two identities on a run, not one

A run carries a shared `RunContext` that separates the two notions of "which run"
that were previously conflated:

- **`execution_id`** — the concrete attempt. Recorded as `run_id` in the RunLog
  and RunRegistry; correlates rows to a specific execution.
- **`logical_run_id`** — the business/idempotency key (a snapshot or business
  date), reused by a re-driven run so a re-run replaces exactly its own rows.

The context also carries `load_date`, `run_date`, and explicit `params` (e.g.
`source_file`) so orchestration can drive the same pipeline once per source
artifact without the pipeline scanning internally.
`AccumulateByRun.from_context(context)` derives the Writer strategy from it.
Accumulated rows keep `run_id` (the logical key), `logical_run_id`, and
`execution_id`, so an operator can correlate a row to a RunRegistry record
without guessing which "run id" applies.

## Why per-feed, not per-layer

- **Idempotent re-runs without watermark machinery.** Delete-then-reinsert a
  logical run's rows is simple and correct at small volumes (≤ ~1M rows).
- **History where it matters.** Selections made and outcomes received are an audit
  trail that must survive a refresh; upstream snapshots can be rebuilt from
  source, so they need not be.
- A single global "refresh upstream / accumulate gold" rule cannot express both,
  because the right profile differs by Pipeline.

## The Ingest profile inverts: history-upstream, current-gold

Several sources are **destructive current-state systems** — they overwrite, and
history cannot be re-pulled. For those, the framework must be the historian: an
Ingest feed **accumulates raw and silver** (the change-over-time record) and
reduces to a **current-only gold** of one row per Case (ADR-0009). Gold becomes
the clean, enforced consumption layer feeding Selection and Reporting rather than
a multi-version pile deduped on read.

Selection, Sync, and Reporting keep **accumulate-by-run gold** — the SelectionPool
and Review Outcomes are audit trails. So "gold" carries no single load semantic
across Pipelines: the semantic is the Pipeline's, expressed by the Writer it
composes. "Refresh upstream / accumulate gold" remains the **default starting
profile** for a simple current-state feed whose source is non-destructive — just
no longer the only one.

## Considered options

- **Full-refresh everything** — trivially idempotent but destroys historical
  selections and outcomes. Rejected.
- **Incremental/watermarks everywhere** — efficient at scale but adds state,
  late-arrival, and dedupe complexity unjustified at current volumes. Rejected.
- **Layer infers strategy** — the Store branching on layer name quietly put a load
  decision where it does not belong; the Writer is the right owner.

## Consequences

- **Raw is no longer always rebuildable from source.** Where the source is
  destructive, accumulated raw/silver are a **system of record** needing
  backup/retention (ADR-0001), not a transient landing zone.
- **The volume envelope grows.** Accumulating raw + silver scales `records ×
  snapshots`, beyond the original ≤~1M assumption; revisit retention/compaction
  per feed when one warrants it.
- Re-running a logical run must scope its delete by `run_id` (the logical key),
  never by a business key or `execution_id`, so gold never updates a record in
  place: a record that changes between logical runs yields one stamped row per run
  that observed it, and its "current" value is `max(load_date)` per business key —
  a read-side derivation in Python, not the Writer's job.
</content>
