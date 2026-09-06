# 53. Section Plugin Architecture

Date: 2026-09-05

## Status

Accepted as amended by
[ADR-0054](./0054-application-config-is-the-composition-root.md): a Section
still declares itself, but the list of them is named by the application's
composition root rather than by `src/sections/registry.js`. Two sections below
are stale as a result — **Registry & Lifecycle**, **The irreducible part** and
**Types** — and each carries a pointer to the amendment that supersedes it.
A separate **Correction** at the end records a claim this ADR made that was not
true when it was written.

Supersedes the monolithic access matrix in [ADR-0011](./0011-section-level-role-based-access.md)
and the static panel map in [ADR-0032](./0032-data-driven-section-registry.md).
Builds upon the store-driven view model in [ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md).

## Context

Historically, Case Review sections were managed across three disparate, statically coupled structures:

1. **Layout & Ordering:** `src/lib/section-registry.js` declared a static `SECTION_REGISTRY` array defining tab ordering, summary block configuration, and IDs. (Removed by the amendment below.)
2. **Access Control:** `src/services/section-access.js` maintained a monolithic `MATRIX` constant mapping every section against every role (`Section × Role → Mode`), with scattered edge-case evaluators.
3. **Panel Rendering:** `src/pages/cora-case-review/section-panels.js` maintained a fixed `SECTION_PANELS` dictionary mapping section IDs to render functions.

This fragmentation created several architectural liabilities:

- **High Coordination Overhead & Drift Risk:** Adding, altering, or removing a section required synchronizing three separate files and cross-checking multiple unit test assertions.
- **Inflexibility for Case Types:** Case types were restricted to the ten built-in sections. Specialized case workflows (such as Admin Case Details with read-only overrides and custom audit fields) could not declare bespoke sections or cleanly alter section metadata without hacking global fixtures.
- **Unclear Seams:** Section view logic, section-specific action dispatching, and section access rules were scattered across services and views instead of being encapsulated as cohesive units.

## Decision

We introduce a unified **Section Plugin Architecture** centered around an extensible plugin contract and runtime registry in `src/sections/registry.js`.

### 1. SectionPlugin Contract

Every Case Review section is implemented as a self-contained plugin implementing the `SectionPlugin` contract:

```typescript
interface SectionPlugin {
  /** Unique section ID (e.g., 'details', 'questions', 'adminDetails') */
  id: string;
  /** Whether the section renders as a tab in the main Case Review navigation */
  tab: boolean;
  /** Sort order within the tab bar (1-based, left to right) */
  tabOrder: number;
  /** Whether the section contributes a block to the Summary view */
  summaryBlock?: boolean;
  /** Sort order within the Summary view */
  summaryOrder?: number;
  /** Default summary inclusion when Case Type does not configure showInSummary */
  showInSummaryDefault?: boolean;
  /** Default tab and panel header labels */
  defaultLabels: { tab: string; heading: string };
  /** Pure, synchronous role-based access evaluator */
  evaluateAccess: (ctx: {
    caseRow: CaseRow;
    roles: Role[];
    capabilities?: Capabilities;
    sectionConfig?: any;
    catalogue?: QuestionDefinition[];
    config?: CaseTypeConfig;
  }) => 'edit' | 'read-only' | 'hidden';
  /** Panel view renderer producing DOM nodes */
  view: (panelContext: PanelContext) => Node | Node[] | null;
}
```

### 2. Registry & Lifecycle

> **Stale.** The registry seeds itself with nothing now, `AdminDetailsPlugin`
> was removed with its Section, and `resetSectionRegistry()` is gone. See
> _Amendment: the application composes the Sections_ below.

- `src/sections/registry.js` maintains an in-memory registry (`Map<string, SectionPlugin>`) seeded with all built-in plugins:
  - `DetailsPlugin` (`details`)
  - `AdminDetailsPlugin` (`adminDetails`)
  - `QuestionsPlugin` (`questions`)
  - `IssuesPlugin` (`issues`)
  - `SummaryPlugin` (`summary`)
  - `RemediationPlugin` (`remediation`)
  - `NotesPlugin` (`notes`)
  - `ConversationPlugin` (`conversation`)
  - `AppealRequestPlugin` (`appealRequest`)
  - `AppealReviewPlugin` (`appealReview`)
  - `AmendOutcomePlugin` (`amendOutcome`)
- Consumers query plugins through `getSectionPlugins()` or `getSectionPlugin(id)`.
- Case Review's render loop (`src/pages/cora-case-review.js`) queries registered plugins dynamically to instantiate panels, evaluate tab strip labels and visibility, and mount active panels.
- Custom plugins can be registered or overridden at boot/initialization time via `registerSectionPlugin(plugin)`, and `resetSectionRegistry()` restores the baseline for tests. Runtime plugin registration is boot-time only; the render loop consumes the boot-time registered plugins.

### 3. Decommissioning the Legacy Matrix and Static Panel Map

- **`MATRIX` Decommissioned:** The monolithic `MATRIX` constant in `src/services/section-access.js` is removed. `evaluateAccess` now resolves the section plugin and delegates directly to `plugin.evaluateAccess(ctx)`.
- **`SECTION_PANELS` Decommissioned:** The static `SECTION_PANELS` map in `src/pages/cora-case-review/section-panels.js` is deleted. View rendering logic is inlined into each standalone section plugin. `section-panels.js` remains exclusively for shared JSDoc typedefs (`PanelContext`, `PanelActions`). **A second id-to-renderer switch survived this and was missed — see the correction below.**
- **Dead Code Cleanup:** All compatibility shims and unreferenced exports (such as `tabEntries`) are retired.

### 4. Preserving the Performance Constraint (~5ms Keystroke SLA)

A primary performance constraint of CORA is the **~5ms keystroke SLA**: interactive typing and state updates during review must never be blocked by architectural abstractions.

The Section Plugin Architecture satisfies this constraint:

1. **O(1) Synchronous Access Checks:** Registry lookups use native JavaScript `Map.get()`. Each plugin's `evaluateAccess` method is a pure synchronous function operating on in-memory status codes and array inclusions (`roles.includes(...)`), avoiding allocations, asynchronous promises, or expensive traversals.
2. **Zero Overhead During Keystrokes:** Keystrokes within form inputs trigger lightweight store updates without re-evaluating section registrations or rebuilding tab panels.
3. **No Dynamic Loading Penalty:** All standard section plugins are statically bundled with the application, ensuring zero network fetch latency when opening tabs or rendering panels.

## Consequences

### Positive

- **Cohesion:** Section access, tab metadata, labels, and rendering live together in a single plugin module per section (`src/sections/<section>/<section>-plugin.js`).
- **Extensibility:** A Case Type can enable, disable and configure a Section through its `sections` descriptor without touching that Section's code, and a new Section is authored as one module rather than as edits spread across an access matrix, a panel map and a registry. It is not free of framework edits: `adminDetails` needed a `SectionConfig` shape, a `verify-config.js` rule and a reducer branch, because a descriptor may select behaviour but may not introduce it.
- **Robust Testing:** Every section plugin is independently unit-tested for contract conformance, access evaluation, and view rendering.
- **Clean Architecture:** Eliminates legacy `MATRIX` and `SECTION_PANELS` drift risks and achieves 0 dead code across the frontend. Read as amended by the correction below: one of the two switch shapes this claimed to have eliminated was still there.

### Negative / Trade-offs

- Tests verifying section access must now either call `evaluateAccess` or `getSectionPlugin(id).evaluateAccess(...)` instead of inspecting matrix cell functions directly.

## Amendment: the plugins declare themselves

The first cut of this architecture left a Section's facts in three places —
`SECTION_REGISTRY` for layout, `DEFAULT_SECTION_LABELS` for copy, and the plugin
for everything else — with tests holding them in step by hand. That is the
coordination cost the epic set out to remove, and keeping it had a cost beyond
tidiness: `adminDetails` was declared as a plugin and not in the registry, so it
fell out of every registry-derived structure, and `case-loader`'s "this viewer
can see nothing" guard denied access to the one Role the Section existed for.

The blocker was believed to be the type system: the `Section` id union needs a
`const` literal, and a runtime `Map` of plugins cannot produce one. It does not.
A plugin annotated `@satisfies` rather than `@type` keeps its literal `id`, so
the union projects from the plugins that satisfy the contract:

```js
/** @satisfies {import('../contract.js').SectionPlugin} */
export const DetailsPlugin = /** @type {const} */ ({ id: 'details', ... });
```

```js
/** @typedef {ReturnType<typeof builtInSectionPlugins>[number]['id']} Section */
```

`@type` was what erased the literals and forced the second table to exist.

### What changed

- `src/lib/section-registry.js` is deleted. `src/sections/registry.js` holds the
  manifest, and `sectionIds`, `summaryBlockIds`, `showInSummaryDefaultOf` and
  `defaultSectionLabels` are all projected from it.
- `DEFAULT_SECTION_LABELS` is deleted. A Section's tab caption and panel heading
  are part of what it is, so they live on the plugin. They had already drifted:
  the map said the Questions tab read `Review` and the plugin said `Questions`,
  and the map silently won for all ten Sections.
- The contract moved to `src/sections/contract.js`, which names no plugin. With
  it in `registry.js` the union referenced itself through the plugins.
- The lifecycle predicates moved to `src/evaluators/case-lifecycle.js`. Plugins
  imported them upward from `services/section-access.js`, which reaches the
  plugins back through the registry; with the manifest evaluated during module
  loading that cycle is a temporal dead zone rather than a tolerable knot.
- The manifest is a **function**, not a module-scope array, for the same reason:
  a plugin's `view` imports the page components it renders, and those reach back
  here. A function body is not evaluated until it is called.
- `sectionIds()` and friends read the **live registry**, not the built-in
  manifest, so a plugin registered at boot appears in them. Reading the manifest
  instead would reintroduce exactly the membership gap described above.

### The irreducible part

> **Stale in one respect:** the second step is still irreducible, and for the
> reason given here, but the file it lands in is `src/app-config.js`. See
> _Amendment: the application composes the Sections_ below.

Adding a Section is: author `src/sections/<name>/<name>-plugin.js`, then add one
import and one manifest entry in `src/sections/registry.js`. That second step
cannot be removed — ADR-0041 bans a build step, so nothing can discover modules
at runtime, and a module must be named somewhere to be loaded. It is the same
shape as `setup/register-routes.js` being the one place a page is named.

Two things remain per-Section and are not duplication: a Case Type opts a
Section in through its `sections` descriptor, which is an allow-list by design;
and `scripts/scaffold_case_type.py` carries the descriptor template that new
Case Types are scaffolded from, so a Section that should be standard belongs in
that template too.

### Types

> **Stale in one respect:** the compile-time / runtime split below stands
> exactly as described, but the union is no longer projected from a framework
> manifest. See _Amendment: the application composes the Sections_ below.

`Section` is the compile-time set of built-in ids, and is what a Case Type's
`sections` descriptor is keyed by — config is authored against the built-ins.
The runtime structures (`sectionIds()`, the resolved `access` map, the Summary
block list) are keyed by `string`, because a plugin registered at boot is in
them and cannot be in a union projected from the manifest. That split is
deliberate; collapsing it either way loses something real.

## Amendment: the application composes the Sections

This ADR made a Section declare itself and then had the framework name all of
them, in `src/sections/registry.js`. The consequence was structural rather than
stylistic: there was no way for the application to add a Section without editing
a framework file, which made "plugin" a word the architecture had not earned.
[ADR-0054](./0054-application-config-is-the-composition-root.md) settles it, and
this section records what that changed here.

### What changed

- **The list moved.** `APP_CONFIG.sectionPlugins` in `src/app-config.js` — the
  composition root — is the one place that says which Sections this application
  is made of. `src/sections/registry.js` is the **engine**: it imports no plugin
  and no config, and boot hands it the list with `configureSections()` before
  any route mounts.
- **A read before configuration throws.** With no built-ins there is nothing to
  fall back on, and an empty registry is not a visibly empty one: `case-loader`
  asks whether every Section is hidden, which is vacuously true over no
  Sections, so an unconfigured engine would deny access to every Case and render
  a blank application with nothing in the console.
- **`resetSectionRegistry()` is gone.** `configureSections` replaces wholesale,
  so composing again is already the whole of putting back what was composed. Its
  only remaining callers were tests, which the verify gate reports as dead code.
- **The cycle is gone by construction.** The knot that forced the manifest to be
  a function rather than a module-scope array — `services/section-access.js` →
  `registry.js` → plugins → page views → services — no longer has an edge out of
  the engine.
- **`Section` is projected from the composition root.** The compile-time /
  runtime split described under _Types_ above is unchanged and still deliberate;
  what changed is where the union comes from. `CaseTypeConfig.sections` stays
  `Partial<Record<Section, SectionConfig>>`, so a mistyped Section key is still
  a `tsc` error rather than a runtime one.

### There is no core-vs-plugin tier, and there never was one to build

The tiering this ADR implied — built-in Sections in a framework list, added ones
somewhere else — never materialised, and the composition root is why it does not
need to. A built-in Section is one the config happens to list; an application
Section is one it also lists. Omitting a built-in disables it. A separate
`enabledCoreSections` key would restate what `sectionPlugins` already says,
which is the duplication this ADR set out to remove in the first place.

### What is irreducible, and why

Adding a Section is: author `src/sections/<name>/<name>-plugin.js`, then add one
import and one entry to `src/app-config.js`. **That second step cannot be
removed.** [ADR-0041](./0041-deployed-bytes-are-source-bytes.md) bans a build
step, so nothing can discover modules at runtime, and a module must be named
somewhere to be loaded. It is the same file, and the same reason, that names a
page ([ADR-0042](./0042-static-page-imports.md) as amended by ADR-0054).

This is worth stating plainly because the config entry reads like leftover
coupling to anyone who has not hit the constraint, and the last two attempts to
remove that shape are what produced this ADR and ADR-0054 in turn.

### Checked rather than claimed

A Section the library never names was added end to end as the proof, and the
properties are asserted rather than argued:

- `src/sections/registry.js` is untouched by the diff that adds it, and a test
  holds the engine to importing no plugin module;
- its id is in the `Section` union — `sections: { secondReview: {} }` compiles
  and a typo is a `tsc` error, verified in both directions;
- `verify-config.js` rejects the same typo, so it is caught at build time too;
- a fractional `tabOrder` slots it between two Sections without renumbering
  either;
- access still gates it, and a Section hidden for everyone does not trip
  `case-loader`'s access-denied guard.

### What this ADR's own claims are worth now

- **"0 dead code" still holds.** `npm run verify` reports it on every run, with
  an exemption list that is empty and a staleness check on the entries there are
  none of.
- **The extensibility claim reads correctly as already amended.** Adding a
  Section is an edit to an application file, not a framework one, and the proof
  above is what that now rests on. It is still not free of framework edits when
  a Section needs behaviour the contract does not carry — the `adminDetails`
  case in the _Positive_ consequences remains the honest example, and that
  Section has since been removed.

## Correction: the id-to-renderer switch outlived this ADR by a month

**What this ADR claimed.** That the static id-to-renderer map was decommissioned
and its drift risk eliminated.

**What was true.** `SECTION_PANELS` went. A second switch of exactly the same
shape did not: `renderSectionBlock` in
`src/pages/cora-case-review/summary-view.js` was an if-chain over five hardcoded
Section ids returning `null` for anything else, and it decided which Sections
could contribute a block to the Summary. It survived a decommissioning that
named the thing it was doing because it was not called `SECTION_PANELS` — the
sweep matched a symbol, and this was a control-flow shape with no symbol to
match.

**What it cost.** A Section could declare `summaryBlock: true`, be composed into
the Summary by `summaryBlockIds()` and `summarySectionsFor()`, and then draw
nothing. Not an error — a blank. Every derived structure agreed the Section had
a block; the one thing that rendered it disagreed silently.

**When it actually went.** Sep 2026, over four tickets: `summaryView` was added
to the plugin contract with the delegation in front of the chain, the five
renderers moved onto their plugins two and then three at a time, and the chain
was deleted. `summary-view.js` now names no Section, and a test holds it to
that — the sweep this ADR described had no such ratchet, which is the other half
of why the switch survived it.

**What is still true of the wider claim.** A Section id still appears in a few
places outside its own plugin, and none of them is a renderer switch: the
Appeals feature switch in `src/services/section-access.js` (deliberate, and
documented in `docs/guide/feature-switches.md`), `READ_THROUGH_SUMMARY` in the
same file, and the Conversation overlay's special-casing in
`src/pages/cora-case-review.js`. Each is a real coupling worth its own ticket;
recording them here is the point, since the last time this was described as
finished it was not.
