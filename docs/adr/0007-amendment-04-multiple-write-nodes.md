---
status: accepted
amends: 0007-fail-fast-atomic-runs-jsonl-observability.md
---

# ADR-0007 Amendment 04 — Multiple primary write nodes are independently committed

## The question

ADR-0007 states that a builder's writes "execute in a **single SQLite transaction**."
Amendment 03 extended the independent-commit model to intermediate evidence artifacts
(quarantine, explain, checkpoint), but scoped its discussion to those side-effect
nodes. The question is whether that framing holds for **multiple primary `write()`
output nodes** — the case that arises when a DAG pipeline calls `.write()` more
than once for different output targets.

## What the code actually does

The DAG-based `Pipeline` (in `framework/run/builder.py`) supports multiple
`.write(writer, node, name=…)` calls, each producing an independent `WriteNode`.
During `.run()`, each `WriteNode` calls its writer's `.write()` method in its own
connection with its own `BEGIN`/`COMMIT`. There is no transaction that brackets
multiple write nodes together.

If a pipeline has write node A followed by write node B, and A succeeds but B
raises, A's rows are already committed on disk. Nothing rolls them back.

This is the same behaviour Amendment 03 documented for quarantine/explain/checkpoint,
but those nodes are *side-effect evidence* nodes. This amendment documents the same
independent-commit property for **primary output** write nodes.

## What "single SQLite transaction" actually scopes

The original ADR's "single SQLite transaction" language was accurate for the common
single-writer builder. It remains accurate as a *per-writer* property: one writer's
delete+insert (or truncate+reload) is all-or-nothing within its own connection. It
does **not** mean that all writes in a run share one transaction.

| Scope | Guarantee |
|---|---|
| One writer's operations against its own table | all-or-nothing per writer (per ADR-0007 + #139/#165) |
| Across multiple `write()` nodes in one pipeline | **independent commits** (Amendment 03 + this amendment) |
| Across intermediate evidence artifacts and output nodes | **independent commits** (Amendment 03 + this amendment) |

## Operational consequence

When a pipeline has multiple primary `write()` nodes, a failure mid-run may leave
some output tables written and others not. The run log's `committed` markers (added
in Amendment 03) are the authoritative record of which writes landed before the
abort. Operators re-driving such a run should expect idempotency to handle the
already-committed tables cleanly: each writer's load strategy (Refresh or
AccumulateByRun) replaces only that run's own rows on re-execution, so re-driving
is safe regardless of which writes completed previously.

## Why this is the right model

A publish-unit that brackets all write nodes in a single SQLite transaction would
require sharing one connection across writers that may target different DB files
(one per layer) and running all DDL and DML within it — fragile, cross-file, and
at odds with SQLite's single-writer model. The independent-commit model preserves
the per-writer all-or-nothing guarantee, keeps writers decoupled, and lets
`committed` in the run log serve as the operator's recovery map, which is the same
reasoning Amendment 03 applied to evidence artifacts.

## No change to existing behaviour

This amendment documents existing behaviour. No code changes are made.
