---
status: accepted
amends: 0007-fail-fast-atomic-runs-jsonl-observability.md
---

# ADR-0007 Amendment 01 — Opt-in row-level quarantine for value-rule breaches

## Decision

Pipelines may be configured with an opt-in **quarantine path** via
`.quarantine(row_validator, reject_writer)`. When configured, value-rule-failing
rows are routed to the reject writer rather than aborting the run; good rows
proceed through the normal pipeline and write.

## The abort-vs-quarantine boundary

| Breach type | Behaviour |
|---|---|
| Structural — missing column, wrong dtype (`SchemaValidator`) | **Abort** — still fail-fast per ADR-0007 |
| Value-rule — Pattern, Length, Unique, OneOf (`SchemaValueRulePartitioner`) | **Quarantine** when `.quarantine()` is configured |

Structural breaches abort because they indicate the feed is fundamentally broken
(a 650-column SAS export missing a declared column cannot proceed). Value-rule
breaches are candidates for quarantine because a single malformed cell in a large
feed is operationally different from a schema collapse.

Quarantine is **not the default**. A pipeline with no `.quarantine()` call
retains the original fail-fast, all-or-nothing behaviour.

## Reject table schema

Every rejected row lands in the configured reject table with these additional
columns stamped by the pipeline:

| Column | Source | Meaning |
|---|---|---|
| `failed_rule` | `SchemaValueRulePartitioner` | Semicolon-joined breach descriptions for this row |
| `run_id` | `RunContext.logical_run_id` | Logical/idempotency key for replacing rejects from a re-driven business run |
| `logical_run_id` | `RunContext.logical_run_id` | Explicit name for the same logical/idempotency key |
| `execution_id` | `RunContext.execution_id` | Correlates with the main run's JSONL/RunRegistry records |
| `load_date` | `RunContext.load_date` | When the row was quarantined |

Rejects accumulate across runs via `QuarantineWriter` (delete-by-run_id + append),
so a re-driven day replaces only its own prior rejects without touching other runs.

## Observability

The `RunLog` records a `"quarantine"` step for every run that has a quarantine
configured, whether or not any rows were rejected. The step records:

- `rows_in` — total rows entering the quarantine partition
- `rows_out` — good rows that continue through the pipeline
- `rows_quarantined` — rows routed to the reject writer

This gives operators a row-level audit trail without opening the reject database.

## Why

- **Operational reality:** a 650-column SharePoint/SAS export with one bad cell
  killing the night's ingest is operationally brutal. Quarantine lets the good
  majority land while the bad minority is visible and diagnosable.
- **Visibility over silence:** rejects are never silently dropped. They land in a
  reject table with a reason, a run correlation, and a date — more visible than
  the original fail-fast, not less.
- **Compliance boundary preserved:** structural breaches still abort; only
  value-rule breaches are eligible. The opt-in design means a pipeline that does
  not call `.quarantine()` is unaffected by this amendment.

## Consequences

- A pipeline that configures quarantine accepts partial progress: good rows land,
  bad rows go to the reject table. Operators must monitor the reject table.
- The abort-vs-quarantine boundary (structural vs value-rule) is the critical
  invariant. Attaching a `SchemaValidator` (structural) before `.quarantine()`
  ensures the feed's shape is sound before partitioning begins.
- `rows_quarantined` is now a first-class field in the JSONL run log schema; the
  deferred run-registry (ADR-0005) should expect it on quarantine steps.
