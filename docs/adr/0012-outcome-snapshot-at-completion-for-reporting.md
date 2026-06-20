# 12. Outcome snapshot at completion for reporting

Date: 2026-05-17

## Status

Accepted

## Context

Management reporting (the `#/reports` feature group) needs to aggregate Cases by
their **Outcome** — e.g. "how many of my team's Cases passed in the last 12
months?". Per [ADR-0006] and CONTEXT.md, Outcome is a _computed_ property of a
Case, derived by running the Case Type's outcome function over the Case's
Answers. It is not stored as a column on the Case row.

The reporting feature fans out across one SharePoint list per eligible Case Type
([ADR-0004], [ADR-0007]) and filters server-side via `$filter`. To filter or
aggregate by Outcome this way, Outcome must exist as a queryable column on the
row. The alternatives — pulling every Case row in the date range and re-deriving
the Outcome client-side — break the bounded-query model: a 12-month RP-manager
report could pull thousands of full Answer blobs to count three numbers.

There is also a semantic question: if a Question Definition or the outcome
function changes after a Case is completed, should the reported pass/fail
numbers shift retroactively? For management reporting the answer is no — the
report should reflect what the system concluded at the time, not the result of
re-running today's logic against yesterday's Answers.

## Decision

When a Case transitions to **Completed Case** (the same write that stamps
`completedAt`), the outcome function runs and the result is persisted onto the
Case row as **`outcomeAtCompletion`** (string), alongside a derived
**`hadRemediation`** (boolean) flag.

- The live, in-progress Outcome remains computed as before — no change for the
  Reviewer-facing UI.
- `outcomeAtCompletion` is a **frozen snapshot**. It is never updated by later
  edits to Question Definitions, the outcome function, or — for already-completed
  Cases — the Answers themselves.
- `hadRemediation = true` iff any Answer on the Case has one or more attached
  Remediation Actions at completion time. By construction this is mutually
  exclusive with `outcomeAtCompletion = pass` (Remediation Actions only attach to
  failed Answers, and a failing Answer cannot yield a pass).
- Both fields are indexed in the SharePoint list schema for every Case Type, so
  report queries (filtered by `assignedReviewerManager`, `responsiblePartyManager`,
  and `completedAt`) remain server-side and bounded.

CONTEXT.md is updated to record that Outcome has a stored snapshot in addition
to its live computed form.

## Consequences

**Positive**

- Reports stay cheap: one `$filter` per eligible Case Type, no full-row fetches,
  no client-side re-derivation.
- Historical numbers are stable across Question Definition edits — matches the
  reporting intent.
- No new list or sync job: the snapshot lives on the existing Case row,
  consistent with [ADR-0007].

**Negative**

- Mild conflict with [ADR-0006]'s "outcome is code, not data" framing — partly
  resolved by treating the snapshot as a _historical record_ distinct from the
  live Outcome, but readers will need to understand both exist.
- Provisioning every Case Type list now requires two extra indexed columns;
  Maintainers must include them when adding a Case Type.
- If the outcome function had a bug at completion time, the snapshot bakes that
  bug in. A future "rebuild snapshots" tool may eventually be needed — out of
  scope here.

[ADR-0004]: ./0004-case-type-config-as-js-modules.md
[ADR-0006]: ./0006-applicability-graph-and-outcome-function.md
[ADR-0007]: ./0007-case-storage-shape.md
