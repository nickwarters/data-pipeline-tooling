# Unified Issue Capture engine (grouped, typed, conditional)

## Status

Accepted. Supersedes [ADR-0017](./0017-configurable-remediation-details.md) and
the capture-specific parts of ADR-0013; lifecycle and identity-resolution rules
that it explicitly carries forward remain current.

A **Case Type** declares everything captured against a _failed_ **Answer** (an **Issue**) as one model: an ordered list of **Issue Capture Group**s, each holding ordered, typed **Issue Capture Field**s. This replaces the three previously separate concerns on a failed Answer — **Attributed Party**, **Remediation Actions**, and flat Remediation Details — with a single engine. The driver is **consolidation**: Case Type Owners workshopped a shared structure to stop Case Types diverging, and channelled all per-Case-Type variation into this one well-defined slot.

## Why one engine, not three special cases

Groups and fields are **per Case Type** (Case Type A's "Issue Originator" need not exist in Case Type B; B may have a different person field, or none). With everything configurable, there is no stable "the Attributed Party" or "the actions" to special-case. So attribution and actions become **field types** in the same engine rather than bespoke concepts with their own storage and lifecycle. One capture system, not two running in parallel — which is exactly the divergence the consolidation set out to kill.

## Declaration (per Case Type, ADR-0004)

```js
captureGroups: [
 { key, label, collapsed: true, fields: [
 { key, label, type, options?, required?, role?, showWhen? },
 ]},
]
```

- **Closed field-type set:** `text | textarea | select | radio | person | actions`. No `number` / `date` / extra multi-select — nothing workshopped needs them, and each drags in its own validation/storage. `select` covers Yes/No. `person` renders the people picker — its value comes from the directory search and only from there, so there is no free-text account entry and a search that is in flight or that failed offers nothing to select, saying which of the two it is instead; `actions` renders the existing remediation multi-select/free-text widget unchanged.
- **Field keys are unique within a Case Type** (so `showWhen` references and storage keys are unambiguous).
- **Groups are presentation only** — label, default `collapsed` state, field order. Grouping is **not** part of storage, so an Owner can move a field between groups without migrating data.
- **`showWhen` is intra-group:** a field may condition on a _sibling_ field's value on the same Answer (e.g. reveal the `person` field only when `originatorType === 'Distribution'`; reveal `actions` only when `remediationRequired === 'Yes'`). Conditioning a group on the _parent question_ is deliberately **out of scope** for now.
- **`role`** is an optional semantic tag (`attributedParty`, `remediationOwner`) letting cross-Case-Type reporting find a field regardless of its per-Case-Type key. **Not yet built** — reporting is not on the agenda; safe to add later as pure config.

## Storage

Values are stored flat by field key in `Answer.capture`:

```ts
capture: Record<
  string,
  string | { loginName: string; displayName: string } | Action[]
>;
```

This widens ADR-0017's `Record<string,string>` (forced by `person` and `actions`). It is a JSON-shape change inside the existing Answers blob — **no new SharePoint column**, ADR-0007's "everything on the row" is untouched. The dedicated `attributedParty` / `remediationDetails` Answer properties are removed; their data lives in `capture`.

## Lifecycle (inherits ADR-0013)

- **Failed Answers only.** Capture exists only while the Answer is an Issue.
- **Stripped** when the Answer is no longer a failure; **frozen** once the Case is **Completed**.
- A field hidden by `showWhen` has its value **stripped** and starts **empty** if it becomes visible again.
- Collapse/expand is **ephemeral UI state** — not persisted per Answer or Reviewer; resets to the configured `collapsed` default on reload.

## Required & the completion gate (extends ADR-0011 `canCompleteCase`)

A field is **effectively required** when `required: true` **and** its `showWhen` currently resolves true. The Case cannot be **Completed** until every effectively-required field on every failed Answer is filled — i.e. `required` gates completion **only while the field is visible**. Hidden fields never block completion.

## Surfacing

- **Issues tab:** the failed-Answer list; selecting one shows its Issue Capture Groups (collapsible drawer, one Issue at a time — the ADR-0017 master–detail pattern, now group-aware).
- **Summary tab:** the failed-question detail block renders the captured groups **expanded, read-only**, showing only visible + populated fields.

## Considered alternatives

- **Keep attribution/actions as distinct concepts; groups are just a layout container over them.** Rejected: leaves two capture systems (bespoke + generic) in parallel forever — the exact divergence consolidation targets. With per-Case-Type variability there is no stable concept to keep special.
- **Nested groups (groups-in-groups).** Rejected: one level meets every workshopped requirement; nesting adds model and UI cost for no demand.
- **Keep `Record<string,string>` and serialise everything to strings.** Rejected: `person` (`{loginName,displayName}`) and `actions` (array) are genuinely structured; stringifying them re-creates parsing/validation work at every read.
- **Persist collapse/expand per Reviewer.** Rejected: writes UI chrome into the Case row (or a per-Reviewer store we don't have) for near-zero value.

## Consequences

- `CaseTypeConfig` gains `captureGroups`; loses `remediationFields`. The `Answer` typedef gains `capture`; loses `attributedParty` and `remediationDetails`.
- ADR-0017 is superseded; ADR-0013's storage/declaration site is amended (lifecycle and identity-resolution rules survive).
- The completeness computation accounts for effectively-required (visible) capture fields on failed Answers.
- The **Remediation** tab is the tracking surface for sent actions, and **Amend Outcome** is a case-level Controls surface.
