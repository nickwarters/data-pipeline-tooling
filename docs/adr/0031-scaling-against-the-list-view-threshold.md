# 31. Scaling Case storage against the List View Threshold: index-at-creation, live indexed reads, snapshot reports — not partitioning or deletion

Date: 2026-07-05

## Status

Accepted (supports [ADR-0007], [ADR-0009]; generalises [ADR-0030] from the Action
Centre to the whole app; relates to [ADR-0008], [ADR-0015]; resolves [issue #289],
underpins [issue #286] and [issue #287])

## Context

One upcoming Case Type ingests **~700–1,100 Cases/day** (~900 midpoint → ~27k/month,
~330k/year). SharePoint Subscription Edition throttles any query whose **leading indexed
predicate matches more than the List View Threshold (LVT, default 5,000) rows** — the
throttle is on _result-set size, not scan method_, so an index cannot rescue an
inherently-large result, and the first indexed column does the narrowing _before_ other
filters apply. We had already hit LVT-related dashboard failures on another site and were
papering over them by manually excluding low ID ranges. We want a design that never needs
that, and that is safe on day one because the busy Case Type would cross the threshold in
~17 days.

Three constraints shaped the decision:

- **No automation tier for SharePoint.** No Power Automate, no Nintex, no scripted list
  provisioning ([ADR-0030]). So any strategy that requires _creating lists on a schedule_
  or _moving/deleting rows in bulk_ has no runner.
- **Retention is a domain requirement, not overhead.** Appeals keep full history
  (CONTEXT.md), and the Responsible Party Manager report is a rolling **12-calendar-month**
  view — so the retention floor is ≥12 months for reporting, plus audit. Deleting Completed
  Cases to keep lists small is therefore not on the table.
- **A daily Python "Sync" is planned but not built.** As designed it pulls the previous
  day's modified data into **SQLite** databases and is intended to become the reporting
  system of record. Nothing runs today, so every claim below about what the Sync does is a
  statement about a component that has yet to be written, and its scope is still open.

The key reframe: the ~330k/year figures are **storage** numbers, not
**query** numbers. Every operational read is bounded by _open work_ (In-progress Cases,
Cases with an open Appeal), which never grows with cumulative volume. Only _cumulative
aggregate reports_ are inherently large — and those don't need to be live.

## Decision

**Keep one list per Case Type. Do not partition. Do not delete. Make every live read
index-selective, and serve cumulative reports from a pre-computed daily snapshot.**

### 1. One list per Case Type, indexed at creation

Cases stay in the single per-Case-Type list ([ADR-0007]); it may grow to hundreds of
thousands of rows. Because **a column index cannot be added once a list is past the
threshold**, each Case Type list is provisioned **with its indexes on the empty list,
before it fills** — a one-time, point-and-click list-settings task. The columns to index
are the ones live queries lead with, i.e. the [ADR-0030] reason flags and lifecycle/date
columns:

`Status`, `DueDate`, `CompletedAt`, `AssignedReviewer`, `ResponsibleParty`,
`AssignedReviewerManager`, `ResponsiblePartyManager`, `HasOpenAppeal`,
`AwaitingResponsibleParty`, `Reopened`, `ReviewRequired`, `OnHold`, `Title`,
`ReportableAt`.

`Title` and `ReportableAt` were added to this set by [ADR-0045] (Case search): `Title`
holds the Case Reference and is matched by anchored prefix, and `ReportableAt` is the
date window a search leads with. The index-at-creation trap above applies to both without
softening — a `Cases-{slug}` list already past the threshold cannot gain them, so
indexing them is a **provisioning precondition** for search on an existing list, not a
follow-up task.

(Max 20 indexes/list; we are well under. Compound indexes are available if a future live
query needs a two-column narrowing.)

### 2. Every live read leads with an indexed, selective predicate — design to 5,000

No live read may fetch an unbounded or non-selective result set to aggregate in JS (the
option [ADR-0030] rejected, generalised here to the whole app). Every dashboard read
**leads with an indexed column whose matched set is bounded by open work** (so it stays
under 5,000 for the life of the list) and then **pages (`$top`/`$skip`) or counts
(`$count`)** — the Action Centre pattern. For the handful of windowed counts
that could themselves exceed 5,000 (e.g. "completed in the last 7 days" on the busy type),
compute them as a **sum of sub-threshold time slices** (per-day counts, each < 5,000),
never one large-window count.

SE lets an admin _raise_ the threshold and set a daily unrestricted time window. We treat
both as **headroom, never a correctness dependency** — relying on a raised threshold would
put load-bearing config outside the repo (the same anti-pattern [ADR-0030] rejects for
calculated columns) and degrade SQL for everyone.

### 3. Cumulative reports read a daily snapshot, not the list

`#/reports/*` pages (Reviewer Manager team, Responsible Party Manager team) **never query
the Case lists**. The planned Python **Sync** computes each report from its **SQLite**
store and writes a **JSON snapshot** into SharePoint; the report pages read that snapshot as
fixed data (reusing the pre-computed-JSON read path already established for versioned
exports, [ADR-0015]) and render an explicit **"as of &lt;timestamp&gt;"**. This removes
cumulative aggregates from LVT consideration entirely — the offline job reads SQLite, not a

> 5,000-row SharePoint query.

**Boundary:** the Sync owns report _aggregation_ (pass/fail, "had remediation", the
12-month window); the JS framework owns only the **snapshot contract** (its JSON shape and
location) and **presentation**. Report pages stay purely presentational and must not
re-derive report rules, or the two will drift.

## Considered options

- **Partition lists by reporting month** — rejected: needs a runner to create a
  pre-indexed list every month and freeze/move the old one; there is no automation tier
  ([ADR-0030]), and it adds standing operational overhead for a problem that indexing +
  bounded reads already solve.
- **Cycle Cases out and delete them past the appeal window** — rejected: breaks the
  ≥12-month reporting/audit retention (CONTEXT.md), contradicts "never delete", and bulk
  deletion is itself LVT-limited with no runner to page it.
- **Raise the SE threshold / rely on the daily time window** — rejected as a correctness
  mechanism: un-versioned per-web-app config, degrades SQL globally, still has a ceiling.
  Kept only as incidental headroom.
- **Search API (KQL) for large aggregates** — not needed once reports move to the Sync
  snapshot; it would add crawl-latency, eventual consistency, and out-of-repo managed-property
  config. Reserved as a documented fallback only if a genuinely list-wide _live_ aggregate
  ever appears.

## Consequences

**Positive**

- No new automation, no new storage topology, no retention/audit compromise. Volume
  becomes a storage fact that is invisible to every query.
- All _live_ read logic stays in the repo, versioned and unit-tested ([ADR-0030] spirit),
  and mock-first dev ([ADR-0009]) stays faithful — the `listName` seam already on
  `CaseListOptions` means no interface change.

**Negative**

- **Index-at-creation is an irreversible timing trap.** A Case Type list created _without_
  its indexes cannot be fixed once it passes the threshold — provisioning must get this
  right up front. Captured as a standing step in the
  [Case Type onboarding checklist](../case-type-onboarding.md), which also
  documents the full `Cases-{slug}` column schema and the max-20-indexes/list
  limit.
- **The tier-1 offenders must actually be fixed.** Several dashboard reads
  currently fetch a whole result set and filter in JS (KPI strip Controls & Owner lanes,
  `cora-owner-summary`, `cora-controls-dashboard`, the journey/team fetchers). These break
  on the busy Case Type and must be converted to indexed-selective count/paged reads before
  that type goes live.
- **Report business rules now live in the Python Sync**, outside this repo. The JS report
  pages must stay presentational; any rule duplicated in JS is a drift risk.

[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0008]: ./0008-autosave-and-concurrency.md
[ADR-0009]: ./0009-mock-first-dev-loop.md
[ADR-0015]: ./0015-data-only-case-type-export-for-reporting.md
[ADR-0030]: ./0030-action-centre-reason-flags-in-code-not-calculated-columns.md
[ADR-0045]: ./0045-case-search-is-one-bounded-cross-list-lookup.md
[issue #286]: https://github.com/nickwarters/case-review-frontend-framework/issues/286
[issue #287]: https://github.com/nickwarters/case-review-frontend-framework/issues/287
[issue #289]: https://github.com/nickwarters/case-review-frontend-framework/issues/289
