# 32. Data-driven Section registry: one source of truth for Case Review Sections

Date: 2026-07-11

## Status

Accepted

The code-owned Section vocabulary remains current. Views consume it through the
store-driven model in
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md), while
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md)
clarifies the boundary between Section descriptor data and branching behaviour.

Evolves ADR-0011 (section-level RBAC) and ADR-0014 (tabbed Case Review layout).

> **Update (#505):** the `componentTag` and `nodeKey` fields described below
> have been removed from `SECTION_REGISTRY`. Both existed to drive the node
> factory in `pages/cora-case-review/node-registry.js`, which ADR-0034 deleted
> along with `tab-controller.js`; the fields outlived their only consumer and
> were read by nothing. The decision this ADR records — one registry owning
> Section existence and order — is unchanged, and `sectionIds()`,
> `tabEntries()`, `summaryBlockIds()` and `sectionById()` still derive
> `SECTIONS`, `SUMMARY_SECTIONS` and the tab strip. What changed is that a
> Section's panel is no longer materialised from a tag name: `cora-case-review.js`
> places each panel by `id` in a per-Section branch, because each takes a
> different slice of state and a different set of dispatchers. Read the
> registry-shape literal in **Decision** and the `nodeKey` rationale in
> **Considered alternatives** as history.

## Context

The Case Review page is organised into **Sections** (Details, Review, Issues,
Remediation, Summary, Notes, Conversation, Appeal, Appeal Review, Amend Outcome).
Until now, the _existence_ of a Section — the fact that it is one of the things
the page knows about — was restated in three hand-maintained lists, with no
runtime or test assertion that they agreed:

1. The `SECTIONS` array (and the `Section` typedef union) in
   `src/services/section-access.js`.
2. `buildCaseReviewTabs` in `src/pages/cora-case-review/tab-controller.js`, which
   spelled out each tab's id, order and label wiring as an object literal.
3. The node factory in `src/pages/cora-case-review/node-registry.js`, which
   hand-created one `h('cora-…')` panel node per Section.

Plus `SUMMARY_SECTIONS` (a fourth ordered list) and a controller file per tab.
Adding a hypothetical "Risk Assessment" Section meant editing all of these in
lock-step — five-file surgery with nothing catching an omission. This is what
made PLAN.md's "Case Type modules are the seam… no framework changes required"
claim untrue at the Section level: Sections were not a first-class, extensible
concept, they were an implicit agreement between four literals.

## Decision

Introduce **`src/lib/section-registry.js`** as the single source of truth for
which built-in Sections exist and how they are ordered. It exports
`SECTION_REGISTRY`, one entry per Section:

```
{ id, componentTag, nodeKey, tab, tabOrder, summaryBlock, summaryOrder, showInSummaryDefault }
```

and small pure derivers — `sectionIds()`, `tabEntries()`, `summaryBlockIds()`,
`sectionById()` — each taking an optional registry argument so tests can drive
them with a fixture registry.

The previously-independent structures now **derive** from it:

- `SECTIONS` = `sectionIds()`; `SUMMARY_SECTIONS` = `summaryBlockIds()`.
- `showInSummary`'s default reads the entry's `showInSummaryDefault`.
- `buildCaseReviewTabs` maps `tabEntries()` to `{ id, label, hidden }` (labels
  still resolved per Case Type via ADR-0011/MAINT-11's `resolveSectionLabels`,
  hidden still from the resolved access map — no policy moves).
- The tab→panel map and the uniform panel nodes in `node-registry.js` are built
  by looping the registry's `componentTag`/`nodeKey`. Bespoke wiring (the
  `questions` panel is a plain `<section>` wrapping the list + progress) and
  non-Section chrome (banner, header, buttons) stay hand-written.

The role→mode access **`MATRIX` stays where it is** in `section-access.js`.
Moving 377+ lines of RBAC into data is out of scope; the registry only owns
Section _existence/order/wiring_. A contract test asserts `Object.keys(MATRIX)`
equals the registry's ids so the two cannot drift.

Scope is the **built-in** Sections. Per-Case-Type Section _extension_ (a Case
Type contributing its own Section) is a deliberate phase-2 follow-up; the
immediate goal is one source of truth, so adding a built-in Section becomes:
1 registry entry + 1 component + 1 controller.

## Considered alternatives

- **Leave the four lists, add cross-checking tests only.** Rejected: tests would
  catch drift but the lists would still need editing in lock-step. The point is
  to make _adding a Section_ cheap, not just to detect mistakes after the fact.
- **Move the whole RBAC matrix into the registry too.** Rejected for now: the
  matrix is 377+ lines of nuanced, function-valued policy (ADR-0011). Folding it
  into the registry in the same change would bury a large behavioural refactor
  inside a structural one. Keeping it separate, keyed off registry ids with a
  drift assertion, is the smaller safe step.
- **Derive the `Section` typedef union from the registry.** Not possible in
  JSDoc — a literal union can't be computed from a runtime array — so the typedef
  stays a hand-written union, and a test asserts it and the runtime `SECTIONS`
  agree via the label/registry key checks.
- **Rewrite `node-registry.js` node _keys_ to match Section ids.** Rejected: the
  keys (`questionsPanel`, `appeal`) are referenced across controllers; renaming
  them is churn with no behavioural benefit. The registry carries an explicit
  `nodeKey` per Section so the historical key names are preserved.

## Consequences

- One place lists the Sections. `SECTIONS`, `SUMMARY_SECTIONS`, the tab list, the
  tab→panel map and the uniform panel nodes all derive from `SECTION_REGISTRY`.
- Zero observable change for the ten existing Sections: same tabs, same order,
  same Summary blocks, same access decisions. The full existing suite (now
  1,967 tests) is the safety net.
- New contract tests (`tests/section-registry.test.js`) assert: the derived
  structures match the registry; `MATRIX` keys and `DEFAULT_SECTION_LABELS` keys
  equal the registry ids; every Case Type's `sections` keys are a subset of the
  registry; `tab-controller.js` no longer hardcodes Section-id literals; and —
  as a live demonstration — adding a Section to a fixture registry flows into
  every derived structure with no other edit.
- Adding a built-in Section is now: a registry entry, a component, and a
  controller — the framework plumbing follows automatically.
