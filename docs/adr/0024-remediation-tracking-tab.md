# 24. Remediation tracking tab: per-action completion, split from Issue capture

Date: 2026-07-01

## Status

Accepted (resolves the parked #144; amends [ADR-0007], [ADR-0011], [ADR-0016]; builds on
[ADR-0020])

## Context

The standalone **Remediation** tab has been parked since the Jun 2026 restructure (#144,
"purpose undefined"). Today the single Section key `remediation` **is** the "Issues" tab
— where a Reviewer captures failed-Answer detail and **Remediation Actions** via the
[ADR-0020] capture engine (CONTEXT.md: "Issues = UI label for the Remediation Section").

Tester feedback defines the Remediation tab's real purpose: after actions are **sent** to
the Responsible Party ([ADR-0023] `Actions In Progress`), the Reviewer tracks each
action to a resolution — **complete**, or **cancelled** with a justification. This is a
*different activity* from capturing actions, so "Issues" and "Remediation" become **two
Sections**, and a Remediation Action grows from a plain string into a stateful record.

## Decision

### Two Sections

- **`issues`** — *capture*. Failed Answers + their Issue Capture Groups/Fields
  ([ADR-0020]) + the Responsible Party selector (below). Reviewer-editable **until the
  Case is reportable** ([ADR-0023]). This is today's `remediation` Section, **renamed to
  `issues`** to match its UI label; CONTEXT.md's "Issues = the Remediation Section" claim
  is retired.
- **`remediation`** — *tracking* (the new tab). Lists every **sent** Remediation Action
  across the Case; the Reviewer sets each action's resolution. Meaningful only once
  actions have been sent.

### Remediation Action becomes an object (D9)

A Remediation Action is elevated from `string` to:

```js
/** @typedef {{
 *   id: string,
 *   text: string,
 *   status: 'pending' | 'complete' | 'cancelled',
 *   cancelReason?: string   // required iff status === 'cancelled'
 * }} RemediationAction */
```

Actions remain stored where [ADR-0020] puts them — the `actions`-typed Issue Capture
Field value on the failed Answer (`Answer.capture[fieldKey]`), now an array of
`RemediationAction` objects instead of strings. No second source of truth; the
Remediation tab reads and writes the same Answer records the Issues tab authored.

### Due date is a single case-level field (D9)

There is **one** `remediationDueDate` on the Case row (not per action), stamped when the
Reviewer clicks **Send Actions** = `reportableAt` + **10 working days** ([ADR-0025] for
the working-day calculation). All sent actions share it.

### Completion gate

- **`status: 'cancelled'` requires a non-empty `cancelReason`** — a hard field
  validation.
- **The Remediation tab is "complete"** when every sent action is `complete` or
  `cancelled(+reason)`. This gates the final **"Complete Case"** button, **but only on
  the actions path** ([ADR-0023]); on the no-actions path there is no Remediation tab
  content and the gate is inert.

### Access & visibility ([ADR-0011])

- **Assigned Reviewer**: `edit` while `status === 'Actions In Progress'`; `read-only`
  once `Completed`; the tab is `hidden` when the Case has no actions at all.
- **Responsible Party (Adviser)**: `hidden`. The RP does the remediation work
  off-system and communicates via the **Conversation**; the Reviewer records the
  outcome (D10). The RP never edits the Remediation tab.
- Other reviewers / Case Type Owner / Journey Owner / Controls: `read-only`.
- **Summary inclusion**: `showInSummary: true` — the Summary's failed-Answer block shows
  each action's `status` (+ `cancelReason`) and the case `remediationDueDate`.

### Lifecycle

Action `status`/`cancelReason` follow the failed-Answer lifecycle ([ADR-0020]/[ADR-0013]):
**stripped** if the Answer stops being a failure (before reportable), **frozen** once the
Case is reportable — except that the resolution fields (`status`, `cancelReason`) are the
*only* part written **after** reportable, during `Actions In Progress`. They freeze at
final `Completed`.

## Considered options

- **Keep one `remediation` Section, mode-switch by status** — rejected: capture and
  tracking have different fields, different editors, and different access rows; one
  Section with two personalities is harder to reason about than two Sections.
- **Per-action due dates** — rejected (D9): the business tracks a single case-level SLA
  from the send date; per-action dates add storage and UI for no stated need.
- **A parallel `remediationStatus` map keyed by action id on the Answer** — rejected:
  splits an action's identity from its state across two structures; putting `status`
  on the action object keeps one record per action.
- **Let the Responsible Party mark their own actions done** — rejected (D10): the
  Reviewer owns the record of truth; the RP's channel is the Conversation.

## Consequences

**Positive**

- #144 is resolved with a concrete, testable definition.
- One record per action carries both its text and its resolution; Issues and Remediation
  tabs and the Summary all read the same data.

**Negative**

- **Storage migration**: existing `string[]` actions must be read as `RemediationAction`
  objects. The [ADR-0020] `actions` field shape changes; a compatibility read (coerce
  `string` → `{ id, text, status: 'pending' }`) is needed for any pre-existing data.
- Splitting `remediation` → `issues` + `remediation` touches the Section enum, the
  access matrix, `showInSummary`, `SECTIONS`, and every reference to the old key.

[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0011]: ./0011-section-level-role-based-access.md
[ADR-0013]: ./0013-attributed-party-identity-in-answer-json.md
[ADR-0016]: ./0016-summary-section-replaces-outcome-tab.md
[ADR-0020]: ./0020-unified-issue-capture-engine.md
[ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
[ADR-0025]: ./0025-working-day-sla-due-dates.md
