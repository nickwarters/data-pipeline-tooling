# the architecture decision: Case Type scaffolding contract

## Status

Accepted

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

The generated Case Type deliberately has no `listName` so its sample Cases are
openable in the mock store via `?mock=1` until list-backed Case Types are wired
into the mock client. The script refuses to overwrite an existing Case Type
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
  `CaseTypeOwner - X`, and `JourneyOwner - X` groups from the architecture decision.
- Re-running with an existing slug is a hard error to avoid overwriting operator
  edits.
