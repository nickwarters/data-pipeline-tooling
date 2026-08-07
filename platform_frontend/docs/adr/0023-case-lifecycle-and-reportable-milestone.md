# 23. Multi-stage case lifecycle and the "reportable" milestone

Date: 2026-07-01

## Status

Accepted, as amended 2026-08 (#621) — an unset Responsible Party now disables the
completion button rather than hiding it — and as further amended 2026-08 (#677): the
Responsible Party is asked for, and gates completion, only where some failed Answer's
"Is remediation required?" decision is `yes` (amends [ADR-0012], [ADR-0016],
[ADR-0021]; storage in [ADR-0007])

## Context

Today a Case has a binary lifecycle: `In-progress → Completed` (`CaseMachine`,
CONTEXT.md "Completed Case"), and completion means "every Applicable Question has an
Answer." Tester feedback requires a **remediation loop** between the Reviewer finishing
their assessment and the Case actually closing: when failures carry corrective actions,
those actions are _sent to the Responsible Party_, worked, and only then is the Case
completed.

The recent pivot already leaked a third status value (`'Actions In Progress'` appears in
`SectionConfig.allowMessagesWhen` and the example config) but `CaseRow.status` is still
`'In-progress' | 'Completed'` and `CaseMachine` has no transition into it. This ADR
makes the intermediate state real and — critically — defines the single milestone at
which a Case's Answers **freeze** and its Outcome **snapshots**: **reportable**.

## Decision

### Status set

`CaseRow.status` becomes exactly (casing per grill D4):

```
'In-progress' | 'Actions In Progress' | 'Completed'
```

### The state machine

```
In-progress ──(Issues complete, no actions → "Complete Case")──────────► Completed
 │
 └──(Issues complete, ≥1 action → "Send Actions")──► Actions In Progress
 │
 (Remediation tab: every sent │
 action complete / cancelled+ │
 reason → "Complete Case") │
 ▼
 Completed
```

- **The Summary bottom button** is one control with two labels, driven by whether any
  **Remediation Action** exists across the Case's failed Answers:
- **≥1 action ⇒ "Send Actions"** → transition to `Actions In Progress`.
- **0 actions ⇒ "Complete Case"** → transition straight to `Completed`.
- The button is **enabled** only when the **Issues Section is complete**: every failed
  Answer's _visible required_ Issue Capture Fields are filled ([ADR-0017]/[ADR-0020]
  gate, unchanged) **and**, _where at least one failed Answer's "Is remediation
  required?" decision is `yes`_, the Responsible Party has been set ([ADR-0024], set at
  the bottom of the Issues tab). Where no failed Answer requires remediation the field is
  not rendered at all and does not gate anything — a Case with nothing to send has nobody
  to send it to, and gating on an invisible field left the button permanently disabled
  against a reason no Reviewer could act on (#677). Where it does apply, an unset
  Responsible Party does not hide the button: it is shown disabled, carrying the reason
  that names the field, so the Reviewer is told what is outstanding rather than left with
  no control at all.
- On the actions path, the Case cannot reach `Completed` until the **Remediation tab is
  complete** — every sent action is `complete` or `cancelled` (with a cancellation
  reason) ([ADR-0024]). This gate is **inert on the no-actions path**.

### The "reportable" milestone (the freeze point)

A Case becomes **reportable** at the first of these to occur:

- **Send Actions** (actions path — the case enters `Actions In Progress`), or
- **Complete Case** on the no-actions path (the case enters `Completed`).

Equivalently, `reportable ⟺ status ∈ { 'Actions In Progress', 'Completed' }`.

At the reportable moment, **in one ETag-guarded PATCH** ([ADR-0008]):

1. Stamp **`reportableAt`** (ISO timestamp) on the Case row.
2. **Freeze the Answers** — from here a newly-applicable Question Definition **no longer
   reopens** the Case (D14). While still `In-progress` (pre-reportable), a new
   applicable Question applies and blocks the button exactly as today.
3. Stamp the **Outcome snapshot**: `outcomeAtCompletion` + `hadRemediation` are computed
   here (D15), not deferred to final completion. (Answers are frozen, so the value is
   final.) `effectiveOutcome` / `effectiveHadRemediation` initialise equal to it
   ([ADR-0019]).
4. Stamp **`questionBankVersion`** (the as-reviewed bank hash) here rather than at
   `Completed` ([ADR-0021] amended — the freeze it protects now happens at reportable).
5. On the actions path only, stamp the **remediation due date** ([ADR-0024]).

`completedAt` is stamped **only at the final `Completed` transition**. On the no-actions
path `reportableAt === completedAt`; on the actions path `reportableAt` (Send Actions)
precedes `completedAt` (Complete Case) by the remediation period.

### Naming note

The snapshot field keeps its name `outcomeAtCompletion` for storage compatibility, but
"completion" now means **the reportable moment**. CONTEXT.md and [ADR-0012] are annotated
accordingly rather than renaming a provisioned column.

### `CaseMachine`

`transitionToCompleted` is joined by `transitionToActionsInProgress` (the reportable
snapshot + due date + status) and a final-complete transition (status + `completedAt`,
no re-snapshot). `canComplete` / `canAttribute` stop hard-coding `status ===
'In-progress'` and instead key off the milestone (`reportable` gates editability).

## Considered options

- **Snapshot the outcome at final `Completed` on both paths** — rejected: on the actions
  path the answers are already frozen at Send Actions, so deferring the snapshot buys
  nothing and leaves a window where "reportable" data isn't yet stamped for reporting.
- **A separate boolean `isReportable` column instead of deriving from status** —
  rejected: `reportableAt` (a timestamp we need anyway) plus the status set is
  sufficient; a redundant boolean can desync.
- **Let new applicable questions reopen a case even after Send Actions** — rejected
  (D14): actions are already out with the Adviser; yanking the case back to In-progress
  mid-remediation is disruptive and would strand sent actions.

## Consequences

**Positive**

- A clean remediation loop with a well-defined freeze point shared by the UI and
  reporting; "reportable" gives a single, queryable milestone distinct from "closed."
- Reporting ([ADR-0012]/[ADR-0019]) can count a Case the moment it is reportable, which
  matches how the business thinks about throughput (work handed off = done reviewing).

**Negative**

- New provisioned columns per Case Type list: `reportableAt` (and `remediationDueDate`,
  [ADR-0024]). Maintainers must add them.
- Every place that assumed `status === 'Completed'` as the freeze/gate (section access,
  Summary derivation, question-bank snapshot resolution) must switch to the `reportable`
  predicate. Blast radius is real but mechanical.
- The `outcomeAtCompletion` name now slightly misleads (it is "at reportable"); mitigated
  by documentation rather than a risky column rename.

[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0008]: ./0008-autosave-and-concurrency.md
[ADR-0012]: ./0012-outcome-snapshot-at-completion-for-reporting.md
[ADR-0016]: ./0016-summary-section-replaces-outcome-tab.md
[ADR-0017]: ./0017-configurable-remediation-details.md
[ADR-0019]: ./0019-effective-outcome-column-for-corrected-reporting.md
[ADR-0020]: ./0020-unified-issue-capture-engine.md
[ADR-0021]: ./0021-versioned-question-bank-snapshots-for-completed-cases.md
[ADR-0024]: ./0024-remediation-tracking-tab.md
