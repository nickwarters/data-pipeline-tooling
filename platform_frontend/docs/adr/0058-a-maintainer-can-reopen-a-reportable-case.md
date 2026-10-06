# 58. A Maintainer can reopen a Reportable Case

Date: 2026-10-06

## Status

Accepted. Settled with the owner on
[#1000](https://github.com/nickwarters/data-pipeline-tooling/issues/1000).

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

## Decision

### 1. From which statuses

A Case can be reopened from **`Completed`** and from **`Actions In Progress`**.

It cannot be reopened from `To-allocate` or `In-progress` (nothing to reopen),
from `Void` (void stays terminal), or while it has an **open Appeal**: an
Appeal is a Controls decision about the Outcome being reopened, and resolving it
against a Case that has moved on would write a verdict over Answers that are
about to change. The action card says which of these applies. A Case whose
Appeals are all resolved can be reopened.

### 2. The snapshot: a `PreviousCompletions` history

One `If-Match` guarded PATCH does all of this:

- **Appends a Previous Completion** to a new JSON blob column
  `PreviousCompletions` (row field `previousCompletions`, an array, oldest
  first, never edited). An entry is `reopenedAt`, `reopenedBy` (bare account
  login), `reason`, `fromStatus`, and the stamps the Case carried:
  `reportableAt`, `completedAt`, `outcomeAtCompletion`, `hadRemediation`,
  `effectiveOutcome`, `effectiveHadRemediation`, `outcomeOverridden`,
  `questionBankVersion`, `remediationDueDate` and `amendedOutcome`.
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
- **Clears the awaiting-Responsible-Party flag** and its clock. A Case in
  `Actions In Progress` is awaiting its Responsible Party; once reopened it is
  waiting on its Reviewer.

The history lives on the row rather than only in the Support Log because the
Support Log is a Maintainer's audit trail and the history is Case data: it is
what a Reviewer or a report would read, and it is landed by the pipelines like
any other column. The Support Log entry, written first, lists every changed
field with its before and after as for every support action.

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

### 4. Remediation already sent

Every Answer and `remediationStatus` is kept as it is. Nothing is cancelled and
nothing is asked per action. A Reopen from `Actions In Progress` returns a Case
whose actions the Responsible Party was already working; if the Reviewer changes
an Answer, the normal rules for a remediation decision apply. When the Case is
sent again, Send Actions restamps `reportableAt` and `remediationDueDate` as it
does today, so the Responsible Party's clock restarts from the re-send.

### 5. Reporting: current-state semantics

Gold rebuilds from each Case's latest observation, so clearing the stamps means
the Case **drops out** of throughput and reviewer activity while it is
reopened, and **counts on its re-completion date** afterwards. No original-date
metric is built: the first completion is in `PreviousCompletions`, and the
history of observations already records that the Case was once `Completed`.
Throughput, reviewer activity and the lifecycle legs say so in their data
dictionaries, and a Case counted on one day may be counted on a later one.

`PreviousCompletions` is landed raw and silver as text like the other blobs and
is deliberately not republished on `case_current`: a Detail Table for it is the
right home for any measure over reopens, and no measure is asked for yet.

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
by whom or why. The history answers "was it reopened, how often, by whom, why"
without them. The
columns remain in the lists, unread.

### The Amended Outcome is archived

An Amended Outcome is Controls' verdict on the completion being set aside, so it
moves into the history entry and the live `amendedOutcome` is cleared. After
re-completion Controls amends again if it is still wanted. The preview says so.

## What this supersedes

- ADR-0023 D14 (no way back) now has one exception, the Maintainer's Reopen. A
  pointer sits beside it.
- The statement in several places that `reportableAt`, `completedAt` and the
  outcome snapshot are written once. They are written once **per completion**.
  The data dictionaries, the notifications ledger comment and the throughput
  comment that said otherwise are amended in this change; no code path is made
  dead.

## Consequences

- **A column to provision.** `PreviousCompletions` (multiple lines of text,
  unindexed) must exist on every Cases list **before** the pipeline is deployed,
  because a missing listed column fails the poll. Provisioning order: columns,
  then the pipeline migrations and deploy, then the frontend.
- **The reopened Case is a different row to a never-completed one.** It carries a
  `questionBankVersion` and `previousCompletions` an `In-progress` Case would not
  otherwise have. Code that read "has a version" as "is reportable" is wrong; the
  loader now asks the status as well.
- **Counts move.** A figure published for a past day can change when a Case
  completed on it is reopened and completed again. That is the accepted cost of
  current-state reporting.
- **Reopen is a Maintainer's tool, not a workflow.** It is not offered to a
  Reviewer, and it takes a mandatory reason that lands on both the history and
  the Support Log.
