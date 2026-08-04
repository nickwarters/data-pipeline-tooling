# ADR-0040: Case tables are framework-owned

- Status: Accepted
- Date: 2026-07-29
- Amends: [ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md)
- Extends: [ADR-0036](./0036-dashboard-composition-is-dashboard-owned.md)

## Context

[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md)
gave `CaseTypeConfig` three presentation seams, one of which was
`caseTableColumns`: a Case Type could contribute extra data-only columns to a
generic Case table when that table was scoped to it alone.

[ADR-0036](./0036-dashboard-composition-is-dashboard-owned.md) then removed
`dashboardPanels`, taking dashboard composition out of Case Type configuration
entirely. It kept `caseTableColumns` on the grounds that a Case Type's tables
were genuine Case Type variation, distinct from dashboard layout.

That distinction has not held up in practice:

- **The variation it expressed was not real.** Complaints — the single live Case
  Type — declared exactly one extra column, Responsible Party, whose value was
  already a plain `CaseRow` property present on every Case list. No Case list has
  fields another lacks, so there was nothing for a per-Case-Type column seam to
  vary.
- **It made Case tables inconsistent for the reader.** The Team Cases table grew
  a column when a Reviewer filtered to one Case Type and lost it when they
  cleared the filter. Comparing a scoped list against the whole team's list
  meant comparing two different tables.
- **It read as the thing ADR-0036 had just banned.** The resolver was named
  `resolveDashboardColumns`, its state field was threaded through the route
  slice, and it loaded a Case Type configuration for layout — which is precisely
  the shape ADR-0036 removed from the dashboard. Reviewers reasonably read it as
  a regression against ADR-0036 even though the dashboard never consumed it.
- **It cost a Case Type config load on a page that needed no config.** The Team
  Cases route ran a two-way `Promise.all`, fetching Cases and a Case Type module,
  to decide a column list that in every case resolved to zero or one column.

## Decision

**Case table columns are framework code. `CaseTypeConfig` does not declare
them.**

`standardCaseColumns()` in `src/views/case-columns.js` is the fixed column set
for every generic Case table, and it is fixed regardless of whether the table is
scoped to one Case Type or spans them all. Scoping a Case table narrows which
Cases are listed, never which columns describe them.

`caseTableColumns` and the `CaseTableColumnDescriptor` typedef are removed from
`CaseTypeConfig`, along with the Team Cases resolver that read them and the
`extra` parameter on `standardCaseColumns()`. The Case Type scaffold no longer
generates the field.

**This moves where a column is declared; it removes no column.** Responsible
Party — the only column the seam ever contributed — becomes a framework column
in `standardCaseColumns()`, shown and sortable for every Case Type on every Case
table. A page's table requirements are the page's to state, in code, derived from
Case data that every Case Type already carries.

ADR-0035's general rule is unchanged and still governs the descriptors that
remain — `sections`, `detailFields`, `remediationFields`, `captureGroups`,
`generalQuestions`, and the rest: data-only variation in configuration,
branching behaviour in code. What changes is the membership of that list. Of
ADR-0035's three original presentation seams, `dashboardPanels` went in
ADR-0036, `caseTableColumns` goes here, and `sections` remains — it describes a
Case Type's review journey, which genuinely does vary between Case Types.

A column that should exist for one Case Type is added to `standardCaseColumns()`
for all of them. If a future Case Type needs a column that is genuinely
meaningless elsewhere, that is a new decision to take deliberately, with a
renderer that handles an absent value — not a config key reintroduced by
default.

## Direction

The general rule this decision applies beyond Case tables: **pages derive their
requirements from Case Type configuration; Case Type configuration does not
declare pages.** A Case Type describes what a Case _is_ — its Questions, its
Sections, its capture and remediation shape — and each page decides for itself
what to do with that. A descriptor named for a page or a panel is the smell this
and ADR-0036 both removed.

The Case Review page is currently the only page reading explicitly page-shaped
configuration (`sections`, `captureGroups`), and even there the coupling is
incidental rather than essential: those describe a Case's review journey, and
nothing stops that journey being rendered somewhere other than the Case Review
page. Nothing new should follow `dashboardPanels` and `caseTableColumns` into
`CaseTypeConfig`.

## Consequences

- Every Case table shows the same columns for every Case Type. The Team Cases
  table no longer changes shape when the Case Type filter changes.
- No column is lost. Responsible Party moves from Complaints' config into
  `standardCaseColumns()`, so it now appears on every Case table for every Case
  Type rather than only on a Case-Type-scoped Team Cases table.
- The Team Cases route no longer loads a Case Type module. Its `start()` is a
  single Case fetch rather than a two-way `Promise.all`.
- Adding, removing, or reordering a Case table column is confined to
  `views/case-columns.js` and its tests.
- Case Types cannot make their tables inconsistent with every other Case Type's.
