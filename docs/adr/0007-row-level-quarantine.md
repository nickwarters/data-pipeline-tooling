---
status: accepted
---

# Opt-in row-level quarantine for value-rule breaches

A pipeline may be configured with an opt-in **quarantine path** via
`.quarantine(partitioner, reject_writer, input_node)`. When configured,
value-rule-failing rows are routed to the reject writer rather than aborting the
run; good rows continue through the graph to their write. Quarantine is **not the
default** — a pipeline with no `.quarantine()` node keeps the fail-fast,
all-or-nothing behaviour.

## The abort-vs-quarantine boundary

| Breach type | Behaviour |
|---|---|
| Structural — missing column, wrong dtype (`SchemaValidator`) | **Abort** — fail-fast |
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
| `logical_run_id` | the idempotency key for replacing this run's rejects |
| `pipeline_run_id` | correlates with the main run's JSONL/RunRegistry records |
| `load_date` | when the row was quarantined |

Rejects accumulate across runs via `QuarantineWriter` (delete-by-`logical_run_id` +
append), so a re-driven day replaces only its own prior rejects.

### Amendment — what "a located reason" contains

This ADR's premise is that a quarantined row is *routed aside with a located
reason*. As originally implemented that was not true: the partitioner asked each
breached rule to `check()` the **whole column**, so every rejected row was
stamped with the same message naming up to five offending values sampled from
across the column — values belonging to *other* rows. On a wide feed that is not
an explanation, it is a distraction.

A reject reason now describes the **rule's expectation** and samples **no**
values:

```
column 'code' has value(s) outside {'A', 'B'}
```

The located part is the pairing: the reason says what was expected, and the
rejected row sitting beside it in the reject table carries the value that failed
it. The aborting `SchemaValidator` keeps its sampled phrasing
(`... outside {'A', 'B'}: 'X', 'Y', 'Z'`) — it describes a *column*, where a
sample of offenders is exactly the right diagnosis. Both read one shared
evaluation of the declared rules; only the presentation differs.

**This changes stored text.** `failed_rule` is an audit artifact, and a reject
table that spans this change will hold old rows whose reasons carry a sample and
new rows whose reasons do not. The old text is wrong — it attributes other rows'
values to a row — so the change is deliberate and not back-filled; a reader
comparing rows across the boundary should expect the two shapes. The reject
table's **columns** are unchanged, so nothing downstream of it moves.

Two further corrections ride along:

- **Rows are routed by position, not by index label.** Keying reasons by index
  label merged two rows' reasons whenever labels repeated (the ordinary result
  of concatenating frames behind the `Dataset` seam) and crashed outright on a
  non-integer index.
- **A rule whose column is missing does not run — in the partitioner *and* the
  validator**, identically and by choice. There is no row to route aside for a
  column that does not exist, and the missing column is a structural breach the
  `SchemaValidator` in front of the quarantine node reports and aborts on. See
  [schema-enforcement.md](../schema-enforcement.md#one-traversal-two-presentations).

## Why

- **Operational reality.** A 650-column SharePoint/SAS export with one bad cell
  killing the night's ingest is operationally brutal. Quarantine lets the good
  majority land while the bad minority stays visible and diagnosable.
- **Visibility over silence.** Rejects are never silently dropped — they land in a
  reject table with a reason, a run correlation, and a date, *more* visible than
  the original fail-fast, not less. This is the eligibility-stage sibling of
  selection explainability: both *route aside with a located reason*.
- **Compliance boundary preserved.** Structural breaches still abort; only
  value-rule breaches are eligible, and only when the pipeline opts in.

## Consequences

- A pipeline that configures quarantine accepts partial progress: good rows land,
  bad rows go to the reject table, and operators must monitor it.
- The reject table is **independently-committed evidence**: it survives
  a later step's failure, and its run-log step carries `committed: true` when rows
  were rejected.
- `RunLog` records a `quarantine` step for every run that has quarantine
  configured, with `rows_in`, `rows_out`, and `rows_quarantined` — a row-level
  audit trail without opening the reject database.
