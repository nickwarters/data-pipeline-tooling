---
status: accepted
---

# Person-targeted Selection plans per Adviser, and counts a check at Reportable

**A Case Type declares exactly one Selection mode.** In *person-targeted* mode,
Selection plans per **Adviser** against a pro-rata **Check target** — it answers
*"who is due a check"*, never *"how many Cases fill the hopper"*. Volume is
**emergent and uncapped**: it is whatever the roster demands that day. The
**Hopper** appears only as the destination and as the earliest observable state
of "this Adviser already has something outstanding" — never as a gate.

This is the sibling of
[ADR-0021](0021-selection-plans-per-group-over-the-whole-eligible-pool.md), which
governs *volume-targeted* mode. The two share the Sync-derived data and almost
nothing else. A Case Type is under one or the other, because their invariants are
incompatible: volume-targeted mode fills a Hopper to a declared depth, and
person-targeted mode delivers whatever its Advisers are owed regardless of depth.
Point both at one list and neither invariant holds.

## Why the person is the Adviser

The **Adviser** — the actor who conducted the work a Case captures. The two
plausible alternatives are both unusable:

- **Responsible Party** looks like the obvious answer ("the user whose work is
  being reviewed"), and is wrong twice over. It is *set by the Assigned Reviewer
  during the review*, and only once a failed Answer requires remediation at all —
  so a Case needing no remediation records none. It is therefore an **output of a
  review, present only on the failing minority**, and it is *usually but not
  always* the Adviser. Keying per-person arithmetic on it would be silently
  correct on the majority and wrong on the rest, which is the worst available
  failure mode.
- **Reviewer** is already volume-targeted mode's concern: the Hopper's `3D` depth
  exists precisely to stop Reviewers being given more than they can drain.

The consequence is structural: **there is no Adviser anywhere in the Sync store.**
The Adviser↔Case edge exists only where Selection stamps it, so it must reach the
destination list on the Deliverable for Sync to land it and aggregate on it.

## Why it does not inherit the volume framework

- **The gate is per-person, not per-group.** A run is simultaneously "done" for
  one Adviser and "starved" for another. There is no group depth to be full.
- **The sort is by shortfall, not by age.** When more Advisers are due than can be
  served, whoever is furthest from target goes first — which is self-correcting,
  since anyone skipped is further behind tomorrow and rises. Highest risk score
  breaks ties, and also chooses *which* of one Adviser's Cases is taken.
- **Void replacement does not exist here.** ADR-0021's ladder protects the
  *group's composition* — brand and attribute mix across Case Types — when a Case
  is lost. Person-targeted mode has no composition to protect across people: a
  void means one Adviser lost one check, and that Adviser is the only person who
  can make it good, from their own sales against their own target. The ladder
  collapses into ordinary re-selection.

## The rules this encodes

- **Two numbers, two jobs.** The **Check minimum** (8) is the compliance floor.
  The **Check target** (10) is what Selection aims at, deliberately above the
  minimum. Both **pro-rata by active months**, an active month being a calendar
  month with at least one sale.
- **Variation quotas**, also pro-rata: at least 2 checks carrying variation 1 and
  at least 2 **combined** checks. A combined check carries variation 1 plus one
  other, so it **ticks both boxes**; the variation-1 quota is implied whenever the
  combined quota is met and binds only as a fallback. Quotas pro-rata on the same
  basis and rounding as the target, so they can never exceed the target they sit
  inside — at one active month, fixed quotas of 2 would be arithmetically
  unsatisfiable.
- **One outstanding check per Adviser**, where *outstanding* begins at delivery,
  not at allocation.
- **One milestone, two durations.** The next check becomes selectable **20**
  working days after the previous reached **Reportable**, or **5** while the
  Adviser is **Behind**.
- **Behind is a tolerance band** — a shortfall of 2 or more, not merely "below
  target". Every selectable Adviser is below target by construction (an Adviser at
  target is already excluded by the capacity gate), so a bare shortfall would make
  every Adviser permanently Behind and the 20-day cadence unreachable.
- **A Case is selectable only if its sale is within the last 15 working days.**

## Why the catch-up cadence is the normal operating mode

This is the least obvious property of the design and the easiest to mis-size, so
it is recorded rather than left to be rediscovered.

The cycle is not "20 working days between checks" — it is *time to Reportable*
plus 20. Against roughly 252 working days a year:

| Time to Reportable | Cycle | Checks/year | vs target 10 / minimum 8 |
|---:|---:|---:|---|
| 5 wd | 25 wd | 10.1 | just reaches target |
| 10 wd | 30 wd | 8.4 | misses target, scrapes minimum |
| 15 wd | 35 wd | 7.2 | **breaches the minimum** |

The 5-working-day catch-up path yields 16–19 checks a year. So **a fully-active
Adviser cannot reach target on the 20-day cadence at all**, and breaches the
minimum once reviews take longer than about eleven working days. The catch-up
path is the engine; the 20-day path is what an Adviser briefly drops into after
catching up.

That is a deliberate control loop — fall behind, speed up, catch up, slow down —
and the three numbers are one mechanism rather than three constants: **a band of 2
under a target of 10 settles an Adviser at 8–9 checks a year, which is what holds
the minimum of 8.** Changing any one of them in isolation breaks the other two.

It also names an exposure the volume framework does not have: **hitting target
depends on review turnaround, which Selection does not control.** No selection
logic can compensate for a slow review queue.

## Why a check counts at Reportable

A check counts from the moment its Case reaches **Reportable**, and falls in the
calendar month it became Reportable. Counting at *selection* instead would require
subtracting voids back out as a special case; counting at Reportable means **a
voided Case simply never becomes a check** and needs no handling anywhere. The
same milestone then drives both the count and the cadence.

The cost — an Adviser's shortfall does not fall until their check completes — is
free, because the one-outstanding rule blocks them until then regardless.

The calendar-month bucket is not an approximation: the rolling window is already
counted in whole calendar months, so month *is* the window's unit.

## Why the lower-level aggregation lives in Sync

Selection reads a monthly per-Adviser aggregate published by **Sync**, rather than
re-reducing a year of rows on every one of ~252 daily runs.

The line is: **Sync answers "what happened"; Selection answers "what it means and
what to do about it."** How many reviewed checks an Adviser had in March is a fact
about the past, and belongs beside the data that knows it. Target, quota, Behind,
cadence and verdict are policy, and stay in Selection.

**The aggregate is deliberately rule-neutral.** It carries `status` and
`variations` as *dimensions* rather than publishing a pre-filtered "countable
checks" measure, so that *voids do not count* stays a Selection rule rather than
migrating into a Sync table. This is the same reasoning as ADR-0021's
do-not-optimise note: the moment an upstream pre-filters, the thing worth
monitoring stops being observable.

## Why metrics rather than a per-run selection trace

ADR-0021 makes the **selection trace** load-bearing, because volume-targeted mode's
inputs are *perishable* — a Case not selected today may age out tomorrow, so if
the run does not record what it saw, the answer is gone.

**Person-targeted mode's inputs are durable.** Sales accumulate in silver, checks
accumulate in Sync, selections accumulate in the SelectionPool. A past decision is
re-derivable, so a per-Adviser trace row on every run — 300 Advisers × 252 runs,
overwhelmingly "at target" — buys little for its noise.

Three tables replace it: a **current-state table** (one row per Adviser: target,
shortfall, `is_behind`, `next_eligible_date`, verdict, `unservable_since`), and a
**daily distribution** grained `date × case_type × shortfall × verdict`. The
distribution, not a total, is the monitoring surface: a population mostly one
check behind is *healthy* — those are tomorrow's selections — while a cluster at
four-to-six behind is a problem, and crossing shortfall with verdict separates an
Adviser who is catching up from one who is **starved**.

**Re-derivability has one precondition, and it is not optional.** Re-deriving a
past decision requires the rules that were in force then. The declared numbers are
expected to be tuned. So the run record gains a **`code_version`** field
(one entry appended to `RUN_RECORD_FIELDS`), and the declared numbers live **in
the repository** as application data beside the Case Type declarations — so git
*is* the rule store and "check out the commit and re-drive" is exact rather than
inferred from timestamps. Without this, tuning a number silently destroys the
audit trail [ADR-0008](0008-selection-explainability.md) exists to protect.

## The verdict vocabulary

Every Adviser in the roster gets a verdict, and one of them is the point:

| Verdict | Meaning | Alarming |
|---|---|---|
| `selected` | a Case was chosen | no |
| `at target` | already at their pro-rata target | no |
| `within cadence` | outstanding check, or inside the 20/5-day spacing | no |
| **`no eligible case`** | **owes a check, nothing available to select** | **yes** |

`no eligible case` is the person-targeted twin of ADR-0021's "how many were
available within max age". Without it an Adviser who owes checks but has no sale
in the 15-working-day window is indistinguishable from one who does not exist, and
the framework can under-deliver indefinitely while looking healthy — which is
exactly what `pipelines/case_selection/selection.py:72` does today, skipping such
an Adviser with no record at all.

## Considered options

- **Inherit the volume framework's gate and sort.** Rejected: Hopper depth is a
  group construct with no per-person meaning, and oldest-first ranks Cases when
  the thing needing ranking is *people*.
- **Fixed rather than pro-rata variation quotas.** Rejected as arithmetically
  unsatisfiable at the bottom of the activity range, and perverse just above it —
  fixed quotas of 2 would hold a two-active-month Adviser to 100% combined checks
  against a full-year Adviser's 20%.
- **"Behind" as simply "below target".** Rejected: it makes every selectable
  Adviser Behind and the 20-day cadence dead code.
- **A per-Adviser trace row on every run**, mirroring ADR-0021. Rejected on the
  durability asymmetry above — but only once `code_version` makes re-derivation
  exact.
- **A per-Adviser verdict *event log*** (a row only when a verdict changes) as a
  middle path. Rejected as a third table earning its keep only for
  `unservable_since`, which the state table carries forward directly.
- **Publishing "countable checks" from Sync.** Rejected: it moves a Selection
  policy into the Sync store, where a rule change becomes a schema change.

## Consequences

- **The Deliverable must carry the Adviser and a deterministic Case id** onto the
  destination list. Neither exists on it today; both are needed — the Adviser so
  Sync can aggregate per person at all, the id so a delivered Case can be matched
  to its reviewed self. The `title` Case Reference cannot serve: it is nullable
  and its format is not enforced.
- **Volume is uncapped, and the population will convoy.** At cold start no Adviser
  has history, so every Adviser is Behind and everyone with an eligible sale is
  selected *on the same day* — the largest batch the system will ever produce.
  The cadence is deterministic and identical for everyone, so that cohort returns
  together. Only natural variance in sale timing and review turnaround disperses
  it. **Cold-start smoothing is a go-live task, not a runtime rule.**
- **A void frees the Adviser immediately** — the Case never reached Reportable, so
  their previous check still sets the clock, and it has long elapsed. Guard the
  `duplicate` void reason: re-selecting the same sale mints the same deterministic
  id and reproduces the duplicate.
- **One Deliverable per run**, since the mode runs per Case Type — unlike
  volume-targeted mode, where one group spans several destination lists.
- **The framework's health is not fully within its control.** Review turnaround
  sets the achievable rate, and the sales feed sets whether an Adviser can be
  served at all. Both are visible only through the daily distribution.
- **Open:** whether an Adviser sells across more than one Case Type. If they do,
  one-outstanding must be scoped per `(Adviser, Case Type)` — a single global
  outstanding slot cannot serve two targets of 10 within ~252 working days.
