---
status: accepted
---

# Load & idempotency: refresh upstream, accumulate downstream, stamp by run

Sources are treated as current-state snapshots, so **raw and silver are full-refreshed each run** (truncate + reload). **Gold (SelectionPool) and Review Outcomes accumulate** — every row is stamped with `run_id` and `load_date`. A re-run is made idempotent by **delete-by-run then insert** (`DELETE WHERE run_id = X; INSERT …`). This keeps re-running a given day safe and deterministic while preserving the historical record of past selections and reviews for audit/reporting.

## Why

- **Idempotent re-runs** without watermark machinery: deleting and reinserting a run's rows is simple and correct at small volumes (≤ ~1M rows).
- **History where it matters:** selections made and outcomes received are an audit trail; they must not be lost on a refresh, unlike upstream snapshots which can always be rebuilt from source.
- Fits the dumb-store / Python-processing model — the run stamping and delete/insert are mechanical persistence, not business logic.

## Considered options

- **Full-refresh everything:** trivially idempotent but destroys historical selections/outcomes — rejected for audit/reporting reasons.
- **Incremental/watermarks everywhere:** efficient at scale but adds state, late-arrival, and dedupe complexity unjustified at current volumes.

## Consequences

- `run_id` and `load_date` are first-class columns on accumulating tables; they also seed future lineage / run-registry (see ADR-0005).
- Re-running a day must scope its delete by `run_id` (or the run's logical date) to avoid wiping other runs' rows.
- If a source ever becomes delta-based rather than a full snapshot, the raw load strategy for that feed must be revisited.

## Amendment (#8): `run_id` is a load key, and gold is reused across stages

Clarifications from building the `silver_to_gold` builder (#8); see [gold-accumulation.md](../gold-accumulation.md):

- **`run_id` is the load / idempotency key, not a business version key.** The delete-by-run is scoped to `run_id` alone, never to a business key (`case_ref`), so gold never updates a record in place. A record that changes between runs yields one stamped row per run that observed it; its version axis is `(case_ref, load_date)`. The "current" value of a record is `max(load_date)` per business key (and, when a run writes the full set, equivalently the latest `run_id`). That derivation is Python on the read side (ADR-0002), not the Writer.

- **This is a periodic-snapshot pattern as much as an event log.** The original decision framed gold around accumulating *selections / outcomes* (append-only events). Reused for a full per-run snapshot of a mutable entity (e.g. the Sync stage re-syncing the review platform), the same primitive re-copies unchanged rows every run — periodic-snapshot growth (records × runs), bounded here at ~1M rows. Whether a given gold should stay a periodic snapshot or grow change-detection / SCD-style current+history is a per-stage decision, deferred until a stage needs it.

- **The medallion is reused by every stage.** `raw → silver → gold` is stage-agnostic infrastructure: Ingest, Selection, **Sync** (review-platform outcomes in their own store), and **Reporting** (cross-pipeline views feeding CSV / Excel / JSON feeds) each run their own store(s) through it. Gold is, in each, the layer whose history must survive across runs.
