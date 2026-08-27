# 33. UAT environment: separate code copy, host page, and prefixed lists

Date: 2026-07-14

## Status

Accepted. Amended 2026-08-27: the two-environment model became a table of
environments — see "Amendment" below.

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
3. **Data location** — every SharePoint Case list name carries an environment
   prefix: `uat_Cases-ExampleReview`, `uat_complaints`. Question Bank text
   artifacts and their published versions are not prefixed at all: they ship
   with the code, so each deploy already has its own copy. Prod is unprefixed,
   so existing deployments are untouched.

In code:

- `src/config/environment.js` is the single place the environment is
  resolved (`resolveEnvironment()` → name, `listPrefix`).
  Anything other than the literal `'uat'` — including `undefined` and an
  unsubstituted token — resolves to prod. Nothing else in the codebase may
  branch on the environment name.
- `HttpSharePointClient` applies `listPrefix` centrally in its two URL
  builders, so **every** Case-list access is scoped, including per-Case-Type
  `listName` values. Case Type modules stay environment-agnostic.
- Question Bank artifacts — the bank and its published versions (ADR-0021) —
  are read out of the deployed `case-types/banks/` folder, resolved relative to
  the module that reads them. A UAT deploy therefore reads UAT's artifacts
  because of where it was deployed, and a UAT Case completion never reaches
  prod's point-in-time snapshots. This **supersedes** the `exportBasePath` this
  ADR originally declared: a second per-environment path is a thing that can
  disagree with the first, and it has been removed rather than kept in step.
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

## Amendment (2026-08-27): environments are a table, not a pair

A third environment, `training`, was needed and the model above already
described it — nothing about UAT was specific to UAT except the literal
`'uat'` spelled in the resolver, the deploy script and the tests. The decision
is therefore generalised rather than extended:

- An environment is a **name**. Prod is the unprefixed baseline; for any other
  name `<name>` the three pieces follow one convention — code folder
  `CODE/CORA-<NAME>`, host page `SitePages/<name>.app.aspx`, list prefix
  `<name>_`.
- The names are declared in exactly two places, `ENVIRONMENT_NAMES` in
  `src/config/environment.js` and in `scripts/deploy_to_sharepoint.py`, and a
  test holds the two lists equal. Everything else derives from the name;
  nothing else in the codebase names an environment.
- `resolveEnvironment()` resolves any name **not** in the table to prod, so
  an unsubstituted token and the dev loop behave as before — and so a host
  page declaring a name the deployed app does not know runs against prod's
  lists. The name must be released before it is deployed.
- The badge (`src/setup/uat-banner.js`) already rendered for any non-prod
  environment from `env.name`; it keeps its file name.

What is still manual per environment — lists, host page, ACLs — is written up
once in `docs/guide/provisioning-an-environment.md`. The alternative above (a
separate subsite per environment) stands as the thing to revisit if that
per-environment chore becomes the dominant cost of a release.
