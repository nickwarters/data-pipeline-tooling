# 58. A Maintainer can reopen a Completed Case

Date: 2026-10-06

## Status

Accepted. Settled with the owner on
[#1000](https://github.com/nickwarters/data-pipeline-tooling/issues/1000) and
reworked in review on #1012, which narrowed it to `Completed` Cases and removed
the history column it first added.

**Reverses D14 of [ADR-0023](./0023-case-lifecycle-and-reportable-milestone.md)**
(a Case never goes back to `In-progress` once it is reportable) for one actor and
one path: a Maintainer's **Reopen** on **Case Support**. Nothing else moves a
Case back, and a Case still cannot be reopened by the Reviewer, by a question
newly applying to it, or by an Appeal. Amends
[ADR-0021](./0021-versioned-question-bank-snapshots-for-completed-cases.md),
[ADR-0019](./0019-effective-outcome-column-for-corrected-reporting.md) and
[ADR-0026](./0026-amend-outcome-case-level-and-qa-retirement.md) where they treat the
reportable stamps as written once. Leaves [ADR-0030](./0030-action-centre-reason-flags-in-code-not-calculated-columns.md)'s
removal of the old `Reopened` reason standing.

## Context

ADR-0023 froze a Case at the reportable milestone and said why: actions are
already out with the Responsible Party, and yanking the Case back would strand
them. Nothing then had to undo a wrong result. When a Reviewer gets a reportable
Case wrong, the only fix beyond **Amend Outcome** (which changes the verdict but
not the Answers behind it) was to restore an older SharePoint version of the
item. That has been done once, and it:

- loses everything written after the restored version: remediation work, the
  Conversation, Notes, any Amended Outcome;
- loads the **currently published** Question Bank rather than the one the Case
  was reviewed against, because the stamp that pins it is among the things
  restored away;
- resurrects stale Action Centre flags;
- moves past throughput and stats figures silently; and
- leaves the notifications ledger holding the Case as already notified, so the
  Responsible Party is never told about the corrected actions.

**Case Support** exists so that support never restores a version or hand-edits an
item. Reopen is the action it was missing, and it is the highest-impact one:
it changes reported history. It is therefore recorded as a decision, with every
choice it forces written down.

Two constraints from the owner shape it. Every Cases list is provisioned by hand,
and prod and UAT already hold fifteen Case Types each, so a new column is thirty
manual list changes, on an air-gapped machine among others. And a Case whose
actions are out with the frontline must not be edited underneath them.

## Decision

### 1. Completed Cases only

A Case can be reopened from **`Completed`** only.

It cannot be reopened from `Actions In Progress`: its Remediation Actions have
been emailed to the Responsible Party, who may be working them, and the app
cannot recall an email. Reopening there would leave the frontline acting on
actions the Reviewer might be about to change. This is a known limitation (see
below), not a settled rule. Nor from `To-allocate` or `In-progress`
(nothing to reopen), from `Void` (void stays terminal), or while it has an **open
Appeal**: an Appeal is a Controls decision about the Outcome being reopened, and
resolving it against a Case that has moved on would write a verdict over Answers
that are about to change. The action card says which of these applies. A Case
whose Appeals are all resolved can be reopened.

### 2. One guarded write, and no new column

One `If-Match` guarded PATCH:

- **Clears the live stamps**: `reportableAt`, `completedAt`,
  `outcomeAtCompletion`, `hadRemediation`, `effectiveOutcome`,
  `effectiveHadRemediation`, `outcomeOverridden`, `amendedOutcome` and
  `remediationDueDate` are written `null`. A Case that has not been completed
  carries none of them (`outcomeOverridden` is `null`, not `false`, because
  `false` is what the milestone writes and a never-completed Case has no value).
  The next Send Actions or Complete Case stamps all of them afresh.
- **Moves the status to `In-progress`**, keeping the Assigned Reviewer and
  assignment time, the Answers and the Conversation.
- **Restarts the Due Date** at the moment of reopening plus the Case Type's
  review SLA in working days (the same rule the allocation claim applies), so
  the Reviewer is not handed an already-overdue Case.
- **Clears the awaiting-Responsible-Party flag** and its clock, which a
  Reviewer's Conversation message after completion sets again. Once reopened the
  Case is waiting on its Reviewer.

What the cleared stamps held is recorded in the **Support Log**, nowhere else.
The Support Log entry is written before the Case changes, as for every support
action, and lists every changed field with its before and after, so the
completion being set aside is in it field by field, with who reopened it, when
and why. The Support Log is already provisioned in every environment and landed
by the `case_support_log` pipeline. The Case row gains no column.

### 3. The Question Bank stays pinned

A reopened Case is `In-progress` yet still carries its `questionBankVersion`,
which an ordinary `In-progress` Case never does. `CaseLoader` pins the Case to
that version when the row is reportable **or** `In-progress` with a version
present, so a Question added to the live bank since cannot become applicable and
block re-completion, and the Answers are still read against the questions they
were given to. Completing again stamps the pinned version, not the live one. A
missing versioned export keeps the existing fallback to the live bank with its
warning, and then stamps the live version, which is the catalogue the Case was
actually completed against.

### 4. What the frontline sees while it is reopened

Every Answer and `remediationStatus` is kept as it is. A Completed Case's
actions, if it had any, were all resolved, so nothing is outstanding with the
Responsible Party. While the Case is `In-progress` the app treats it as any Case
not yet reportable: the Responsible Party's Summary and Remediation tabs are
hidden (both are gated on `reachedReportable`), and it is on no frontline
outstanding list, which shows `Actions In Progress` only. If the Reviewer's
correction raises new actions, Send Actions restamps `reportableAt` and
`remediationDueDate` and the Responsible Party is told about them (6).

### 5. Reporting: current-state semantics

Gold rebuilds from each Case's latest observation, so clearing the stamps means
the Case **drops out** of throughput and reviewer activity while it is
reopened, and **counts on its re-completion date** afterwards. No original-date
metric is built: the earlier stamps survive in silver `case_version`'s
observation history and in the Support Log. Throughput, reviewer activity and the
lifecycle legs say so in their data dictionaries, and a Case counted on one day
may be counted on a later one.

### 6. Notifications: a re-send notifies again

The Reportable-with-remediation ledger was keyed `(case_id, recipient)` because
`reportable_at` was frozen and a Case could become reportable only once. It is
now keyed `(case_id, recipient, reportable_at)`, so a Case sent again carries a
new `reportable_at` and is a new row, and the Responsible Party is told again.

The ledger's existing rows have no `reportable_at`, and a SQL migration on that
database cannot learn it: the value lives on the Case, in another subject's
database. The migration adds the column and leaves existing rows `NULL`, and the
pipeline adopts them on its first run: a legacy row stands for the
`reportable_at` its Case holds **now**, which was frozen before this change, so
it is the value the notification was sent for. The pipeline records that as a
stamped row. Treating `NULL` as "matches any `reportable_at`" would be simpler
and wrong: it would suppress the first re-send of exactly the Cases that were
notified before the change, which are the ones most likely to be reopened. One
window remains: a Case reopened and sent again **before** the pipeline's first
run after deploy is adopted at its new `reportable_at` and not re-notified.
Deploy the pipeline change before the Reopen action is first used.

### 7. The old columns stay unread

`Reopened` and `ReopenedAt` are not reused. ADR-0030 removed their read surface
because no transition wrote them, and a flag with a clock cannot say how often,
by whom or why. The Support Log answers "was it reopened, how often, by whom,
why" without them. The columns remain in the lists, unread.

### The Amended Outcome is cleared

An Amended Outcome is Controls' verdict on the completion being set aside, so it
is cleared with the other stamps and its record kept in the Support Log entry.
After re-completion Controls amends again if it is still wanted. The preview
says so.

## Considered and rejected

- **A `PreviousCompletions` history column on the Case row.** The first version
  of this decision appended each set-aside completion to a new JSON blob column.
  It was dropped: the column has to be provisioned by hand on every Cases list in
  every environment before the pipeline that names it deploys, and the Support
  Log already records the same values.
- **Not clearing the stamps.** Leaving `reportableAt` and `completedAt` set on an
  `In-progress` Case would keep it in completed counts while it is being
  corrected, and every reader that asks "has this reached the milestone" by its
  stamps would answer wrongly.

## Known limitation: Cases with actions out

A Case in `Actions In Progress` cannot be reopened. This is a limitation of this
decision, not a rule: a later need to correct such a Case is expected, and adding
it is left open until it has been thought through. In the app the frontline
would lose the Case while it was reopened (4), but actions already emailed
would still be worked against a Case the Reviewer was changing, so whatever adds
it has to say what happens to those actions and how the Responsible Party is
told. Until then such a Case is completed first, or corrected with Amend
Outcome.

## What this supersedes

- ADR-0023 D14 (no way back) now has one exception, the Maintainer's Reopen. A
  pointer sits beside it.
- The statement in several places that `reportableAt`, `completedAt` and the
  outcome snapshot are written once. They are written once **per completion**.
  The data dictionaries, the notifications ledger comment and the throughput
  comment that said otherwise are amended in this change; no code path is made
  dead.

## Consequences

- **Nothing to provision on the lists.** The write uses existing columns only,
  and the history goes to the existing Support Log list.
- **The history is not on the Case.** A Reviewer opening a reopened Case does not
  see its earlier completion; a Maintainer reads it in the Support Log on Case
  Support, and a report reads it from `case_support_log` or silver.
- **The reopened Case is a different row to a never-completed one.** It carries a
  `questionBankVersion` an `In-progress` Case would not otherwise have. Code that
  read "has a version" as "is reportable" is wrong; the loader now asks the
  status as well.
- **Counts move.** A figure published for a past day can change when a Case
  completed on it is reopened and completed again. That is the accepted cost of
  current-state reporting.
- **Reopen is a Maintainer's tool, not a workflow.** It is not offered to a
  Reviewer, and it takes a mandatory reason that lands on the Support Log.
