---
status: accepted
---

# Checkpoint: mid-run lineage write

A `Pipeline` may have zero or more **checkpoints** — intermediate writes that
snapshot the current dataset at a point in the stage sequence and pass it
through unchanged. A checkpoint is attached with `.checkpoint(writer)` between
`.with_processor()` calls (or at the start/end of the stage chain before the
terminus), and each fires in attach order during `.run()`.

## Why this is not the rejected multi-Writer terminus

ADR-0009 rejected a "multi-Writer terminus" — attaching two Writers both acting
as the final destination of a run — because it breaks the load-bearing seams:
`.write_to()` takes one Writer and `.run()` returns one Dataset. The rejected
pattern tried to route the same dataset to N destinations at the end of the flow,
which collapses the clean "one pipeline, one destination" contract.

A checkpoint is categorically different on three dimensions:

1. **It is not a terminus.** The dataset continues after a checkpoint; a terminus
   is the end of the flow. The checkpoint's writer is an observer that receives a
   snapshot, not a final destination.
2. **It does not affect the dataset.** A checkpoint's write is a pure side-effect;
   the dataset that exits the checkpoint stage is identical to the one that entered.
   No shape, no column set, no row count changes.
3. **It is position-sensitive, not fan-out.** A checkpoint attached between two
   processors sees a different dataset than one attached after both. This
   sequencing property — "snapshot of the dataset at this particular point" — has
   no equivalent in a fan-out terminus, where all writers see the same final state.

## Why this is not the separate-pipeline pattern (ADR-0009)

ADR-0009 chose "N single-table pipelines over a shared source" for fan-out writes
(e.g. Case table + Detail Tables from the same raw feed). A checkpoint is not an
alternative for fan-out:

- A **separate pipeline** is the right primitive when a write target is an
  independent table that needs its own schema, validators, load strategy, and
  RunLog. It reads from a shared source and owns its full stage sequence.
- A **checkpoint** is the right primitive when you want to record the dataset *as
  it exists mid-run* — before or between transforms — without defining a
  separate feed or spawning a second reader. It shares the parent run's `run_id`
  and appears as a step in the same RunLog record.

Concretely: if you have gold SelectionPool → SharePoint Deliverable, those are
two pipelines (ADR-0009, #48). If you want a snapshot of the post-join,
pre-filter intermediate inside the SelectionPool pipeline, that is a checkpoint.

## Observability

Each checkpoint emits its own `RunLog` step record named `checkpoint:0`,
`checkpoint:1`, etc. (in attach order) with `rows_in`, `rows_out`, and
`status`. A failing checkpoint is recorded as `status="error"` before the
exception propagates (ADR-0007 fail-fast). All checkpoint step records share
the run's `run_id`, so the intermediate snapshots are fully traceable back to
the run that produced them.

## Fail-fast semantics

A checkpoint failure aborts the run before the terminus write (or any
subsequent checkpoint). Partial state rules: if checkpoint N succeeds and
checkpoint N+1 fails, the N snapshot exists in the checkpoint's backing store
but the terminus write has not occurred. The checkpoint writer owns its own
load strategy and is responsible for idempotency on re-run (ADR-0006).

A committed checkpoint is **independently committed evidence**: it is not rolled
back by a later step's failure, and its run-log step carries `committed: true` so
an operator can see it landed ([ADR-0007 amendment 03](0007-amendment-03-independent-artifact-commits.md)).
This is the same independent-evidence model quarantine and explain follow.

## Consequences

- `.checkpoint(writer)` is added to the `Pipeline` builder alongside
  `.with_processor()`. Both append ordered stages and preserve insertion order.
- The former single "process" step in the RunLog is replaced by per-stage
  steps (`"process"` for each processor, `"checkpoint:N"` for each checkpoint).
- The Selection two-write case (#48) is **not** a checkpoint use case — it
  remains two separate pipelines over a shared gold source (ADR-0009).
