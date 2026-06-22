---
status: accepted
amends: 0007-fail-fast-atomic-runs-jsonl-observability.md
---

# ADR-0007 Amendment 03 — Run artifacts are independently committed evidence

## The question

ADR-0007 calls `.run()` "fail-fast and **atomic**". A run can write more than its
final output: a **quarantine** reject table (amd 01), a **selection/explain**
trace table (amd 02), and zero or more **checkpoints** (ADR-0011) — each backed
by its *own* store and its *own* writer. "Atomic" left an unanswered question:
when a run aborts after one of these intermediate writes, is that artifact rolled
back too (one all-or-nothing **publish unit**), or does it stay on disk?

It stays. Quarantine, explain, and checkpoint writes each commit through their
own writer as their node executes; nothing brackets them with the terminus write
in a shared transaction. The framework had this behaviour without stating it.

## Decision

**Run artifacts are independently committed evidence, not one publish unit.**
Each of quarantine, explain/trace, and checkpoint commits when its node runs and
**survives a later step's failure**. There is deliberately no cross-artifact
staging/publish unit. The final output is just the last such commit.

This is the right model for a regulated review domain: the whole point of a
reject table, a per-Case trace, and a mid-run snapshot is to be **durable
evidence** of what the run saw — evidence that is *most* valuable precisely when
the run then fails. Rolling them back on a later abort would discard the
diagnostic trail an operator needs to resolve that abort.

## What "atomic" in ADR-0007 actually scopes

ADR-0007's atomicity is **per writer, per layer DB**: a single writer's
delete-then-insert (or truncate+reload) is all-or-nothing, so a failed write
never half-wipes its *own* target table. It does **not** span writers. Two
writers in one run (a reject writer and a terminus writer, say) are two
independent commits. Hardening that per-writer transaction boundary itself is a
separate concern (#139, #165) and unchanged here.

| Scope | Guarantee | Owner |
|---|---|---|
| One writer's delete+insert into one table | all-or-nothing | ADR-0007 + #139/#165 |
| Across the artifacts of one run (quarantine / explain / checkpoint / output) | **independent commits** | this amendment |

## Making it explicit in the run log

So an operator can see *which* artifacts already landed before an abort, every
run-log record carries a **`committed`** boolean (the JSONL schema's stable key
set — see [run-log-format.md](../run-log-format.md)). It is `true` exactly on the
steps that durably wrote an artifact (`write`, `quarantine` when rows were
rejected, `explain`, `checkpoint`) and only on their **success** record — a step
that raised committed nothing. On a failed run the log therefore reads as a list
of the committed artifacts followed by the failing step, so recovery starts from
"what is already on disk", not a guess. The `RunRegistry` ingests `committed`
alongside the other per-step fields.

## Consequences

- **Operators treat artifacts as durable evidence.** A reject table, a trace, or
  a checkpoint from a *failed* run is real and on disk; it is not implied by the
  run's overall `error` status to be absent. The run log's `committed` markers
  are the authoritative list of what landed.
- **Re-driving stays idempotent per artifact.** Each writer owns its own load
  strategy and idempotency key (ADR-0006): a re-run replaces *that artifact's*
  rows for the logical run id. Quarantine rejects key by `logical_run_id`;
  checkpoints key by their own writer's strategy. There is nothing to "unpublish"
  before a re-drive.
- **No new publish-unit machinery.** We explicitly do **not** add a staging area
  that holds artifacts back until the terminus succeeds. The independent-evidence
  model is simpler and is the behaviour the primitives already had; this
  amendment documents and tests it rather than changing it.
- `committed` is now a first-class field in the JSONL run-log schema; the
  run-registry stores it (with a forward-compatible column migration for an
  existing registry DB).
