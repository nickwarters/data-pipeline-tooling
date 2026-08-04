# ADR-0028: Case Type scaffolding contract

## Status

Accepted, as amended 2026-07 (#525) — see **Amendment (2026-07, #525)** below,
which replaces the "deliberately has no `listName`" paragraph.

## Context

Provisioning a new Case Type crosses the Case Type module, manifest,
permissions, section access assumptions, mock personas, mock Cases, and tests.
Hand-editing that spread is easy to do inconsistently, especially before the
SharePoint list and group provisioning has caught up with the application
configuration.

## Decision

Case Type provisioning starts with:

```sh
python3 scripts/scaffold_case_type.py --slug widget-review --display "Widget Review"
```

The Python scaffold creates a plain-data Case Type module, registers it in the
manifest, appends the single permissions entry from which the per-Case-Type
SharePoint group names derive, adds mock personas, adds one outstanding and one
Completed mock Case, and creates a focused test file for the generated contract.

> **Superseded by the amendment below.** The generated Case Type deliberately
> has no `listName` so its sample Cases are openable in the mock store via
> `?mock=1` until list-backed Case Types are wired into the mock client.

The script refuses to overwrite an existing Case Type
slug; maintainers should edit an existing type directly once it has real
business configuration.

Section access remains shared in `src/services/section-access.js`. The scaffold
generates the standard Section set and relies on the existing role x Section
matrix rather than creating per-type matrix rows. Per-type overrides should be a
deliberate follow-up design decision, not hidden scaffolding behavior.

The scaffold covers only the application config. The remaining
SharePoint-side provisioning — creating the `Cases-{slug}` list, adding its
columns, **indexing the required columns while the list is still empty**
, and creating the per-Case-Type groups — is a standing checklist,
not tribal knowledge. It lives in the maintainer-facing
[Case Type onboarding checklist](../case-type-onboarding.md), which also carries
the documented `Cases-{slug}` column schema (all columns, which are indexed, and
app-writes-it provenance).

## Consequences

- Maintainers get a runnable first slice before SharePoint list-backing exists.
- List provisioning is doc-driven via the
  [Case Type onboarding checklist](../case-type-onboarding.md): the required
  indexed columns must be created on the _empty_ list, because a SharePoint
  index cannot be added past the List View Threshold — an
  irreversible timing trap.
- The generated module includes TODO markers for the Question Bank, Outcome
  vocabulary, appeal raiser, Case Details fields, and SLA hours.
- The generated mock personas exercise the derived `Reviewers - X`,
  `CaseTypeOwner - X`, and `JourneyOwner - X` groups from ADR-0022.
- Re-running with an existing slug is a hard error to avoid overwriting operator
  edits.

## Amendment (2026-07, #525) — the scaffold declares a `listName`, and its sign-off is exact

The original decision's "deliberately has no `listName`" rationale stopped being
true when issue #249 removed the mock client's default store in
[create-sharepoint-client.js](../../src/services/create-sharepoint-client.js).
`partitionCasesByList` is now a _total_ partition: every fixture Case must map
to a Case Type's declared list, and a Case Type without one has nowhere to put
its Cases, so they are dropped and reported (contained per Case Type under
[ADR-0004](./0004-case-type-config-as-js-modules.md); it threw outright until
then). The scaffold wrote mock Cases _and_ omitted the
`listName` those Cases require, so the two halves of its own output contradicted
each other — and because the partition runs before the mock client is
constructed, one scaffolded Case Type broke `?mock=1` for **every** Case Type,
not just its own. The dev loop the project calls mock-first died on a command
whose whole promise is a runnable first slice.

Three changes:

1. **The scaffold takes `--list-name`, defaulted from the slug** by the
   `Cases-{PascalSlug}` convention the provisioned lists already follow
   (`widget-review` → `Cases-WidgetReview`). The generated module declares it.
   The generated Case Type is now list-backed from the first run, which is what
   makes its sample Cases openable in `?mock=1` — the opposite of the original
   rationale, and for the same goal.
2. **The scaffold generates no `eligibleGroups` at all.** It first emitted the
   org-wide `Reviewers` — a brand-new Case Type granting itself to every
   Reviewer in the organisation, a scaffolding accident rather than a decision —
   and was then corrected to the derived `Reviewers - <Display Name>`. That was
   still wrong, just less loudly: the three derived names are already granted
   from the registry display name (#527), so restating one of them makes a
   second, INDEPENDENT grant. Renaming the registry entry moves the derived
   names but not the restated copy, leaving the decommissioned group still
   granting access to anyone who was never removed from it — the opposite of
   what a rename is for. `eligibleGroups` is for genuinely extra groups; the
   generated personas already exercise the derived ones.
3. **The scaffold appends its module to CLAUDE.md's Directory layout block**,
   which `tests/claude-md-layout-contract.test.js` checks.

What is deliberately _not_ automated: the registry-contract tests in
`tests/case-type-manifest.test.js` that pin the known slugs as a closed set,
because `UnknownCaseTypeError` names them in a message a developer reads. A
script that rewrote the assertions guarding the registry would defeat the
guard. They stay red after a scaffold **by design**, and both ends now say so —
the assertions carry a message identifying the scaffold as the expected cause,
and the script's closing message names those exact tests. The sign-off is
therefore honest: `npm run check` is green, `node --test` is green apart from a
named, enumerated list, and any other failure is a real one.

- Consequence: a scaffolded Case Type no longer breaks the mock dev loop for the
  Case Types that already worked.
- Consequence: the `Cases-{PascalSlug}` default couples the scaffold to the list
  naming convention. `--list-name` is the escape hatch for a Case Type whose
  list was provisioned under another name.
