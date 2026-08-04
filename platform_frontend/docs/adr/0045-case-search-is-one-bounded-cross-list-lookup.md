# ADR-0045: Case search is one bounded cross-list lookup, not a search box per Case Type

- Status: Accepted
- Date: 2026-08-03
- Applies: [ADR-0031](./0031-scaling-against-the-list-view-threshold.md)
- Extends: [ADR-0007](./0007-case-storage-shape.md)
- Leaves unchanged: [ADR-0040](./0040-case-tables-are-framework-owned.md)

## Context

Every Case-listing page in the app is a role-scoped worklist: the Dashboard,
Team Cases, Journey Cases, My Cases. All of them answer "what is mine, or my
team's, right now". None of them answers "where is Case X?", and Controls need
that answer without first guessing which Case Type list the Case lives in.

Two constraints shape any answer:

- Cases are one list per Case Type ([ADR-0007]), so a cross-Case-Type lookup is
  a fan-out, not a query.
- SharePoint's List View Threshold ([ADR-0031]) throttles a query whose leading
  predicate is not an indexed, selective column, and an index cannot be added to
  a list that is already past 5,000 items.

## Decision

**One `#/search` route, bounded, whose every predicate is index-served.**

### One search, not one per Case Type

Search is a single page fanning out over the viewer's Case sources, not a box
embedded in each Case Type's own view. A per-Case-Type box would answer the
question the user already knew the answer to — which list to look in — and
would multiply the number of places a filter has to be added.

### `Title` becomes the Case Reference, and is indexed

`Title` carried no purpose in the domain. It is now the Case Reference: the
human-facing identifier a person quotes, and the column search matches on. That
makes it an indexed column on every `Cases-{slug}` list, alongside
`ReportableAt`.

Both are subject to ADR-0031's index-at-creation trap without softening: a list
already past the threshold cannot gain either index. Indexing them is a
provisioning precondition for search on an existing list, not follow-up work.

### Prefix match only — `substringof` is rejected

The Reference filter emits `startswith(Title,'…')`. It is never `substringof`.
An unanchored contains cannot be served from a column index, so past the
threshold SharePoint throttles or refuses it — a search that works in UAT and
fails in production two years in is worse than one that never offered the
behaviour. The match is case-insensitive, because that is what SharePoint's own
`startswith` does — its text comparisons run under a case-insensitive collation
by default, which Microsoft documents for `StartsWith`/`EndsWith` against
SharePoint sources. Both the mock client and the test suite's `$filter`
evaluator therefore model the server rather than JavaScript, whose
`String.prototype.startsWith` is case-_sensitive_ and would have quietly
disagreed with production.

### The filter panel is not a `<form>`

The host `.aspx` page wraps the whole app — Content Editor and all — in its own
`<form>`. HTML forbids nesting one form in another, so a `<form>` a view renders
is not a form the browser honours: Enter inside it posts the _host_ page back,
the page reloads, the hash route is re-entered from scratch, and any unsaved
route state is gone. The dev harness has no outer form, so this reproduces only
once deployed.

The filters are therefore a plain container with `role="search"`, a
`type="button"` button, and an explicit Enter handler that yields to the people
picker while it is offering matches to choose. The affordances survive; the
element that breaks the host does not.
`tests/no-nested-form-contract.test.js` is the ratchet, and it matches across
newlines because the formatter splits the offending call over several lines —
a line-by-line scan would miss the exact spelling it exists to catch.

### The `reportableAt` window leads the expression

`reportableAfter`/`reportableBefore` sit immediately after the existing
`CompletedAt` window in `buildFilterExpr` and before every other predicate, for
the same reason: an indexed date range is the most selective thing a lookup
carries, and the expression must narrow before it reaches the less selective
columns. Inclusive lower bound, exclusive upper, so adjacent windows never
double-count.

### Bounded window, saturation detected, deep paging out of scope

Each list is read with `top = N + 1`, newest-first by `Id`; the results are
merged, re-sorted by the same key, then sliced to `N`. A Case's rank within
its own list can never be better than its rank across every list combined, so
the true global top `N` all appear in some list's local top `N + 1`; the merged
length exceeding `N` is therefore exactly the condition "there are more matches
than we are showing". The page says so — "showing the first N, narrow your
filters" — rather than offering a next page.

Correctly-merged deep paging across N lists needs per-list offset bookkeeping
and is explicitly not in scope. A lookup returning more than a screenful is a
signal to narrow the filters, not to page.

Ordering is by `Id` descending, not by Reference: `Id` is intrinsically indexed
so `$orderby` stays threshold-safe, and "the most recent matching Cases" is what
a lookup wants — an alphabetical slice tells the user nothing when they searched
by Reviewer or by date.

### One failing list fails the whole search

The fan-out is `listCasesAcrossSources`, which fails as a unit. A 403 on one
list means broken ACL provisioning, and here more than anywhere else it must
surface: a quietly-omitted list reports "not found" for a Case that exists.

### Access is a derived capability, not a group check at the call site

`canSearchCases` is resolved in `services/permissions.js` from `isControls`, and
the route table's guard reads the capability. Widening search to a second role
is one line in the capability resolver and touches no route, no page and no nav.

## Consequences

- A `Cases-{slug}` list provisioned before this ADR and already past 5,000 items
  cannot support search until it is re-provisioned. This is a real operational
  cost and is stated in [`docs/case-type-onboarding.md`](../case-type-onboarding.md).
- Per-Case-Type reference fields (`complaintRef` and friends) live inside the
  unindexed `Details` blob and remain unqueryable server-side. Promoting one to
  a real indexed column is the documented escape hatch and is tracked separately.
- Case columns stay framework-owned ([ADR-0040]): scoping a search narrows its
  rows and never its columns.

[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0031]: ./0031-scaling-against-the-list-view-threshold.md
[ADR-0040]: ./0040-case-tables-are-framework-owned.md
