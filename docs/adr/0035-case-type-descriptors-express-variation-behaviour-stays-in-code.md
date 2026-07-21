# 35. Case Type descriptors express variation; branching behaviour stays in code

Date: 2026-07-19

## Status

Accepted — human sign-off recorded on GRID-5 issue #416.

> **Partially superseded by [ADR-0036](./0036-dashboard-composition-is-dashboard-owned.md).**
> Dashboard composition is dashboard-owned; `CaseTypeConfig.dashboardPanels`
> was removed. The data-only descriptor rule remains in force for genuine Case
> Type variation such as `caseTableColumns` and `sections`.

## Context

Project Palimpsest's GRID slices replaced bespoke read surfaces with two small
generic descriptor conventions:

- GRID-1/2 introduced generic Case tables driven by column descriptors.
- GRID-3 introduced dashboard panels selected from a fixed panel vocabulary.
- [ADR-0032](./0032-data-driven-section-registry.md) already lets a Case Type
  vary its enabled Sections and their presentation flags through the
  `sections` map.

The remaining Case Type seam still used the legacy component-era
`dashboardColumns` shape, and dashboard panel presence lived wholly in page
code. Adding a harmless Case Type variation therefore still invited a bespoke
page edit. At the same time, moving arbitrary functions or miniature renderers
into Case Type config would only relocate complexity: permission checks,
conditional formatting, navigation, state transitions, and effects would
become harder to find and impossible to validate as a coherent platform rule.

## Decision

**Descriptors express variation between Case Types; anything with branching
behaviour is code.**

`CaseTypeConfig` has three presentation seams interpreted by generic views:

1. `caseTableColumns` contributes data-only columns when a Case table is scoped
   to one Case Type. Each descriptor contains stable identity, display copy, a
   dot-separated `CaseRow` value path, and optional sortability. It does not
   contain render, link, permission, or conditional functions.
2. `dashboardPanels` declares which keys from the fixed dashboard panel
   vocabulary may represent the Case Type. The dashboard intersects the union
   of eligible Case Types' declarations with its code-owned permission rules.
   Config selects presence; code decides whether the current user may see it.
3. `sections` remains the Case Type's Section layout variation: membership is
   the allow-list and data flags such as `showInSummary` vary presentation. The
   platform Section registry, access matrix, controllers/views, and any
   state-dependent decisions remain code.

The rule applies to future descriptors too:

- **Configuration:** stable keys, labels, property paths, ordering, membership,
  simple flags, and references to a closed code-owned vocabulary.
- **Code:** `if`/`switch` decisions, predicates, permission or lifecycle policy,
  navigation, event handling, formatting that depends on runtime state,
  persistence, network calls, and other effects.

[ADR-0004](./0004-case-type-config-as-js-modules.md) remains unchanged: a Case
Type is still a JavaScript module because real Case Type behaviour such as
`computeOutcome` belongs in an explicit function. This decision constrains
descriptor fields; it does not pretend all Case Type configuration must be
JSON.

The additive legacy `dashboardColumns` typedef remains temporarily for source
compatibility, but new and scaffolded Case Types use `caseTableColumns`. It is
not the extension seam for Palimpsest generic tables.

## Demonstration

Complaints declares the complete current `dashboardPanels` set and retains its
existing `sections` layout, preserving dashboard and Section behaviour. Its
`caseTableColumns` adds a sortable **Responsible Party** column using only:

```js
{
  key: 'responsibleParty',
  label: 'Responsible Party',
  value: 'responsibleParty',
  sortable: true,
}
```

When Team Cases is scoped to Complaints, that visible page change comes only
from `case-types/complaints.js`; no page-specific renderer branch is required.
Mixed-Case-Type tables continue to omit Case Type-specific columns.

## Considered alternatives

- **Allow arbitrary render functions in Case Type column descriptors.**
  Rejected. It would make config a dispersed view implementation and permit
  branching behaviour to bypass the platform's tested renderer and policy
  seams.
- **Put permission predicates in `dashboardPanels`.** Rejected. Permissions are
  a platform policy shared across Case Types. Case Types declare presence; the
  code-owned panel convention evaluates capabilities.
- **Create a general layout DSL.** Rejected. The three proven schemas are enough
  for current variation. A speculative DSL would duplicate JavaScript badly
  and make simple page differences harder to trace.
- **Keep every variation in page code.** Rejected. A new column or panel
  presence would keep requiring framework edits even though the generic
  renderers already know how to interpret those differences.

## Consequences

- A Case Type can change a scoped Case table, dashboard presence, or Section
  layout without adding a bespoke renderer branch.
- `tsc --checkJs` rejects unknown panel keys and non-data column values in new
  Case Type descriptors.
- The scaffold emits the current full panel set, one data-only detail column,
  and the standard Section map so new Case Types begin on the supported seam.
- Permission, lifecycle, navigation, formatting, and effects remain
  discoverable in code and covered at their public behaviour seams.
- Dashboard panel declarations are unioned across the eligible Case Types. A
  Case Type that predates the additive field retains the legacy all-panels
  presence until it is migrated.
