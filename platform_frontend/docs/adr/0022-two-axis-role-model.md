# 22. Two-axis role model: functional capability vs per-Case-Type list access

Date: 2026-07-01

## Status

Accepted (amends [ADR-0010], [ADR-0011]; supersedes the QA Reviewer role — see [ADR-0026])

**Amended 2026-08-21, on tenant evidence.** Two corrections, both to Axis 1's
frontline row. The provisioned site-wide frontline group is **`Frontline`**, not
`Advisers` — `permissions.adviser` now reads `'Frontline'`, while the capability
stays `isAdviser` and the domain term stays **Adviser**. And `Frontline - <type>`
is **not** a retired group this one replaced: it is provisioned and working, and
it belongs on **Axis 2**, as the frontline counterpart of `Reviewers - <type>`.
Only `CR-ResponsibleParty` was retired. The tables below carry both corrections.

## Context

Pre-go-live testing forced a rethink of the group model. The recent case-list pivot
left `permissions.js` in a half-consistent state: `Reviewers - Complaints` (a list
group) sat alongside `Reviewers` (a functional group) with no stated relationship, and
`JourneyOwner - Complaints` was filed **inside** the `caseTypeOwners` map, wrongly
resolving a Journey Owner as a Case Type Owner. The business also introduced two new
words — **Adviser** and **Controls** — and a new elevated frontline role, **Journey
Owner**.

Grill decisions D1–D3 (see `docs/user-groups-workflow-grilling-session-plan.md`) settle
the model. This ADR records it.

## Decision

SharePoint groups fall on **two orthogonal axes**. Every group is one or the other.

### Axis 1 — functional capability (what you can _do_, anywhere)

UX-only capability flags per [ADR-0010]; the real boundary is still list ACLs.

| Group                    | Capability                | Notes                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Reviewers`              | `isReviewer`              | The reviewing base role.                                                                                                                                                                                                                                                                                                                                       |
| `Frontline`              | `isAdviser`               | The **frontline** base role. An Adviser is eligible to be a Case's **Responsible Party** (CONTEXT.md "Adviser"). Replaces the old `CR-ResponsibleParty` group. The capability and the domain term keep the word _Adviser_; only the group is named `Frontline`. Distinct from the Axis 2 group `Frontline - <type>`, which shares its prefix and nothing else. |
| `CaseTypeOwner - <type>` | `ownedCaseTypes[]`        | **Elevated reviewing** role for one Case Type — edits that type's Question Bank (CONTEXT.md "Case Type Owner").                                                                                                                                                                                                                                                |
| `JourneyOwner - <type>`  | `ownedJourneyCaseTypes[]` | **Elevated frontline** role for one Case Type — sees the Summary of _every_ Case of its type and raises Appeals where the Case Type configures it (see [ADR-0027]). **Not** a Case Type Owner.                                                                                                                                                                 |
| `Controls`               | `isControls`              | Resolves Appeals and authors case-level outcome amendments (see [ADR-0026], [ADR-0027]). Replaces the retired **QA Reviewer**.                                                                                                                                                                                                                                 |

The two sides mirror each other: **Reviewing** = `Reviewers` (base) → `CaseTypeOwner`
(elevated); **Frontline** = `Frontline` (base) → `JourneyOwner` (elevated).

### Axis 2 — per-Case-Type list access (which Case's list you can _open_)

| Group                    | Grants                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Reviewers - <type>`     | Access to that Case Type's Cases SharePoint list for reviewing.                                                                                                                                                                                                                                                                                                                                 |
| `Frontline - <type>`     | Access to that Case Type's Cases SharePoint list for the **frontline** side — the Responsible Party and their Manager. Implies **no** capability and is read by no frontend code: it is a pure SharePoint ACL, and the per-Case roles that use it resolve from the Case row's people fields. It is therefore absent from `caseTypeGroupNames()`, which composes the three groups the app reads. |
| `CaseTypeOwner - <type>` | Access to that Case Type's list for Question Bank ownership and reporting.                                                                                                                                                                                                                                                                                                                      |
| `JourneyOwner - <type>`  | Access to that Case Type's list for journey oversight and Appeals.                                                                                                                                                                                                                                                                                                                              |
| Broad functional roles   | Controls, Reviewer Managers, Frontline and ResponsibleParty-Managers span all Case Type lists, with assignment filters.                                                                                                                                                                                                                                                                         |

These grants describe the frontend's source selection; SharePoint list ACLs remain
the real security boundary.

**`Reviewers - <type>` implies `isReviewer`** (D2). A user in any `Reviewers - <type>`
group is treated as a Reviewer without also needing standalone `Reviewers`; i.e.
`isReviewer = inGroup('Reviewers') || someType(inGroup('Reviewers - ' + typeName))`.

### Group-name ↔ slug mapping

Code keys on the Case Type **slug** (`example-review`); group display names use the
Case Type **display name** (`Example Review` — **not** "Example Case Type", D3). The
per-Case-Type group names (`Reviewers - X`, `CaseTypeOwner - X`, `JourneyOwner - X`) all
derive from one **display name declared on the Case Type module** (a `displayName`
field, [ADR-0004]). `permissions.js` composes the group names from `slug → displayName`
rather than hard-coding each string, so provisioning a new type needs one name, not
three hand-written groups.

### `Capabilities` shape (revised)

```js
/** @typedef {{
 * isReviewer: boolean, // includes any Reviewers - <type>
 * listAccessCaseTypes: string[], // slugs from Reviewers - <type>
 * isAdviser: boolean,
 * ownedCaseTypes: string[], // CaseTypeOwner - <type>
 * ownedJourneyCaseTypes: string[], // JourneyOwner - <type>
 * isControls: boolean,
 * isReviewerManager: boolean,
 * isResponsiblePartyManager: boolean,
 * isMaintainer: boolean,
 * isVisitor: boolean // derived: no role at all
 * }} Capabilities */
```

`isQaReviewer` and the `qaReviewer` group are **removed** ([ADR-0026]).

## Considered options

- **Keep a single flat group list** (status quo of the half-pivot) — rejected: it
  conflated list access with capability and mis-modelled Journey Owner.
- **Make `Reviewers - <type>` the _only_ reviewer signal** (drop standalone
  `Reviewers`) — rejected: a Reviewer Manager or cross-type reviewer may hold the
  functional role without a single list; keeping both, with the list implying the
  function, covers both shapes.
- **Derive group names by convention only, no per-type declaration** — rejected: the
  slug (`example-review`) and the display name (`Example Review`) genuinely differ, so
  one authoritative mapping must exist somewhere; the Case Type module is the natural
  home ([ADR-0004]).

## Consequences

**Positive**

- Journey Owner is a first-class capability, not a mis-filed Case Type Owner.
- Adding a Case Type is still "one module": declare `slug` + `displayName`, provision
  the derived groups. **~8 Case Types are live for September** (Example Review, Complaints,
  and ~6 more that are structurally like Complaints), so this "config + wiring only"
  property is load-bearing — each new type is groups + list + Question Bank + module
  config, no framework change.
- List access and capability are cleanly separable — the ACL boundary ([ADR-0010])
  stays authoritative while the UI gates on capability.

**Negative**

- `permissions.js`, `Capabilities`, and `resolveCapabilities` change shape; every
  consumer (section access, dashboards) updates with them.
- More groups to provision per type (Reviewers-, CaseTypeOwner-, JourneyOwner-); the
  Maintainer runbook must list them.

[ADR-0004]: ./0004-case-type-config-as-js-modules.md
[ADR-0010]: ./0010-auth-and-permissions.md
[ADR-0011]: ./0011-section-level-role-based-access.md
[ADR-0026]: ./0026-amend-outcome-case-level-and-qa-retirement.md
[ADR-0027]: ./0027-appeal-flow-journeyowner-controls.md

## Amendment (2026-07-15): app-wide eligibility rule, no default Case list (#370 / #373)

Axis 2 above named `Reviewers - <type>` as the ACL boundary but left one thing
implicit: **which Case Type lists a surface actually reads**. Before this change the
frontend still leaned on a single default Case list (`HttpSharePointClient`'s
`caseListName`, the mock's default `_cases` store), and dashboard visibility was gated
by a hard-coded slug allow-list (`DASHBOARD_ENABLED_SLUGS`). Both are removed.

### The rule (grilling D2, #370 item 7)

A user may fetch Case list **X** when they hold one of X's type-scoped roles:

```
"Reviewers - " + config.displayName
"CaseTypeOwner - " + config.displayName
"JourneyOwner - " + config.displayName
```

`config.eligibleGroups` and `config.reviewerGroup` remain supported aliases for
a type's access groups. Controls, Reviewer Managers, Frontline,
ResponsibleParty-Managers and Maintainers span **every** source. Maintainers
need this access to preview sample Cases while editing every Question Bank. Adviser and
ResponsibleParty-Manager reads remain query-filtered by the Case row's
Responsible Party or Responsible Party Manager field; broad list eligibility
does not make those reads unscoped. (In practice only the Adviser half of that
sentence is built: there is no `responsiblePartyManager` predicate in
`ListCasesFilter` and no Responsible Party Manager report — see
[ADR-0038](./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md),
which decides what that field is for.) This is resolved in exactly one place —
`resolveCaseSources(userGroups)` (`src/setup/resolve-eligible-case-types.js`) — which
returns `{ slug, listName, displayName }[]`. Every type requires a per-type
group: no Case Type declares a blanket `Reviewers` in its `eligibleGroups`, so
the bare functional group grants no source on its own. (The `example-review`
test fixture did until #527; it modelled a grant the scaffold had already
stopped generating.)

**Staging a Case Type out is a per-type group nobody holds — never a slug list in
code.** `DASHBOARD_ENABLED_SLUGS` and `resolveEligibleCaseTypes` are deleted; a contract
test (`tests/case-type-eligibility-consistency.test.js`) asserts eligibility is purely
group-derived and no module reintroduces a slug gate.

### Every list is explicit — there is no default Case list

Each Case Type declares its own `listName`; the resolver has no naming fallback.
Every surface fans out its reads over the sources it is entitled to and merges, passing
an explicit `{ listName }` on every `getCase`/`patchCase`/`listCases`/`countCases`:

- **Reviewer-scoped** reads (dashboard outstanding, KPI reviewer lane, team cases,
  reports, allocation) use the eligible `caseSources`.
- **Broad-role** reads (Controls appeals, Adviser/RP dashboards, manager
  reporting, and Maintainer Question Bank samples) receive every manifest
  source, while retaining their role-specific
  server-side filters.
- **Type-scoped owner** reads receive only sources derived from their
  `CaseTypeOwner - X` or `JourneyOwner - X` groups. The compatibility-named
  `caseSources` app context therefore means every source the current user's
  roles may span, not an unconditional manifest list. Components may call this
  input `allCaseSources` when they fan out across the whole authorized set.

SharePoint provisioning MUST grant each broad-role group read access to every
Case Type list before that type is enabled. Multi-list reads deliberately fail
as a unit if any authorized list is inaccessible: a 403 indicates broken ACL
provisioning, not optional data that the UI may silently omit.

Both `SharePointClient` implementations now **require** `opts.listName` and throw
otherwise (#376); the mock is list-store-only (no default `_cases`), and fixture
partitioning is total. The strictness flip is the enforcement mechanism: any call site
that forgets a list fails loudly in tests rather than silently reading the wrong one.

## Amendment (2026-08-11): `listName` is the Case Type scope

The one-list-per-Case-Type decision has a direct client-contract consequence:
`CaseListOptions.listName` is the Case Type scope for every read. `ListCasesFilter`
therefore contains row predicates only and does not declare a redundant
`caseType` field. `CaseRow.caseType` remains genuine returned data.

Search and Team Cases may still carry a Case Type in their service or URL
vocabulary when choosing which source lists to query. They resolve that choice
to `listName` and pass only the shared row predicates to `SharePointClient`.

### Merge-order note (Action Centre / Controls)

Per-list counts SUM (a Case lives in exactly one list); paged "worst-first" rows are
obtained by over-fetching each list's own `[0, skip+PAGE_SIZE)` window, merging, and
re-slicing globally (`mergeWorstFirstWindow`) — the per-list server order only holds
within a list. This trades extra reads for a guaranteed-correct global order; the
"short merged page corrects the count" invariant is preserved.
