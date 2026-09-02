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

Seven reasons, in `src/lib/void-reasons.js`, keyed and frozen. A Case Type may
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

### `Other` is a reason that is not chosen until it is written

`other` is the seventh key and the only one that names nothing on its own. A
closed vocabulary that a Reviewer cannot escape gets escaped anyway — through
the nearest-fitting key, which then means two things in the report — so the
vocabulary carries the escape hatch explicitly rather than leaving it to be
improvised inside `no-evidence`.

Because the key says nothing, picking it is not finishing the choice: the panel
offers a free-text box **only** under `other`, and the confirm stays dead until
something is written in it. `voidControl` reports `noteRequired` and folds the
empty note into the same `disabled` it already computed for "no reason chosen",
so there is one gate rather than two, and `voidPatch` produces no patch at all
until it opens.

The box appears and disappears with the reason rather than being disabled in
place, and the store empties it whenever the reason changes — including on the
panel close that already forgets the reason. Both halves say the same thing: a
note describes the reason it was written under and no other. `voidControl` also
reports an empty note for any reason that does not need one, so the two guards
are belt and braces rather than one guard the other depends on.

The note is display copy, not a second key. The report still groups on
`voidReason`, so every `other` void is one bucket however many different notes
sit beneath it — which is what keeps the cross-Case-Type grouping the argument
above rests on intact. `voidReasonText(key, note)` is what a reader renders: the
label, and the words behind it when there are any.

### Storage

Four new columns on every `Cases-{slug}` list: `VoidedAt` (Date and Time,
**indexed**), `VoidReason` (single line of text), `VoidReasonNote` (multiple
lines of text) and `VoidedBy` (**Person or Group**). `Status` gains `Void` as a
fourth choice value.

`VoidReasonNote` is written trimmed, or as an explicit `null` under every keyed
reason — never an empty string a reader would have to interpret. It is never
filtered or ordered on, so it needs no index.

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
- **`VoidReasonNote` is a provisioning pre-requisite alongside the other three.**
  A list that has the `Other` reason available in the app but not the column
  behind it takes the void and loses the only thing that said why — the reason
  key alone means nothing. Stated in
  [`docs/case-type-onboarding.md`](../case-type-onboarding.md).
- **The note flows through the pipelines as far as a Case, and no further.**
  `sharepoint_cases` lands it beside `VoidReason` — raw, silver and
  `case_current`, with the additive migrations that go with a shape change —
  because a voided Case whose reason is `other` says nothing at all without it.
  It stops there: `cora_platform_metric`'s `case_void_monthly` groups on
  `void_reason`, and a free-text sentence is not a dimension — grouping on it
  would give one row per distinct note. Recorded in both data dictionaries.
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
- **The remediation clock stops on both terminal statuses.**
  `isRemediationOverdue` asked "is this not Completed?"; it now names
  `Completed` and `Void` — a closed Case has no clock left to breach, however
  it closed. Behaviour for the four real statuses is exactly what the old test
  gave three. Converting the guard to an allow-list (so an empty or
  unrecognised status also sheds the clock) is a semantics change in its own
  right and is deliberately not part of this decision — it is tracked as #365.
- **Live manager reads inherit the allocation-cache failure mode.** They are
  scoped by `assignedReviewerManager`; allocation now stamps the field when the
  manager lookup succeeds and writes explicit `null` when it does not. Existing
  or unresolved rows can therefore still be absent from `#/my-team` and
  `#/team-cases`. Settled manager history is attributed by the Staff Hierarchy,
  not this operational field.
- **`transitionToVoid` does not clear `assignedReviewer`.** A voided Case stays
  attributed to the Reviewer who held it, which is what makes the report
  answerable; it also means a voided Case still names a Reviewer in every table
  that shows one.

[ADR-0021]: ./0021-versioned-question-bank-snapshots-for-completed-cases.md
[ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
[ADR-0031]: ./0031-scaling-against-the-list-view-threshold.md
[ADR-0038]: ./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md
[ADR-0040]: ./0040-case-tables-are-framework-owned.md
