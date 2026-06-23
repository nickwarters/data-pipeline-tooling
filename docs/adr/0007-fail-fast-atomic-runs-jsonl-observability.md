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

## Amendment (2026-06-23): the node is the unit of observability and recovery; explicit retry resumes uncommitted nodes

A run is a **DAG of independently-committed nodes** (ADR-0003 2026-06-23
amendment). Atomicity stays **per writer, per node**; each node already emits one
RunLog record with a **`committed`** marker recording whether its write durably
landed. The node — not the run — is the unit of observability and recovery.

**Recovery has two distinct modes:**

- A plain **re-run** is a clean **full re-drive**. It is safe because every writer
  is idempotent (delete-by-logical-`run_id` + insert, or upsert), so re-driving
  re-commits every write deterministically. This is the path to use when the
  source may have changed — e.g. fixing a bad feed — because it *overwrites* any
  previously-committed-but-wrong output rather than skipping it.
- An explicit **`retry`** of a `logical_run_id` **skips the nodes already
  committed in a prior attempt** and re-drives the rest. It is the dbt-`retry` /
  Airflow-clear-from-failure shape, made an explicit operator act, never implicit
  on a same-day re-run.

**Retry semantics and the constraints they impose:**

- **Retry skips committed *writes*, not computation.** Intermediate reads and
  transforms are in-memory (only writes — and explicit checkpoints — persist), so
  retry **re-runs the pure prefix** feeding any uncommitted write and skips only
  the committed writes (and any checkpointed subtree). The saving is the slow/
  lock-prone writes, not the recompute (cheap at ≤~1M rows — ADR-0002).
- **Correctness assumes a frozen source** across attempts of one `logical_run_id`.
  Mixing committed writes from one snapshot with fresh writes from another would
  corrupt the run; this is exactly why retry is **explicit** and a changed source
  takes the full-re-drive path instead.
- **Idempotent writers remain mandatory.** The `committed` marker (in the RunLog
  file) and the data write (in the layer DB) are not one transaction, so a crash
  between them means retry may re-commit a write — idempotency is the safety net,
  retry is the optimisation on top.
- **Node names are identity.** Retry matches committed nodes by name across
  attempts, so node names must be **unique within a DAG** and stable in code.
- **`committed` markers must be queryable by `logical_run_id`.** Step records
  today key on `execution_id` (per attempt); retry needs to find committed nodes
  across *all attempts of one logical run*, so step records gain a stamped
  `logical_run_id` (a small RunLog addition).

Status: per-node observability and `committed` markers exist today; **explicit
`retry`/resume is decided, not yet built.** It lands behind the existing
`committed` seam without changing the builder contract (ADR-0005 progressive
enhancement).
