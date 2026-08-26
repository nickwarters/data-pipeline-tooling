---
status: accepted
---

# A writer-stamped run-provenance column on every table the framework writes

Every table-backed `Writer` stamps one reserved column, `pipeline_run_id`, onto
the rows it writes. The column name is declared once, as
`RUN_PROVENANCE_COLUMN` in `framework/core/protocols.py` — beside the `Writer`
protocol it belongs to — and re-exported from `framework.core` and
`framework.io`.

```python
from framework.io import RUN_PROVENANCE_COLUMN  # "pipeline_run_id"
```

Given a row in `case_version` or `case_current`, the column answers *which run
wrote it*. It is the **row-level** counterpart of the run record's
`data_locations`, which already answers the same question at **table**
granularity ([structured JSONL
observability](0005-fail-fast-atomic-runs-and-observability.md), surfaced by
`python -m cli runs --run` / `--table`).

## The rule, and where it lives

**Writer-stamped — not strategy-stamped, and not pipeline-stamped.**

- Not pipeline-stamped: a feed would have to remember to do it, and a feed that
  forgot would leave a table that looks stamped but is not.
- Not strategy-stamped: a strategy is *how* a load merges, and the provenance of
  a row is true regardless of which merge landed it. Stamping there would mean
  five implementations of one rule.
- Writer-stamped: a Writer knows exactly one relevant thing — that it is
  writing — and that is the altitude the rule belongs at. The framework
  deliberately has **no `Layer`** ([keep the framework
  domain-free](0013-keep-the-framework-domain-free.md)), so "stamp raw and
  silver but not gold" is not a rule the framework could even express.

Two consequences fall out for free:

- **No feed wires anything.** The value comes from the ambient run context
  (`current_context()`), so no `Store.writer(...)` signature changes and no
  pipeline threads a run id through its graph.
- **No validator ever sees the column.** Validation happens before the write, so
  a declared schema is checked against the feed's own columns. (`SchemaValidator`
  ignores extra columns regardless — "the contract is the declared fields only" —
  and `ColumnValidator` checks presence only, so nothing would break either way.)

**A write outside any run context still works**, leaving the column null. The
framework is import-only and its components are usable from a script or a test
without a run; a provenance stamp must not become a reason a write fails.

## Never part of a load strategy's comparison

A load strategy that compares an incoming row against the stored one must
exclude the provenance column.

This is not a nicety. `AppendOnly` decides unseen / unchanged / conflict across
every non-key column; if the provenance column participated, a
`sharepoint_cases` poll whose window overlaps the previous one would re-read
observations first landed by an earlier run, see a differing run id, and raise
`AppendOnlyConflictError` — turning routine operation into a hard failure. The
same exclusion applies to the "a batch that dropped a column the target holds is
refused" check: the column is the framework's, not the batch's.

## What the value means, per strategy

Because a strategy that never rewrites an unchanged row also never restamps it,
the column's meaning follows from the merge rather than being uniform:

| Strategy | The run id a row ends up holding |
|---|---|
| `Refresh` | the run that last rebuilt the table — which wrote **every** row in it |
| `AccumulateByRun` | the run that landed the logical run's rows |
| `AppendOnly` | the run that **first landed** this row; stable across re-drives |
| `UpsertStrategy` | the run that last **replaced** the row — a real rewrite, so the last writer is the honest answer |
| `InsertOrIgnore` | the run that first inserted it; an ignored row is not written, so it is not restamped |
| `InsertIfAbsent` | the run that first inserted it — "first seen" |

## The file writers do not stamp

`CsvWriter`, `ExcelWriter`, `JsonWriter` and `StdoutWriter` are excluded,
deliberately.

These produce **deliverables** — files that leave the system for a person or
another application ([report feeds published locally, delivered outside the
framework](0018-report-feeds-published-locally-delivered-outside-the-framework.md)).
Stamping them would add a column a recipient did not ask for and cannot
interpret, change the shape of a file whose columns are a contract with a
downstream consumer, and, for `StdoutWriter`, add noise to output whose only
purpose is being read by a human.

The rationale for the column is **internal lineage across the medallion
tables**. A file on its way out of the system is already answered by the run
record's `data_locations`, which records the path a write step touched — without
touching the file's contents; `python -m cli runs --run <id>` prints it.

The asymmetry is a decision, not an oversight. It is pinned by a test that runs
all four file Writers *inside* a run context and asserts the delivered columns
are exactly the ones they were handed, so a later change to the shared write
path cannot quietly start stamping delivered files. The rule to apply when
adding a Writer: **a Writer that persists to a table stamps; a Writer that
produces something a person or another system reads does not.**

## Accepted trade-off: `Refresh` loses byte-identical re-drive

`pipelines/sharepoint_cases/gold.py` guarantees that a re-drive of the same
window produces byte-identical gold — which is why `as_of` is the window end and
never `utcnow()`. Stamping `Refresh()` targets ends that: the data stays
identical, the provenance column differs.

Accepted, in favour of one uniform layer-agnostic rule over a special case for
one strategy. The property that still holds, and the one the docstrings and the
data dictionary now state, is: **a re-drive of the same window produces
identical data**, and the provenance column records which attempt produced it.

## One stamper, not three

`AccumulateByRun.stamp()` and the quarantine path both wrote `pipeline_run_id`
before this decision. Under this ADR the Writer-level stamp is the **single**
source of that column; both keep their own `logical_run_id` and `load_date`,
which are their own contracts (`logical_run_id` is the idempotency key
`AccumulateByRun` deletes by) and are not what this column is about.

## Considered options

- **Stamp in the pipeline, per feed** — explicit at the call site, but opt-in:
  the one feed that forgets produces a table that looks trustworthy and is not.
  Rejected.
- **Stamp in the load strategy** — closest to where the merge decides what to
  write, but multiplies one rule across five implementations and would have to
  be excluded from its own comparison inside the code doing the comparing.
  Rejected.
- **No column; rely on `data_locations` alone** — complete for a `Refresh`
  target, where the last committing run wrote every row, but silent about any
  accumulating table, which is precisely where the question is asked. Kept as
  the *table-level* answer, and as the whole answer for delivered files.
- **A separate lineage table keyed by row** — a row-to-run join table avoids
  touching the data tables at all, but doubles the write volume and needs a row
  identity every table would have to agree on. Rejected as disproportionate.

## Consequences

- Every table-backed write carries one extra `TEXT` column. On a `Refresh`
  target it is uniform per run and compresses to nothing; on an accumulating
  target it is one id per row.
- A consumer that does `SELECT *` sees the column. It is reserved: a feed must
  not declare a field of the same name for its own purposes.
- ~~The chunked write path stamps once per session, so every chunk of one drive
  carries the same value.~~ Withdrawn by
  [ADR-0028](0028-a-source-too-big-for-memory-is-narrowed-at-the-source.md):
  Writer chunk-write sessions were removed, so a Writer stamps once per `write`.
