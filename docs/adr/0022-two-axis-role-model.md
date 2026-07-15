# 22. Two-axis role model: functional capability vs per-Case-Type list access

Date: 2026-07-01

## Status

Accepted

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

UX-only capability flags per [the architecture decision]; the real boundary is still list ACLs.

| Group                    | Capability                | Notes                                                                                                                                                                                                           |
| ------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Reviewers`              | `isReviewer`              | The reviewing base role.                                                                                                                                                                                        |
| `Advisers`               | `isAdviser`               | The **frontline** base role. An Adviser is eligible to be a Case's **Responsible Party** (CONTEXT.md "Adviser"). Replaces the old `CR-ResponsibleParty` / `Frontline - Complaints` groups.                      |
| `CaseTypeOwner - <type>` | `ownedCaseTypes[]`        | **Elevated reviewing** role for one Case Type — edits that type's Question Bank (CONTEXT.md "Case Type Owner").                                                                                                 |
| `JourneyOwner - <type>`  | `ownedJourneyCaseTypes[]` | **Elevated frontline** role for one Case Type — sees the Summary of _every_ Case of its type and raises Appeals where the Case Type configures it (see [the architecture decision]). **Not** a Case Type Owner. |
| `Controls`               | `isControls`              | Resolves Appeals and authors case-level outcome amendments (see [the architecture decision], [the architecture decision]). Replaces the retired **QA Reviewer**.                                                |

The two sides mirror each other: **Reviewing** = `Reviewers` (base) → `CaseTypeOwner`
(elevated); **Frontline** = `Advisers` (base) → `JourneyOwner` (elevated).

### Axis 2 — per-Case-Type list access (which Case's list you can _open_)

| Group                | Grants                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Reviewers - <type>` | Access to that Case Type's Cases SharePoint list. **This is the real ACL boundary** for reviewing a given type. |

**`Reviewers - <type>` implies `isReviewer`** (D2). A user in any `Reviewers - <type>`
group is treated as a Reviewer without also needing standalone `Reviewers`; i.e.
`isReviewer = inGroup('Reviewers') || someType(inGroup('Reviewers - ' + typeName))`.

### Group-name ↔ slug mapping

Code keys on the Case Type **slug** (`example-review`); group display names use the
Case Type **display name** (`Example Review` — **not** "Example Case Type", D3). The
per-Case-Type group names (`Reviewers - X`, `CaseTypeOwner - X`, `JourneyOwner - X`) all
derive from one **display name declared on the Case Type module** (a `displayName`
field, [the architecture decision]). `permissions.js` composes the group names from `slug → displayName`
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

`isQaReviewer` and the `qaReviewer` group are **removed** ([the architecture decision]).

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
  home ([the architecture decision]).

## Consequences

**Positive**

- Journey Owner is a first-class capability, not a mis-filed Case Type Owner.
- Adding a Case Type is still "one module": declare `slug` + `displayName`, provision
  the derived groups. **~8 Case Types are live for September** (Example Review, Complaints,
  and ~6 more that are structurally like Complaints), so this "config + wiring only"
  property is load-bearing — each new type is groups + list + Question Bank + module
  config, no framework change.
- List access and capability are cleanly separable — the ACL boundary ([the architecture decision])
  stays authoritative while the UI gates on capability.

**Negative**

- `permissions.js`, `Capabilities`, and `resolveCapabilities` change shape; every
  consumer (section access, dashboards) updates with them.
- More groups to provision per type (Reviewers-, CaseTypeOwner-, JourneyOwner-); the
  Maintainer runbook must list them.

[the architecture decision]: ./0004-case-type-config-as-js-modules.md
[the architecture decision]: ./0010-auth-and-permissions.md
[the architecture decision]: ./0011-section-level-role-based-access.md
[the architecture decision]: ./0026-amend-outcome-case-level-and-qa-retirement.md
[the architecture decision]: ./0027-appeal-flow-journeyowner-controls.md

## Amendment (2026-07-15): app-wide eligibility rule, no default Case list (#370 / #373)

Axis 2 above named `Reviewers - <type>` as the ACL boundary but left one thing
implicit: **which Case Type lists a surface actually reads**. Before this change the
frontend still leaned on a single default Case list (`HttpSharePointClient`'s
`caseListName`, the mock's default `_cases` store), and dashboard visibility was gated
by a hard-coded slug allow-list (`DASHBOARD_ENABLED_SLUGS`). Both are removed.

### The rule (grilling D2, #370 item 7)

A user may fetch Case list **X** iff they hold **any** of X's access groups:

```
config.eligibleGroups  ∪  config.reviewerGroup  ∪  ("Reviewers - " + config.displayName)
```

Reviewer-Managers hold **every** source (they need all Case Types for fan-out
reporting/allocation). This is resolved in exactly one place —
`resolveCaseSources(userGroups)` (`src/setup/resolve-eligible-case-types.js`) — which
returns `{ slug, listName, displayName }[]`. `example-review` keeps a blanket
`Reviewers` in its `eligibleGroups`, so a plain Reviewer still sees it; every other type
requires a per-type group.

**Staging a Case Type out is a per-type group nobody holds — never a slug list in
code.** `DASHBOARD_ENABLED_SLUGS` and `resolveEligibleCaseTypes` are deleted; a contract
test (`tests/case-type-eligibility-consistency.test.js`) asserts eligibility is purely
group-derived and no module reintroduces a slug gate.

### Every list is explicit — there is no default Case list

Each Case Type declares its own `listName` (or the `Cases-{PascalSlug}` convention).
Every surface fans out its reads over the sources it is entitled to and merges, passing
an explicit `{ listName }` on every `getCase`/`patchCase`/`listCases`/`countCases`:

- **Reviewer-scoped** reads (dashboard outstanding, KPI reviewer lane, team cases,
  reports, allocation) use the eligible `caseSources`.
- **Cross-type** reads (Controls appeals, Responsible Party dashboard, Action Centre)
  use `allCaseSources` (every manifest source) — an appeal or RP Case can live in any
  list.
- **Journey Owners** reach their owned types via `resolveSourcesForSlugs`
  (`ownedJourneyCaseTypes`): a pure Journey Owner holds no reviewer/list-access group,
  so they never appear in `resolveCaseSources`.

Both `SharePointClient` implementations now **require** `opts.listName` and throw
otherwise (#376); the mock is list-store-only (no default `_cases`), and fixture
partitioning is total. The strictness flip is the enforcement mechanism: any call site
that forgets a list fails loudly in tests rather than silently reading the wrong one.

### Merge-order note (Action Centre / Controls)

Per-list counts SUM (a Case lives in exactly one list); paged "worst-first" rows are
obtained by over-fetching each list's own `[0, skip+PAGE_SIZE)` window, merging, and
re-slicing globally (`mergeWorstFirstWindow`) — the per-list server order only holds
within a list. This trades extra reads for a guaranteed-correct global order; the
"short merged page corrects the count" invariant is preserved.
