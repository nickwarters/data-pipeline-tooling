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
