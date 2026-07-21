# 36. Dashboard composition is dashboard-owned

Date: 2026-07-21

## Status

Accepted — supersedes the `dashboardPanels` Case Type configuration decision in
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md).

## Context

ADR-0035 introduced `CaseTypeConfig.dashboardPanels` so Case Types could declare
which panels were present on the dashboard. The dashboard loaded every eligible
Case Type configuration, unioned those declarations, and then applied its own
capability rules.

In practice, dashboard panels are not Case Type variation. They are application
navigation and presentation owned by the dashboard. Complaints declared the
complete panel set, while a Case Type without the field triggered a compatibility
fallback to that same complete set. The configuration seam therefore added a
manifest dependency and an asynchronous dashboard-startup failure path without
expressing a current domain difference.

The dashboard does still operate across Case Type-specific SharePoint lists. The
application setup layer resolves those data sources as `caseSources`, including
their Case Type slug and list name. Consuming those resolved sources is a data
access dependency, not permission for Case Type configuration to define dashboard
composition.

## Decision

Dashboard code owns the complete panel registry, panel order, capability rules,
views, state, events, and effects.

`CaseTypeConfig` does not declare dashboard panels. The dashboard does not import
the Case Type manifest or load Case Type configurations to determine its layout.
Adding, removing, or reordering a panel is confined to dashboard-owned production
code and dashboard tests.

The existing data-source boundary remains unchanged: the dashboard receives
resolved `caseSources` from application context and uses them for list-scoped Case
queries, owner summaries, allocations, and other cross-source data operations.
Case Type eligibility and list-name resolution remain outside the dashboard.

`caseTableColumns` and `sections` remain Case Type descriptors because they express
genuine variation in a Case Type's tables and Case-review journey. ADR-0035's
general rule still applies to those seams: descriptors contain data-only variation
and branching behaviour remains in code.

## Consequences

- Changing dashboard composition no longer requires editing Case Type modules or
  the Case Type scaffold.
- Dashboard startup no longer loads Case Type configurations solely for layout.
- The dashboard retains its existing role-visible panel behavior.
- The dashboard continues to query the correct per-Case-Type lists through
  resolved `caseSources`.
- Case Types can no longer suppress dashboard panels. No current production Case
  Type used that capability: Complaints declared every panel and absent fields
  fell back to every panel.

## Considered alternatives

- **Keep `dashboardPanels` but make it optional.** Rejected. This preserves the
  ownership ambiguity and means a dashboard change can still require Case Type
  config and scaffold changes.
- **Import the Case Type manifest directly from the dashboard for list names.**
  Rejected. The setup layer already resolves `caseSources`; the dashboard should
  consume that explicit data-source contract rather than own config loading.
- **Move panel declarations to a separate global configuration file.** Rejected.
  The existing dashboard panel registry is already the coherent code-owned seam
  for panel identity, ordering, and capability policy.
