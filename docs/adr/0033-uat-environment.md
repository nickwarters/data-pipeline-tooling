# 33. UAT environment: separate code copy, host page, and prefixed lists

Date: 2026-07-14

## Status

Accepted

Extends ADR-0021 (versioned Question Bank exports) and the hosting model in
the README (Style Library + Content Editor host page).

## Context

Changes need somewhere to be exercised against the **live SharePoint
environment** — real NTLM/Kerberos auth, real REST behaviour, real list
semantics — before they reach production users. The `?mock=1` dev loop
deliberately bypasses all of that, so it cannot serve as UAT. But pointing a
test deployment at the production lists would let UAT sessions write into
production Cases.

What was missing was an **environment** concept: a way to run the same
codebase, unmodified, against a parallel, isolated set of SharePoint
resources on the same site.

## Decision

An environment is the combination of three things, all on the same site:

1. **Code location** — an independent deployed copy of the runtime tree.
   Prod deploys to `Style Library/CODE/CORA`; UAT deploys to
   `Style Library/CODE/CORA-UAT` via
   `scripts/deploy_to_sharepoint.py --env uat`. The sync engine keeps the
   folders fully independent.
2. **Host page** — one `.aspx` page per environment. Prod's
   `SitePages/app.aspx` Content Editor points at the prod copy's
   `host/index.html`; UAT's `SitePages/uat.app.aspx` points at the UAT
   copy's. No query params: **the deployed host page declares its
   environment**, via a `{{CORA_ENV}}` deploy-time token that becomes
   `window.CORA_ENV` — the same templating mechanism as `{{CORA_BASE}}`.
3. **Data location** — every SharePoint list name carries an environment
   prefix: `uat_Cases-ExampleReview`, `uat_QuestionDefinitions`,
   `uat_complaints`. Prod is unprefixed, so existing deployments are
   untouched.

In code:

- `src/config/environment.js` is the single place the environment is
  resolved (`resolveEnvironment()` → name, `listPrefix`, `exportBasePath`).
  Anything other than the literal `'uat'` — including `undefined` and an
  unsubstituted token — resolves to prod. Nothing else in the codebase may
  branch on the environment name.
- `HttpSharePointClient` applies `listPrefix` centrally in its two URL
  builders, so **every** list access is scoped — the default Case list,
  `QuestionDefinitions`, and per-Case-Type `listName` overrides alike. Case
  Type modules stay environment-agnostic.
- The versioned Question Bank export path (ADR-0021) is likewise
  environment-scoped (`Style Library/case-review-uat/case-types` on UAT), so
  a UAT Case completion never reads prod's point-in-time bank snapshots.
- The mock client ignores environments entirely; `?mock=1` behaves as
  before.
- A fixed UAT banner (`src/setup/uat-banner.js`) is mounted at boot on any
  non-prod environment so nobody mistakes which environment they are
  editing.

Out of the app's scope (manual, once per environment): creating
`uat.app.aspx` with its Content Editor, and creating the `uat_*` list copies
with the same schema as their prod counterparts. Security groups are shared
with prod — client-side checks remain UX-only (ADR-0007-style boundary); the
`uat_*` lists' own ACLs are the real boundary on UAT data.

## Alternatives considered

- **A separate SharePoint subsite/web for UAT.** Cleaner isolation (own
  Style Library, own lists, zero prefixing code) but more SharePoint admin
  surface and a second site to permission and maintain. The prefixed-list
  model keeps UAT one deploy flag away on the existing site. Revisit if
  list-prefix sprawl becomes a burden.
- **A `?env=uat` query param.** Rejected: trivially easy to end up on the
  wrong environment (params are lost on navigation, bookmarks lie), and it
  would let any prod visitor point the prod code at UAT lists or vice versa.
  Binding the environment to the deployed host page makes the URL itself
  the environment.

## Consequences

- Deploying a branch to UAT is: `deploy_to_sharepoint.py --env uat`, then
  visit `SitePages/uat.app.aspx`. Prod code, prod lists, and prod exports
  are untouched by construction.
- New list access paths must go through `HttpSharePointClient`'s URL
  builders (they do anyway — components never call `fetch`), otherwise they
  would silently escape the environment scoping.
- Anyone adding a new SharePoint list must also create its `uat_*` copy for
  UAT to keep working.
