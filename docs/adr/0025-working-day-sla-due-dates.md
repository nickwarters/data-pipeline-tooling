# 25. Working-day SLA due dates from a maintained holiday list

Date: 2026-07-01

## Status

Accepted

## Context

The remediation SLA is **10 working days after Send Actions** ([the architecture decision]). "Working
days" excludes weekends **and** public holidays, so a correct due date needs a holiday
calendar. The framework has a hard rule: **no third-party runtime dependencies**
([the architecture decision], CLAUDE.md), so no date/holiday library. We need a tiny, self-contained
working-day calculator and a maintainable source of holiday dates.

## Decision

- **A pure `addWorkingDays(fromISO, n, holidays)` helper** in `src/lib/` (framework
  primitive, no domain knowledge): step forward day by day from `fromISO`, skipping
  Saturdays, Sundays, and any date in `holidays`, until `n` working days have elapsed;
  return an ISO date. Fully unit-tested (Red-Green-Refactor, 100% coverage per CLAUDE.md),
  including a holiday that lands on the due date and runs that straddle a holiday block.
- **Holidays are a plain, maintained list of ISO dates** (D12). Either representation is
  acceptable:
- an **in-code array** (e.g. `src/config/working-days.js`) — simplest, versioned with
  the code, requires a deploy to update; or
- a **small SharePoint list** read once at boot and cached for the session (like group
  membership, [the architecture decision]) — editable by a Maintainer without a deploy.

Default to the **in-code array** for September (fewer moving parts, no new list to
provision); the helper takes `holidays` as a parameter, so switching the _source_ to a
SharePoint list later is a boot-time wiring change, not a logic change.

- **The calendar is England & Wales public holidays** unless the business states
  otherwise (flagged as a confirmation item — see the grill doc). The list must be kept
  current; a stale list silently produces early due dates.
- **The due date is computed once, at Send Actions**, and stored as `remediationDueDate`
  on the Case row ([the architecture decision]/[the architecture decision]) — it is **not** recomputed on read, so a later
  holiday-list edit never moves an already-set due date.

## Considered options

- **Calendar-day (not working-day) SLA** — rejected: the business specified _working_
  days; weekends/holidays would understate the deadline.
- **A third-party working-day library** — rejected: violates the no-runtime-dependency
  rule.
- **Compute the due date lazily on each read** — rejected: a due date must be stable once
  set; recomputation against an edited holiday list would retroactively move deadlines.

## Consequences

**Positive**

- Correct, dependency-free due dates; the helper is trivially testable and reusable for
  any future SLA (e.g. overdue-case evaluation).
- Source of holidays is swappable without touching the calculation.

**Negative**

- **The holiday list is a maintenance burden** — it must be refreshed (annually, or when
  holidays change). A stale list is a silent correctness bug. The Maintainer runbook must
  own this.
- If the business operates across multiple jurisdictions later, a single global list is
  insufficient; per-region calendars would need a follow-up.

[the architecture decision]: ./0001-target-sharepoint-se-and-edge-chromium.md
[the architecture decision]: ./0010-auth-and-permissions.md
[the architecture decision]: ./0023-case-lifecycle-and-reportable-milestone.md
[the architecture decision]: ./0024-remediation-tracking-tab.md
