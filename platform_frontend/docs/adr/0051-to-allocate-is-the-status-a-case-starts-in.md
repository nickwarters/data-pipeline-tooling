# ADR-0051: `To-allocate` is the status a Case starts in, and the allocation pot is a status

- Status: Accepted
- Date: 2026-08-19
- Extends: [ADR-0023](./0023-case-lifecycle-and-reportable-milestone.md),
  [ADR-0046](./0046-void-status-and-reason-vocabulary.md)
- Applies: [ADR-0031](./0031-scaling-against-the-list-view-threshold.md)
- Leaves unchanged: [ADR-0038](./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md)

## Context

A Case waiting for a Reviewer and a Case a Reviewer is halfway through were the
same status. Both were `In-progress`; what told them apart was whether the
`AssignedReviewer` person column happened to be empty.

Three things follow from that, and all three are costs:

**The pot could only be read by elimination.** `getUnassignedCases` asked each
list for every `In-progress` row and then discarded, in the browser, the ones
that already had a Reviewer. To find the handful of Cases nobody has taken, it
pulled a Case Type's entire live workload across the wire. The read carried no
`$top`, so it followed every page. The Case Types where the pot matters most are
the high-volume ones, which is exactly where that read is largest and where the
List View Threshold ([ADR-0031]) is least forgiving. `$count` is not available
to us — this is SharePoint Subscription Edition, not SharePoint Online — so
"just count it cheaply" was never on the table either.

**Allocation and reassignment were indistinguishable.** Naming a Reviewer on a
Case meant one thing when the field was empty and another when it was not, and
nothing in the row recorded which had happened.

**Every lifecycle rule keyed on `In-progress` silently meant two things.**
Section access, editability, the review clock, the Action Centre — each was
written for "a Reviewer is working this" and each also matched "nobody has
touched this".

## Decision

**A fifth Case status, `To-allocate`, the status every Case is created in, which
the allocation claim replaces with `In-progress`.**

### The pot is a value on an indexed column

The candidate read is now a single equality predicate on `Status`, which is
already indexed on every `Cases-{slug}` list. It returns the rows it wants
instead of the rows it must filter. Nothing re-checks the Assigned Reviewer
afterwards: asking for a status and then not trusting the answer would restore
the scan this decision removes.

This is the same reasoning [ADR-0046] used for `Void`. A status is absorbed by
every allow-list over statuses by construction — `OVERDUE_STATUSES`,
`allowMessagesWhen`, the `status:` filters behind the worklists — so a rule that
names the statuses it wants does not silently acquire a new one. The pot as a
_flag_ would have had to be added to each of those by hand.

### The lifecycle move rides in the claim's own PATCH

The claim writes `status`, `assignedReviewer`, `assignedReviewerManager` and
`dueDate` in one PATCH under one `If-Match`. There is no window in which a row
holds a Reviewer while still advertising itself as unclaimed.

It is deliberately **not** written by `withAssignmentStamp`, the shared rule that
pairs `assignedAt` with `assignedReviewer`. Naming a Reviewer is also how a Case
is _reassigned_ mid-review, and a reassignment must leave the status where it is.
Only the claim moves the status, so only the claim writes it.

### Nothing returns a Case to `To-allocate`

It is an entry state, not a state a Case can be put back into. Handing an
`In-progress` Case to a different Reviewer is reassignment.

_Amended 2026-10: see [the amendment below](#amendment-2026-10--a-maintainer-can-un-assign-an-in-progress-case);
a Maintainer's Un-assign is now the one way back._

### No review clock runs against it

A `To-allocate` Case carries no `DueDate` — the review SLA is stamped at the
claim, from the Case Type's working-day SLA. `OVERDUE_STATUSES` is `In-progress`
alone, so an unclaimed Case cannot be overdue or breaching, however long it
waits. Whether the _pot_ ageing should be visible somewhere is a separate
question this ADR does not answer.

## Consequences

- **Provisioning is a hard prerequisite.** `To-allocate` must be added to the
  `Status` choice column on every `Cases-{slug}` list, in both prod and UAT,
  before anything writes it — SharePoint rejects a PATCH carrying a value the
  column does not offer. Unlike `Void`, a missing value here does not degrade one
  feature: nothing can create a Case, and the pot reads empty. See
  [the onboarding checklist](../case-type-onboarding.md).
- **No backfill was needed.** Nothing is live yet. Had it been, every existing
  unclaimed row would have needed moving from `In-progress` to `To-allocate`,
  because the pot read no longer finds them by an empty Reviewer.
- **The pipeline's status vocabulary moved with it.** The Sync feed validates
  `status` against a declared `OneOf`, so an unrecognised value quarantines the
  row. `To-allocate` is in that vocabulary; without it the feed would have
  rejected every unclaimed Case.
- **The Case Type Owner's "Unassigned" KPI tile reads the status.** Its lane now
  fetches both `To-allocate` and `In-progress` in one `anyOf` — the same lane
  needs the pot for one tile and the review clock for the other, and two
  fan-outs would double the requests behind one strip.
- **The index budget is unchanged.** `Status` was already indexed; this adds a
  value, not a column.

## Amendment (2026-10) — a Maintainer can un-assign an `In-progress` Case

A Case claimed by the wrong Reviewer, or by someone who can no longer work it,
had no way back to the pot: reassignment needs a named recipient, and choosing
one by hand moves workload balancing out of allocation. **Case Support**'s
**Un-assign** is now the one move back into `To-allocate`.

- **Only from `In-progress`.** A Completed Case has a result and needs Reopen
  first; `Actions In Progress`, `Completed` and `Void` are never un-assigned.
- **The pot's invariants hold afterwards.** The same PATCH, under the Case's
  `If-Match`, sets the status and clears the Assigned Reviewer (so
  `withAssignmentStamp` clears `assignedAt`), the Reviewer Manager and the
  `DueDate`. A released Case therefore looks exactly like one never claimed: no
  review clock runs, and the next claim stamps a fresh Due Date and assignment
  time. The claim's own checks (status `To-allocate`, no Reviewer) find it
  claimable.
- **A hold is lifted**, as Void lifts it: the hold belonged to the released
  Reviewer's review, and a Case in the pot is not waiting on anyone.
- **The Answers entered so far are kept** for whoever claims it next, as is the
  conversation with the Responsible Party and its Awaiting Frontline flag.
- **It is a Maintainer action, logged first.** The Support Log entry, with the
  Maintainer's reason and every field changed, is written before the Case.

The reporting history sees an ordinary status change: the dwell and backlog
metrics walk observed statuses in order, so a second `To-allocate` stay is
counted as its own interval. The `allocation` lifecycle leg, measured from
`created` to the Case's current `assigned_at`, spans the whole time to the
latest claim, including the released review.

## Alternatives considered

- **A `Pending` or `New` spelling.** Rejected: `CONTEXT.md` and the KPI tile
  already call this set _unallocated_, and the status should agree with the word
  the domain already uses.
- **A boolean `isAllocated` column beside the status.** Rejected for the reason
  above: every status allow-list absorbs a status and none absorbs a flag, and a
  new indexed column spends index budget where an existing indexed column
  already answers.
- **Leaving the read as-is and adding `$top`.** Rejected: a capped scan returns
  an arbitrary window of live Cases that may contain no unclaimed one at all, so
  "no Cases available" would stop meaning what it says.
