# 30. Action Centre reason flags live in code, stored as plain columns — no SharePoint calculated fields

Date: 2026-07-05

## Status

Accepted (supports [ADR-0007]; relates to [ADR-0008], [ADR-0009]; refines the reason
model introduced for the dashboard **Action Centre**, issue #287)

## Context

The dashboard Action Centre groups a Reviewer/Controls/Owner worklist by
**reason** — `overdue`, `awaitingResponsibleParty` (Awaiting Frontline), `reviewRequired`,
`hasOpenAppeal`, `reopened`. Each reason is queried by an **indexed** `ListCasesFilter`
so a group-header count is a cheap `$count` and the paged rows are a cheap `$top`/`$skip`
([ADR-0007]) — the client never holds the backlog. That requires each reason to be
expressible against a queryable column.

The obvious way to populate those columns is a **SharePoint calculated column** (a
formula evaluated by SharePoint). We reject that. The only maintenance surface available
to this team is the SharePoint **web UI** — there is no SharePoint Designer, no PnP, no
scripted provisioning. A calculated column's formula would therefore live **only in the
SharePoint UI**: un-versioned, un-reviewable, un-testable, and impossible to roll back or
diff. A logic change would be an out-of-band edit in a text box, invisible to the repo.
That is exactly the coupling the framework avoids — the deployed JS is the source
([ADR-0005]), and every non-trivial rule should be version-controlled and unit-tested
(CLAUDE.md).

## Decision

**No calculated columns.** Every reason flag is either computed in versioned JS or stored
as a **plain (dumb) column the app itself writes.** The five reasons split into two kinds:

### 1. Time-derived facts — never stored, computed from a raw date column

`overdue`, the SLA-breach flag, and every "N days" age are pure functions of a raw date
column plus the current clock. They are **not** stored:

- **`overdue`** is a query-time comparison against the plain `DueDate` column:
  a case is overdue when it is still `In-progress` and `DueDate` is in the past. In OData
  the filter is `DueDate lt <now> and Status eq 'In-progress'`; the mock client's
  `_predicate` applies the same rule; and `rowFromItem` **derives** the display flag from
  `Status` + `DueDate` rather than reading any `Overdue` column.
- **breach / day counts** are computed at render time in `waitingInfo()` /
  `daysWaiting()` in `action-centre-model.js`.

A stored `overdue` would be **wrong**: a case goes overdue at midnight with no edit, so a
persisted value would go stale until the next save. Computing on read is both correct and
fully in-repo.

### 2. State booleans — plain `Yes/No` columns, written by the app on transition

`awaitingResponsibleParty`, `hasOpenAppeal`, `reopened`, and `reviewRequired` are genuine
**states** that only change on an explicit lifecycle transition the app already performs
(send to Frontline, raise/close an Appeal [ADR-0027], reopen, submit for review). For
these:

- SharePoint holds each as a **plain indexed `Yes/No` column** (`AwaitingResponsibleParty`,
  `HasOpenAppeal`, `Reopened`, `ReviewRequired`), each paired with a plain `DateTime`
  clock column (`AwaitingSince`, `AppealRaisedAt`, `ReopenedAt`) for the age.
- The **app is the sole writer.** The derivation rule lives in versioned JS and is
  PATCHed as an ordinary field-level write in the same `SaveQueue` transaction as the
  transition ([ADR-0007] field-level PATCH, [ADR-0008] auto-save). SharePoint stores a
  dumb value; it evaluates no formula.
- OData `$count` / `$filter` work exactly as before, because these are real indexed
  columns — just app-written, not calculated.

### Net shape

Zero calculated columns. Every rule is either JS-computed on read (time-derived) or
JS-computed on transition and persisted as a plain value (state). SharePoint provisioning
is reduced to _"add these plain `Yes/No` + `DateTime` columns and index them"_ — a
point-and-click list-settings task with **no formula to maintain out-of-band**. All
reason logic versions with the code and is unit-tested to 100% coverage.

## Considered options

- **SharePoint calculated columns** — rejected: the formula would live only in the SP UI,
  un-versioned and un-testable, and this team has no scripted way to provision or diff it.
  A logic change could never be committed.
- **Compute every flag client-side from raw Case data** — rejected: to filter/count a
  reason the client would have to fetch the whole backlog and evaluate in JS, defeating
  the cheap `$count`/paged-`listCases` design ([ADR-0007]) and not scaling.
- **A scheduled job (Power Automate / timer) that writes the flags** — rejected for the
  same reason as calculated columns: the logic would live outside the repo, in a
  flow-designer surface this team can't version or test. Time-derived facts don't need it
  (computed on read); state flags are already written inline by the app on transition.

## Consequences

**Positive**

- **All reason logic is in the repo** — versioned, code-reviewed, unit-tested, diffable,
  revertable. Changing a rule is a normal PR + deploy, never a hidden SP-UI edit.
- Mock and HTTP clients apply the _same_ rule (e.g. `overdue`), so mock-first dev
  ([ADR-0009]) stays faithful.
- SharePoint provisioning is trivial and formula-free.

**Negative**

- **The app must not miss a transition.** Because a state flag is only correct if the app
  writes it, any code path that performs a lifecycle transition must set the paired
  flag+clock. A missed write is a silent staleness bug — mitigated by routing all
  transitions through the same helpers and covering them with tests.
- Back-filling flags for Cases created before a flag existed needs a **one-off migration**
  (a scripted PATCH pass), since there is no formula to populate them retroactively.

[ADR-0005]: ./0005-jsdoc-with-tsc-typecheck.md
[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0008]: ./0008-autosave-and-concurrency.md
[ADR-0009]: ./0009-mock-first-dev-loop.md
[ADR-0027]: ./0027-appeal-flow-journeyowner-controls.md
