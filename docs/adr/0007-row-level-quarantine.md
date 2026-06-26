---
status: accepted
---

# Opt-in row-level quarantine for value-rule breaches

A pipeline may be configured with an opt-in **quarantine path** via
`.quarantine(partitioner, reject_writer, input_node)`. When configured,
value-rule-failing rows are routed to the reject writer rather than aborting the
run; good rows continue through the graph to their write. Quarantine is **not the
default** — a pipeline with no `.quarantine()` node keeps the fail-fast,
all-or-nothing behaviour of ADR-0005.

## The abort-vs-quarantine boundary

| Breach type | Behaviour |
|---|---|
| Structural — missing column, wrong dtype (`SchemaValidator`) | **Abort** — fail-fast (ADR-0005/0006) |
| Value-rule — `Pattern`, `Length`, `Unique`, `OneOf`, … (`SchemaValueRulePartitioner`) | **Quarantine** when configured |

Structural breaches abort because they indicate the feed is fundamentally broken
(a 650-column SAS export missing a declared column cannot proceed). Value-rule
breaches are eligible for quarantine because a single malformed cell in a large
feed is operationally different from a schema collapse. Attaching a
`SchemaValidator` (structural) before the quarantine node ensures the feed's shape
is sound before partitioning begins — this ordering is the critical invariant.

## Reject table schema

Every rejected row lands in the configured reject table with these columns stamped
by the quarantine node:

| Column | Meaning |
|---|---|
| `failed_rule` | semicolon-joined breach descriptions for this row |
| `run_id`, `logical_run_id` | the logical/idempotency key for replacing this run's rejects |
| `execution_id` | correlates with the main run's JSONL/RunRegistry records |
| `load_date` | when the row was quarantined |

Rejects accumulate across runs via `QuarantineWriter` (delete-by-`run_id` +
append), so a re-driven day replaces only its own prior rejects (ADR-0004).

## Why

- **Operational reality.** A 650-column SharePoint/SAS export with one bad cell
  killing the night's ingest is operationally brutal. Quarantine lets the good
  majority land while the bad minority stays visible and diagnosable.
- **Visibility over silence.** Rejects are never silently dropped — they land in a
  reject table with a reason, a run correlation, and a date, *more* visible than
  the original fail-fast, not less. This is the eligibility-stage sibling of
  selection explainability (ADR-0008): both *route aside with a located reason*.
- **Compliance boundary preserved.** Structural breaches still abort; only
  value-rule breaches are eligible, and only when the pipeline opts in.

## Consequences

- A pipeline that configures quarantine accepts partial progress: good rows land,
  bad rows go to the reject table, and operators must monitor it.
- The reject table is **independently-committed evidence** (ADR-0005): it survives
  a later step's failure, and its run-log step carries `committed: true` when rows
  were rejected.
- `RunLog` records a `quarantine` step for every run that has quarantine
  configured, with `rows_in`, `rows_out`, and `rows_quarantined` — a row-level
  audit trail without opening the reject database.
</content>
