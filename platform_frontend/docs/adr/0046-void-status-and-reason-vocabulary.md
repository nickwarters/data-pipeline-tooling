# ADR-0046: A Case is voided with a reason, and voiding is a status

- Status: Accepted
- Date: 2026-08-04
- Extends: [ADR-0023](./0023-case-lifecycle-and-reportable-milestone.md),
  [ADR-0007](./0007-case-storage-shape.md),
  [ADR-0021](./0021-versioned-question-bank-snapshots-for-completed-cases.md)
- Applies: [ADR-0031](./0031-scaling-against-the-list-view-threshold.md)
- Leaves unchanged: [ADR-0038](./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md)

## Context

Some Cases should never be reviewed to a conclusion. The same complaint is
raised twice, a Case is opened against the wrong journey, the file the review
depends on cannot be produced, the business withdraws it. Today a Reviewer has
two ways out, and both are wrong: leave the Case `In-progress` for ever, where
it ages into the overdue counts and the Action Centre, or complete it with a
fabricated Outcome that then counts as reviewed work.

The lifecycle ([ADR-0023]) is a two-path description — `In-progress` →
`Actions In Progress` → `Completed`, or straight to `Completed` — and both paths
pass through the **reportable milestone**, where the Answers freeze and the
Outcome is snapshotted. Abandoning a Case is neither path: the Answers must
freeze, but no Outcome may be stamped.

## Decision

**A fourth Case status, `Void`, terminal, always carrying a Void Reason.**

### A status, not a flag

A boolean `isVoid` beside the status would leave six independent rules — the
Section access matrix, the completion gate, the overdue clock, the Action Centre
queries, the dashboards, the manager reports — each reading a flag they were
never written to consider. Each of those is an allow-list over statuses
(`OVERDUE_STATUSES`, `allowMessagesWhen`, the `status:` filters behind the
worklists), so a new _status_ is absorbed by every one of them by construction:
nothing that lists the statuses it wants silently acquires a new one. A flag
would have to be added to six server-side filters by hand, and a missed one
shows a voided Case as live work with no error anywhere.

### Not `Completed`

Reusing `Completed` was rejected outright. `cora-owner-summary.js` counts
`{ status: Completed, completedAfter }` as an Owner's completed volume, so voids
would inflate reviewed-work numbers; the `appealRequest` matrix cell opens the
Appeal form to the configured raiser on a `Completed` Case, so a voided Case
would become appealable; and every downstream reader of the row — every export,
every count, every badge — would be told the review reached a conclusion it
never reached.

### The freeze and the milestone are two questions, not one

`isReportable(status)` used to answer both "are the Answers frozen?" and "was a
snapshot taken?", because until now those coincided. Voiding separates them, so
the two questions are now asked separately:

- **`isFrozen(status)`** — reportable **or** Void. Editability asks this: the
  Questions and Issues Sections, and `CaseMachine`'s `canComplete` /
  `canEditIssues`.
- **`reachedReportable(caseRow)`** — reportable, **or** Void with a
  `reportableAt`. Everything that reads the _snapshot_ taken at that milestone
  asks this: the stamped Question Bank version ([ADR-0021]), the frozen Outcome
  in the Summary, the Remediation tab's rows, and the Responsible Party's sight
  of the Summary.
- **`isReportable(status)`** keeps its original meaning and three callers: the
  Amend Outcome cell, `CaseMachine.reportable`, and the Outcome snapshot itself.

A Case voided from `Actions In Progress` therefore keeps everything it was
stamped with; a Case voided from `In-progress` shows no Outcome block at all,
rather than a live computation over a half-answered Case.

### The Void Reason vocabulary is framework-owned

Six reasons, in `src/lib/void-reasons.js`, keyed and frozen. A Case Type may
narrow the list it offers (`voidReasons`), but that narrowing is display-only:
storage validates against the whole vocabulary. The manager report groups
reasons **across** Case Types, and it can only do that while a key means the
same thing everywhere — which is the same argument that makes Case tables
framework-owned ([ADR-0040]).

### Voiding is a two-step, Reviewer-only action

Only the Assigned Reviewer of a live Case may void it, and the control is a
disclosure button plus a panel naming the consequences and demanding a reason.
A terminal action with no way back does not sit behind one click. There is no
un-void: correcting a mistaken void means raising the Case again.

### Storage

Three new columns on every `Cases-{slug}` list: `VoidedAt` (Date and Time,
**indexed**), `VoidReason` (single line of text) and `VoidedBy` (**Person or
Group**). `Status` gains `Void` as a fourth choice value.

`VoidedBy` is a Person column, the same as the four other people on a Case row:
expanded on read and reduced to a bare account name, and resolved to a numeric
id on write via the same `_ensureUserId` round trip `AssignedReviewer` and
`ResponsiblePartyManager` go through. It is never matched against the signed-in
user — nothing gates on who voided a Case — so the column earns its keep only
as an audit stamp and the manager report's grouping key, but a directory
identity is still what it names, and every other identity on the row is stored
the same way; a plain-text divergence would have meant the report joining a
name to an id through a second mechanism instead of the one every other person
column already uses.

## Consequences

- **`VoidedAt` must be indexed at list creation.** ([ADR-0031]) The manager's
  void report leads with a 30-day `VoidedAt` window, because `Status eq 'Void'`
  alone matches every Case ever voided and only grows. A `Cases-{slug}` list
  already past the List View Threshold cannot be given the index afterwards, so
  on such a list the report is served unindexed. Stated in
  [`docs/case-type-onboarding.md`](../case-type-onboarding.md).
- **Adding `Void` to the `Status` choice column is a deploy pre-requisite.**
  SharePoint rejects a PATCH writing a choice value the column does not offer,
  so voiding fails on every list that has not been updated, in both
  environments.
- **Voiding freezes the Conversation, as a framework rule.** A terminal status
  (`Void` or `Completed`) resolves the Conversation read-only for every
  participant, regardless of the Case Type's `allowMessagesWhen` gate — the gate
  chooses when the thread is open during a live review, not whether it survives
  the end of one. (Originally this leaned on Complaints' gate happening to
  exclude the terminal statuses; a Case Type declaring no gate would have kept
  the thread writable on a closed Case, so the rule was made structural.)
  Voiding a Case with remediation in flight therefore silently ends posting for
  the Responsible Party who was working on it. That is correct for a terminal
  state — but nothing is auto-posted to the thread to say so, so the Reviewer
  who voids a Case mid-remediation should say so in the Conversation first.
- **The remediation clock became an allow-list.** `isRemediationOverdue` asked
  "is this not Completed?"; it now asks "is this `In-progress` or
  `Actions In Progress`?". Behaviour is identical for the four real statuses, but
  a row whose status is empty or unrecognised is no longer overdue where it
  previously would have been. Expected: the client defaults an absent `Status`,
  and a status nobody has considered should not inherit a clock.
- **The manager report inherits the empty-team failure mode.** It is scoped by
  `assignedReviewerManager`, and nothing writes that field ([ADR-0038]), so a
  manager whose team's rows carry no value sees an empty table — exactly as
  `#/my-team` and `#/team-cases` already do. Stated, not fixed here.
- **`transitionToVoid` does not clear `assignedReviewer`.** A voided Case stays
  attributed to the Reviewer who held it, which is what makes the report
  answerable; it also means a voided Case still names a Reviewer in every table
  that shows one.

[ADR-0021]: ./0021-versioned-question-bank-snapshots-for-completed-cases.md
[ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
[ADR-0031]: ./0031-scaling-against-the-list-view-threshold.md
[ADR-0038]: ./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md
[ADR-0040]: ./0040-case-tables-are-framework-owned.md
