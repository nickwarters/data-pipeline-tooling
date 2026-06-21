---
status: accepted
---

# Fail-fast atomic runs, no silent drops, structured JSONL observability

`.run()` is **fail-fast and atomic**. Each builder targets one layer DB, and its writes (truncate+reload for raw/silver; delete-by-logical-`run_id`+insert for accumulated outputs) execute in a **single SQLite transaction** — any validator or processor failure aborts the run and rolls back, so a layer is never left half-written. Validators default to **error severity (abort)**; an individual validator can be marked `warn` to log-and-continue. **Rows are never silently dropped** — in a regulated review domain, excluding a reviewable case must be explicit and visible, so bad data fails the run rather than being quietly quarantined. Each run emits **structured JSONL** records (one JSON object per line: execution `run_id`, pipeline, step, status, `rows_in`/`rows_out`, duration, errors, warn-hits) to a `.log` file, with human-readable console output for development.

## Why

- **Compliance over throughput:** silent row-level quarantine risks dropping cases that should be reviewed; fail-fast surfaces problems instead.
- **Atomicity is cheap here:** single-writer + one layer DB per builder means a per-run transaction gives clean all-or-nothing semantics.
- **JSONL is the seam:** structured-but-fileonly logging needs no infrastructure now, yet the deferred runner/run-registry (ADR-0005) can ingest it later without parsing free text.

## Consequences

- Bad upstream data stops the pipeline; operators must fix the source or mark specific validators `warn` deliberately.
- `warn` severity is the explicit escape hatch for known-tolerable conditions.
- The JSONL schema (execution `run_id` + per-step metrics) is effectively the contract the future run-registry will consume.
- **Scope of "atomic":** the all-or-nothing guarantee is **per writer, per layer DB** — one writer's delete+insert never half-wipes its own table. It does **not** bracket multiple writers into one publish unit. A run's intermediate artifacts (quarantine, explain/trace, checkpoint) are **independently committed evidence** that survives a later step's failure; the run log's `committed` marker shows which landed. See [amendment 03](0007-amendment-03-independent-artifact-commits.md). Hardening the per-writer transaction itself is #139 / #165.
