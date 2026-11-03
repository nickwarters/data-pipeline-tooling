---
status: accepted
---

# Person-targeted Selection plans across a Selection group, to a committed ten

**An Adviser owes 10 checks per rolling 12 months across a Selection group, at
least 2 of them from one declared Case Type, and never more than 10.** Both
figures pro-rata by active months. This supersedes four parts of
[ADR-0022](0022-person-targeted-selection-plans-per-adviser.md) — the planning
unit, the two numbers, the Variation quotas and the cadence durations — and
keeps the rest of it: planning per **Adviser**, counting a check at
**Reportable**, one outstanding check, no **Void replacement**, the rule-neutral
Sync aggregate, metrics rather than a per-run trace, `code_version`, and the
verdict vocabulary.

## What changed, and why

The requirement changed under the design. ADR-0022 was written against a
compliance floor of 8, with 10 as the buffer Selection aimed at, and two
Variation quotas inside it. The commitment is now **10 itself**, and a new Case
Type — reviewed on its own list against its own **Question Bank** — must make up
at least 2 of them. Combined checks have become the default rather than a quota
to steer towards.

### The planning unit is the Selection group

The checks an Adviser owes are drawn from a **Selection group** of five or six
Case Types, not from one. One of them is the group's **quota Case Type**, which
supplies at least 2 of the 10; the rest come from *any* Case Type in the group,
the quota Case Type included — so an Adviser who only works that Case Type meets
the whole target from it, and nothing special handles them. Which Case Type is
the quota Case Type is declared data; it is a placeholder until named.

This settles ADR-0022's one open question — whether an Adviser sells across more
than one Case Type. They do, and it is now the design rather than a risk: **one
target, one outstanding check and one cadence per Adviser across the group**,
never per Case Type. An active month is a month with a sale in any of the group's
Case Types.

The term is reused from volume-targeted mode on purpose. A **Selection group** is
the set of Case Types planned as one in either **Selection mode**; what the group
shares differs by mode — a volume target and a **Hopper** in one, each Adviser's
target in the other. The group, not the Case Type, declares its mode.

### One number: the target is the commitment, and the cap

There is no **Check minimum** any more. The **Check target** of 10 is the
requirement, and going over it is something the business would be questioned on,
so it is a ceiling as well as an aim. That needs no new rule: a check counts only
at Reportable, so a void never counts; an Adviser holds at most one outstanding
check; and an Adviser at target is not selectable. Together those keep the count
in the window at or under 10. **The buffer ADR-0022 bought with volume is bought
with time instead** — the catch-up cadence below is what recovers lost ground.

One way to read "over 10" survives, and it belongs to reporting rather than to
Selection: the target is pro-rata, so an Adviser whose sales fall away loses
active months and can be left with more completed checks than their reduced
target. Nothing can un-complete a check.

### The Case Type quota replaces both Variation quotas

At least `2 × active months / 12` checks (rounded half-up, the target's rounding)
must come from the quota Case Type, and **those places are reserved, not
preferred**: only the other 8 (`pro-rata target − pro-rata quota`) are open to the
group's other Case Types. Quota Case Type checks fill either share, which is how an
Adviser who only works it meets the whole target from it.

Within one Adviser's eligible Cases, **highest risk score always wins**. The
reservation acts on *eligibility*, not on the sort: while the Adviser has taken
fewer than 8 checks from other Case Types, every eligible Case competes on risk,
the quota Case Type's included; once they have taken 8, only quota Case Type Cases
are eligible, and if there is none today the verdict is `no eligible case` rather
than a Case of another type — which would spend the quota's last place and, with
10 also the cap, put the quota out of reach until a check left the window.

Reserving rather than preferring is deliberate. Preferring the quota Case Type
whenever the quota was short would take every Adviser's quota checks in the first
weeks of their year and leave that Case Type unchecked for the rest of it; letting
risk beat it outright would leave the 2 to chance. Between equal risk scores the
Case Type the Adviser has had **fewest checks in** this window wins, so the
remainder spreads across the group — **a tie-break, never a target**; it never
overrides risk, and there is no per-Case-Type split to meet.

The quota applies to every Adviser in the group: each is expected to work the
quota Case Type at some point in the year. One who does not is held at 8 by the
reservation and reports short of 10 — a fact for the monthly review, not one
Selection can fix.

**Combined is the default.** A Case's variations are still derived from the Case,
never chosen by Selection; what changed is the default — combined unless a
declared exclusion rule says the Case should not be, where ADR-0022 made a check
combined only above a risk threshold. Because nearly every check is combined,
nothing in Selection steers towards combined any more. The exclusion rule is a
placeholder until it is defined.

### The cadence: a window, with a catch-up floor

Spacing is still measured from the previous check reaching **Reportable** — one
milestone, as ADR-0022 set it — but read as a window:

- **20 working days (about 4 weeks)** — the Adviser becomes selectable, and is
  selected as soon as an eligible Case exists.
- **10 working days (about 2 weeks)** while the Adviser is **Behind** — two or
  more checks short of their pro-rata target. The hard floor; nothing is selected
  sooner.
- **25 working days (about 5 weeks)** — the Adviser is **overdue**. Selection
  cannot do more than select at the first chance it gets, so this is a reporting
  line, not a gate: an Adviser past it with nothing to select is the case the
  `no eligible case` verdict exists to surface. It applies only while the Adviser
  is under target; one at target waits for a check to leave the window, and that
  wait is supposed to be long.

The durations were given in weeks and are declared in working days, because every
duration in this framework is a working-day duration and a bank holiday should
move a check rather than eat the gap.

## The arithmetic, and the risk it names

The cycle is not the gap; it is the gap **plus the time from selection to
Reportable** — the review turnaround, Hopper wait included — which Selection does
not control. Ten checks across roughly 252 working days needs a cycle of about
25 working days:

| Selection → Reportable | Normal cycle | Checks/year at 20 wd | Behind cycle | Checks/year at 10 wd |
|---:|---:|---:|---:|---:|
| 5 wd | 25 wd | 10.1 | 15 wd | 16.8 |
| 10 wd | 30 wd | 8.4 | 20 wd | 12.6 |
| 15 wd | 35 wd | 7.2 | 25 wd | 10.1 |

In steady state the target itself paces an Adviser: at 10 they wait for a check
to leave the window, then are selected straight away, so the count sits at 9–10.
That holds while the normal cycle fits — turnaround of about five working days or
less. Beyond it the normal cadence cannot keep up, the Adviser drifts down, and
the catch-up cadence takes over at the band.

**The band is the lever.** At the default of 2 an Adviser only catches up once at
8, so with slow turnaround they settle at 8–9 — under the commitment. A band of 1
holds 9–10, but every selectable Adviser is below target by construction, so at 1
everyone is always Behind and the 4-week gap governs nobody. That is a declared
number, not a design change, and the choice is deliberately the monthly position
review's: **hitting 10 depends on review turnaround, and that dependency was
accepted** on the basis that the position is reviewed monthly and the declared
numbers adjusted.

## Considered options

- **Keep a planning target above 10.** Rejected: going over 10 would be
  questioned, and the cap already falls out of the existing rules. The buffer
  moved into the catch-up cadence.
- **Measure the gap from delivery, not Reportable.** It would take turnaround out
  of the cycle and make 10 reachable regardless of review speed. Rejected:
  Reportable stays the one milestone driving both the count and the spacing.
- **The quota Case Type first whenever its quota is short.** Rejected: it
  front-loads the quota — every Adviser's quota checks land early in their year
  and the quota Case Type then goes unchecked — and it overrides risk on picks
  that did not need to be overridden.
- **Risk score above the quota, the quota only a tie-break.** Rejected: the 2
  would then hold only if the quota Case Type happened to score highest.
- **A per-Case-Type split of the remaining 8.** Rejected in favour of a spread
  tie-break — a split would turn an Adviser's natural mix of work into
  something Selection fails against.
- **A hard 4-week floor with no catch-up.** Rejected: recovering from a few weeks
  with no eligible Case would then take most of a year.

## Consequences

- **One run per Selection group, several Deliverables.** Each Case Type keeps its
  own list, so one run can deliver to up to six destination lists — the shape
  volume-targeted mode already has, and no longer ADR-0022's one Deliverable per
  run.
- **The Sync aggregate is unchanged.** It is already grained by Adviser and Case
  Type with `variations` as a dimension; Selection sums across the group's Case
  Types. Keeping `variations` costs nothing and keeps the aggregate rule-neutral.
- **The state table gains `due_date` and `overdue`** and drops the Variation
  quota columns for the Case Type quota. The daily distribution is grained by
  Selection group rather than Case Type.
- **Placeholders to fill before build:** the quota Case Type, and the
  combined-exclusion rule. Both are declared data; the rule surface does not
  change when they are named.
- **Still open:** which variation a default-combined check pairs with variation 1,
  and whether Variations apply to the quota Case Type at all, given its own
  Question Bank.
