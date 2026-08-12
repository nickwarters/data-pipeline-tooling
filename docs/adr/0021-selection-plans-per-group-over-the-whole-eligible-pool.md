---
status: accepted
---

# Selection plans per group, and reads the whole eligible pool

**Selection runs once per *Selection group*, not once per Case Type**, and each
run **reads every eligible Case** — capping the **Hopper** with a gate the
selection trace observes, never with a limit on the read.

Case Types A, B and C form one group; every other Case Type is a group of one.
The Case Type remains the unit of *delivery* — a selected Case is delivered to
its own Case Type's list — but it is not the unit of planning.

## Why the group is the planning unit

Three of the rules cannot be evaluated by a run that can see only one Case Type:

- **The volume target is declared for A+B+C combined**, and the per-Case-Type
  split (300/125/75 of a 500 monthly average) is that group target apportioned,
  not three independent targets.
- **The attribute split is a group volume** — 250/250 of the group's 500. It is
  deliberately *not* 50/50 within each Case Type, so it can only be measured
  across the group.
- **The void-replacement ladder crosses Case Type boundaries.** Its rungs
  `(brand, attribute)` and `(attribute)` drop `case type` entirely, so a voided
  Case Type A Case may be made good by a Case Type B one. A per-Case-Type run has
  no way to know that Case Type B should absorb Case Type A's voided quota.

A per-Case-Type Selection would have to reconstruct the group by reading its
siblings' gold — which is the group pipeline, written less honestly.

## Why the read is not limited

Selection's monitoring is **reporting**, not run-log warnings: a day that cannot
fill the Hopper is not a failure, and the signal that the eligible pool is
thinning comes from reported volumes (available within max age, selected, broken
down by Case Type, brand and attribute) rather than from a warn hit.

That makes the **selection trace** the source of those figures. `RowTrace` counts
`considered` as every row that entered the pipeline
(`framework/run/trace.py`) and writes one row per considered Case rather than per
survivor, so a Case dropped by a top-N cut still records what it scored. The
availability reporting therefore comes for free — **provided the eligible pool
enters the pipeline whole**.

Cap the Hopper with a `LIMIT`/`head(n)` on the read instead and `considered`
collapses to `selected`: "how many were available" becomes unanswerable, and
because run-log warnings were deliberately declined, *nothing else is watching*.

**Do not optimise this.** Limiting the read looks like an obvious improvement to
anyone who does not know the trace is the reporting source. It is not: the
eligible pool is roughly one month's intake plus carryover — thousands of rows —
so reading it whole costs nothing worth saving.

## The rules this encodes

- **Two gates only**: a Case is skipped if it has **aged out** (by *related
  date*, not ingest date) or the **Hopper** is full. Everything else steers which
  Case is chosen, never whether one is. The monthly average never blocks a
  selection.
- **One sort**: void-replacement rung first, then oldest by related date. Void
  matching is the only thing that overrides oldest-first.
- **Hopper depth is `3D`**, where `D` is the group's daily *assignment* rate —
  the rate that actually drains it. Read as a direct count of unallocated Cases,
  never as `target − completed − voided`, which ignores work in progress.
- **Voids are since the last working day**, do not raise the target, and do not
  carry forward.

## Considered options

- **One Selection pipeline per Case Type** (what CONTEXT.md said). Rejected: it
  cannot see the group target, the group attribute split, or a cross-Case-Type
  void replacement.
- **Steer on a composition gap instead of matching voids explicitly** — compare
  month-to-date progress per bucket against a pro-rata target and fill the
  biggest gaps, which needs no void ledger and self-corrects. Rejected because
  **brand has no volume target**: the ladder matches on brand precisely to keep
  brand representative, and a gap model can only steer on dimensions that have a
  target, so it would silently flatten brand mix.

## Consequences

- **A group needs declaring somewhere.** Its members, target, splits, max age and
  ladder are application data, alongside the Case Type declarations rather than
  in the framework.
- **One run emits several Deliverables** — one per destination list — since the
  group spans Case Types but delivery does not.
- **The trace is load-bearing, not just governance.** It was introduced for
  defensibility ([ADR-0008](0008-selection-explainability.md)); it is now also the
  only source of availability reporting, so a change to what it records is a
  change to the monitoring.
