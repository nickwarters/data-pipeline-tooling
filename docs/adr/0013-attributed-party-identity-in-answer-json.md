# 13. Attributed Party identity stored as bare account name in Answer JSON, resolved via User Profile Service

> **Amended by ADR-0020.** Attribution is no longer a dedicated `attributedParty` property
> on the Answer; it is one **Issue Capture Field** of type `person` (optionally tagged
> `role: 'attributedParty'`), declared in `captureGroups` and stored in `Answer.capture`.
> The `{loginName, displayName}` shape, User-Profile resolution, and strip/freeze lifecycle
> described below are unchanged — only the declaration and storage *site* moved.

Date: 2026-06-04

## Status

Accepted

## Context

Management asked to record, against an individual failure, the single person
responsible for it — distinct from the case-level **Responsible Party**, since
multiple people may have had a hand in a Case but one specific failure may belong
to one specific person. This is the **Attributed Party** (see CONTEXT.md):
zero-or-one per *failed* **Answer**, settable only by the **Assigned Reviewer**,
only when the **Case Type** enables `attributeFailures`, frozen at completion,
and stripped when the Answer is no longer a failure.

The requirement is that an Attributed Party be *reliably lookup-able* against the
SharePoint API. A free-typed name or email cannot be resolved back to a directory
user; an account identifier can. There is also a real scenario where the
attributed person is in the directory (AD) but has **not** yet been added to this
site's SharePoint user groups — so the design must not depend on the person
already being a site member.

Two persistence constraints apply. Per [ADR-0007], a Case stores its `answers` as
a single JSON blob on the Case row — so an Attributed Party cannot be a native
SharePoint **Person/User** column; it has to be a value inside that JSON. Per
[ADR-0009] and [ADR-0010], components never call `fetch` directly and identity is
claims-based on a single on-prem AD-backed SharePoint SE farm.

## Decision

The Attributed Party is stored on the failed Answer as
`attributedParty: { loginName, displayName }` where:

- **`loginName`** is the **bare account name** (e.g. `jsmith`) — the claims
  prefix (`i:0#.w|`) and the AD domain (`DOMAIN\`) are stripped before storage.
  Both are treated as **single constants** for this farm, held in one place in
  the service layer and reattached when calling the API. (Safe because the farm
  is single-domain; see Consequences.)
- **`displayName`** is a cached snapshot captured at attribution time, used as a
  fallback for display.

Resolution and search go behind the `SharePointClient` interface (two new
methods, both mocked for `?mock=1`):

- **`searchPeople(query)`** — backs the standalone `cr-people-picker` type-ahead.
  Wraps the people-picker REST endpoint, querying the directory/claims provider
  (so it finds users not yet added to the site), and strips each result's `Key`
  to a bare account before returning `{ loginName, displayName, email? }`. A
  free-text raw-account fallback is offered when search returns nothing.
- **`resolveUsers(accountNames[])`** — at page load, resolves the bare accounts
  on a Case to authoritative display names via the User Profile read
  `GetPropertiesFor`. Dedupes unique accounts and batches/parallelises the calls.
  The cached `displayName` is the fallback when a lookup returns nothing.

The Attributed Party is pure metadata: it never feeds `computeOutcome`.

## Considered options

- **Native SharePoint Person/User column** — rejected: incompatible with
  [ADR-0007]'s answers-as-JSON-blob model, and would require provisioning a
  column per Case Type list plus `EnsureUser` (a write side-effect that would
  silently add directory users to the site).
- **Store the full claims login string** (`i:0#.w|domain\jsmith`) — rejected as
  the *stored* form: redundant constant data on every attribution and noisier to
  read. The constants are reconstructed at the API boundary instead.
- **Resolve via the people-picker search** keyed on the stored account —
  rejected in favour of `GetPropertiesFor`, which is a clean User Profile read
  for a known account and avoids re-running a fuzzy search to resolve an exact
  identity.
- **Store name/email instead of an account id** — rejected: not reliably
  resolvable back to a directory user, which is the whole point of the feature.

## Consequences

**Positive**

- Reliable, stable join key (bare account) for any future attribution reporting,
  without storing more than needed.
- Works for directory users who aren't yet site members; no `EnsureUser` write
  side-effect at attribution time. Bulk-provisioning those users is deferred and
  decoupled.
- Claims/domain encoding is confined to the service layer; components and the
  `cr-people-picker` only ever see bare accounts. Consistent with [ADR-0009].

**Negative**

- Depends on the **single-domain** assumption. If a second AD domain is ever
  introduced, bare `loginName` becomes ambiguous and stored values would need a
  migration to disambiguate.
- The stored format is hard to change after Cases are saved: moving to full
  claims or a Person field would require a data migration across every Case Type
  list.
- A stale cached `displayName` can be shown briefly before resolution completes,
  or permanently if `GetPropertiesFor` can never resolve the account (deleted
  user). Accepted as a graceful-degradation trade-off.
- Two new methods on the `SharePointClient` interface that both real and mock
  clients must implement.

[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0009]: ./0009-mock-first-dev-loop.md
[ADR-0010]: ./0010-auth-and-permissions.md
