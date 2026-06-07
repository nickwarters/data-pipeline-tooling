---
status: accepted
---

# Load & idempotency: refresh upstream, accumulate downstream, stamp by logical run

Sources are treated as current-state snapshots, so **raw and silver are full-refreshed each run** (truncate + reload). **Gold (SelectionPool) and Review Outcomes accumulate** — every row is stamped with a logical `run_id` / `logical_run_id` and `load_date`, plus `execution_id` when written from a `RunContext`. A re-run is made idempotent by **delete-by-logical-run then insert** (`DELETE WHERE run_id = X; INSERT …`). This keeps re-running a given business day safe and deterministic while preserving the historical record of past selections and reviews for audit/reporting.

## Why

- **Idempotent re-runs** without watermark machinery: deleting and reinserting a run's rows is simple and correct at small volumes (≤ ~1M rows).
- **History where it matters:** selections made and outcomes received are an audit trail; they must not be lost on a refresh, unlike upstream snapshots which can always be rebuilt from source.
- Fits the dumb-store / Python-processing model — the run stamping and delete/insert are mechanical persistence, not business logic.

## Considered options

- **Full-refresh everything:** trivially idempotent but destroys historical selections/outcomes — rejected for audit/reporting reasons.
- **Incremental/watermarks everywhere:** efficient at scale but adds state, late-arrival, and dedupe complexity unjustified at current volumes.

## Consequences

- Logical `run_id`, `logical_run_id`, and `load_date` are first-class columns on accumulating tables. Context-derived writes also stamp `execution_id`, which is the value recorded as `run_id` in RunLog/RunRegistry.
- Re-running a day must scope its delete by logical `run_id` (or the run's logical date) to avoid wiping other runs' rows.
- If a source ever becomes delta-based rather than a full snapshot, the raw load strategy for that feed must be revisited.

## Amendment (#8): `run_id` is a load key, and gold is reused across Pipelines

Clarifications from building the `silver_to_gold` builder (#8); see [gold-accumulation.md](../gold-accumulation.md):

- **Logical `run_id` is the load / idempotency key, not a business version key or execution trace key.** The delete-by-run is scoped to logical `run_id` alone, never to a business key (`case_ref`) or execution id, so gold never updates a record in place. A record that changes between logical runs yields one stamped row per run that observed it; its version axis is `(case_ref, load_date)`. The "current" value of a record is `max(load_date)` per business key (and, when a run writes the full set, equivalently the latest logical `run_id`). That derivation is Python on the read side (ADR-0002), not the Writer.

- **This is a periodic-snapshot pattern as much as an event log.** The original decision framed gold around accumulating *selections / outcomes* (append-only events). Reused for a full per-run snapshot of a mutable entity (e.g. the Sync **Pipeline** re-syncing the review platform), the same primitive re-copies unchanged rows every run — periodic-snapshot growth (records × runs), bounded here at ~1M rows. Whether a given gold should stay a periodic snapshot or grow change-detection / SCD-style current+history is a per-Pipeline decision, deferred until a Pipeline needs it.

- **The medallion is reused by every Pipeline.** `raw → silver → gold` is Pipeline-agnostic infrastructure: **Ingest**, **Selection**, **Sync** (review-platform outcomes in their own store), and **Reporting** (cross-Pipeline views shaped into Deliverables) each run their own store(s) through it. Gold is, in each, the layer whose history must survive across runs. See [CONTEXT.md](../../CONTEXT.md) for the Pipeline / Deliverable vocabulary.

## Amendment (2026-06-01): load strategy is per-feed, not per-layer — and Ingest flips to history-upstream / current-gold

The headline rule above — *refresh upstream (raw/silver), accumulate downstream
(gold)* — is **superseded as a global rule**. Load strategy is now a **per-feed /
per-Pipeline choice owned by the Writer**, with the Store mapping `layer →
location` only and making **no** load decision — finally honouring the
ADR-0003-amendment principle that `Store.writer` had been quietly violating by
branching on the layer name (`_REFRESH_LAYERS`).

- **Strategy is an explicit Writer choice, not a property of the layer.**
  `store.writer(layer, table, strategy)` takes the strategy explicitly —
  `Refresh()` (truncate + reload) or `AccumulateByRun(run_id, load_date)` — and
  the Store only resolves *which* `<subject>/<layer>.db` the Writer targets. Two
  feeds may land in the *same* layer with *different* strategies.
- **Idempotency mechanics are unchanged, only relocated.** Delete-by-run-then-
  insert and the caller-supplied *logical* `run_id` (a business/snapshot date, not
  the run-log's per-execution uuid) still define an idempotent accumulate; they
  now apply wherever accumulation is configured — which, for Ingest, is upstream.
- **The Ingest profile inverts to history-upstream / current-gold.** Because
  several sources are *destructive current-state systems* (they overwrite; history
  cannot be re-pulled), the framework must be the historian: an Ingest feed
  **accumulates raw and silver** (the change-over-time record) and reduces to a
  **current-only gold** — one row per Case (ADR-0009). Gold becomes the clean,
  enforced consumption layer feeding Selection/Reporting, rather than a
  multi-version pile deduped on read.
- **Selection / Sync / Reporting are unchanged** — their gold stays
  accumulate-by-run (the SelectionPool and Review Outcomes are audit trails that
  must survive a refresh). So "gold" no longer carries a single load semantic
  across Pipelines: the semantic is the *Pipeline's*, expressed by the Writer it
  composes.

Consequences:

- **Raw is no longer always rebuildable from source.** Where the source is
  destructive, accumulated raw/silver become a **system of record** needing
  backup/retention — not a transient landing zone. (This is the inverse of the
  original Consequence about delta sources: there the *source* changed shape;
  here the source *forgets*, so the framework must remember.)
- **The volume envelope grows.** Accumulating raw + silver scales
  `records × snapshots`, beyond the original ≤~1M assumption; revisit
  retention/compaction per feed when one warrants it.
- The original "refresh-up / accumulate-down" framing remains the **default
  starting profile** for a simple current-state feed whose source is
  non-destructive; it is just no longer the only profile.

## Amendment (2026-06-07): RunContext separates execution identity from logical idempotency identity

Pipeline execution now has one shared `RunContext` carrying:

- `execution_id` — the concrete attempt, recorded as `run_id` in RunLog and
  RunRegistry.
- `logical_run_id` — the business/idempotency key reused by a re-driven run.
- `load_date` and `run_date` — the persisted load stamp and business run date.
- `run_log` and `run_registry` collaborators for orchestration.

`AccumulateByRun.from_context(context)` derives the Writer strategy from that
context. Persisted accumulated rows keep the legacy `run_id` column as the
logical idempotency key, also stamp `logical_run_id`, and stamp `execution_id`
so operators can correlate rows to RunRegistry records without guessing which
`run_id` meaning applies. Quarantine and explainability artifacts follow the
same model as the main accumulated output.
