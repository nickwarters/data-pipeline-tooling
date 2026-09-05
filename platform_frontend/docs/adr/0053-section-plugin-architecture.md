# 53. Section Plugin Architecture

Date: 2026-09-05

## Status

Accepted

Supersedes the monolithic access matrix in [ADR-0011](./0011-section-level-role-based-access.md)
and the static panel map in [ADR-0032](./0032-data-driven-section-registry.md).
Builds upon the store-driven view model in [ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md).

## Context

Historically, Case Review sections were managed across three disparate, statically coupled structures:

1. **Layout & Ordering:** `src/lib/section-registry.js` declared a static `SECTION_REGISTRY` array defining tab ordering, summary block configuration, and IDs.
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
- **`SECTION_PANELS` Decommissioned:** The static `SECTION_PANELS` map in `src/pages/cora-case-review/section-panels.js` is deleted. View rendering logic is inlined into each standalone section plugin. `section-panels.js` remains exclusively for shared JSDoc typedefs (`PanelContext`, `PanelActions`).
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
- **Clean Architecture:** Eliminates legacy `MATRIX` and `SECTION_PANELS` drift risks and achieves 0 dead code across the frontend.

### Negative / Trade-offs

- Tests verifying section access must now either call `evaluateAccess` or `getSectionPlugin(id).evaluateAccess(...)` instead of inspecting matrix cell functions directly.
- Layout metadata is stated twice: `SECTION_REGISTRY` in `src/lib/section-registry.js` still declares `tab`, `tabOrder`, `summaryBlock`, `summaryOrder` and `showInSummaryDefault`, and each plugin restates the same five. The registry remains the authority for the `Section` id union, `SECTIONS` and `SUMMARY_SECTIONS`; the plugin's `tab`/`tabOrder` are what the render loop sorts by. Tests hold the two in step rather than one deriving from the other, so a Section added to only one of them fails loudly but the duplication is real. Consolidating on one of the two is deferred, not decided.
- A plugin whose id is absent from `SECTION_REGISTRY` — `adminDetails` today — is outside the `Section` union, which is why a Case Type's `sections` map and the render snapshot's `access` are typed `Record<string, …>` rather than keyed by that union. The compile-time check on a mistyped `sections` key is recovered at runtime by `verify-config.js` and a registry contract test.
