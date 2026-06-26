---
status: accepted
---

# Fail-fast atomic runs, independently-committed artifacts, structured JSONL observability

`.run()` is **fail-fast**: any validator or transform failure aborts the run.
Validators default to **error severity (abort)**; an individual validator can be
marked `warn` to log-and-continue. **Rows are never silently dropped** — in a
regulated review domain, excluding a reviewable Case must be explicit and
visible, so bad data either fails the run, is routed aside with a located reason
(quarantine — ADR-0007), or is recorded in a trace (explainability — ADR-0008),
but never quietly disappears.

Every run emits **structured JSONL** — one JSON object per line to a `.log` file
(execution `run_id`, pipeline, step, status, `rows_in`/`rows_out`, duration,
errors, warn-hits, a `committed` marker), with human-readable console output for
development. JSONL needs no infrastructure now, yet the `RunRegistry` ingests it
without parsing free text.

## What "atomic" scopes — per writer, not per run

Atomicity is **per writer, per layer database**: a single writer's
delete-then-insert (or truncate+reload) is all-or-nothing, so a failed write
never half-wipes its *own* target table. It does **not** bracket multiple writers
into one publish unit.

A run can write more than its final output: a quarantine reject table (ADR-0007),
a selection/explain trace table (ADR-0008), and zero or more mid-graph checkpoint
writes (ADR-0003) — each backed by its own writer.

**These are independently-committed evidence, not one publish unit.** Each commits
when its node runs and **survives a later step's failure**. There is deliberately
no cross-artifact staging area that holds writes back until the terminus succeeds.
This is the right model for a regulated domain: a reject table, a per-Case trace,
or a mid-run snapshot is *most* valuable precisely when the run then fails —
rolling them back on a later abort would discard the diagnostic trail an operator
needs to resolve that abort.

| Scope | Guarantee |
|---|---|
| One writer's delete+insert into one table | all-or-nothing |
| Across the artifacts of one run (quarantine / trace / checkpoint / output) | **independent commits** |

## Why

- **Compliance over throughput.** Silent row-level loss risks dropping Cases that
  should be reviewed; fail-fast surfaces problems instead. The escape hatches
  (quarantine, trace, `warn`) all *route a located reason*, never silently drop.
- **Atomicity is cheap here.** Single-writer plus one layer DB per writer makes a
  per-writer transaction a clean all-or-nothing boundary.
- **Evidence outlives failure.** Independent commits mean a failed run's log reads
  as a list of the artifacts that already landed, followed by the failing step —
  so recovery starts from "what is already on disk", not a guess.

## Consequences

- Bad upstream data stops the pipeline; operators fix the source or mark specific
  validators `warn` deliberately. `warn` is the explicit escape hatch for
  known-tolerable conditions.
- Every run-log record carries a **`committed`** boolean — `true` only on the
  success record of a step that durably wrote an artifact (`write`, `quarantine`
  when rows were rejected, `explain`, a checkpoint write). On a failed run the
  `committed` markers are the authoritative list of what landed; the `RunRegistry`
  stores them.
- Each expected failure carries a triage category (`data` / `operational` /
  `config`) on the run log so an operator can route a failure without reading
  every message; a bug carries none, and keeps its traceback.
- Re-driving stays idempotent per artifact: each writer owns its own load strategy
  and idempotency key (ADR-0004), so there is nothing to "unpublish" before a
  re-drive.
- The JSONL schema (execution `run_id`, per-step metrics, `committed`,
  `error_category`) is the contract the `RunRegistry` consumes.
</content>
