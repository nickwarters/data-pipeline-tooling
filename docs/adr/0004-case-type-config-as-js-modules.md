# Case Type configuration as JS modules (not JSON)

Each **Case Type** is a JS module under `/Style Library/case-review/case-types/{slug}.js`, exporting a `default` POJO that conforms to a `CaseTypeConfig` JSDoc typedef. Loaded lazily via dynamic `import()` when a Case of that type is opened.

Chosen over JSON files because JS modules: (a) carry **JSDoc types** for IDE intellisense and CI type-checking, (b) can `import` shared helpers and constants (e.g., common field validators), (c) let the **outcome algorithm be an exported function** rather than something encoded in a data DSL, (d) cache identically to JSON in the browser. No build step is added — modern browsers load ES modules natively, consistent with the architecture decision.

**Question Definitions remain in a SharePoint list** (decided in the prior grilling session): they're shared across Case Types, edits propagate live to in-progress cases, and a SharePoint list is the right tool for shared content. Each Case Type module references Question Definitions by stable ID; the framework joins them at load time.

**Deletes of Question Definitions are forbidden** to avoid dangling references — use a `deprecated` flag instead.

**Outcome vocabulary (`outcomeOptions`) and `defaultOutcomeId` are required.** `computeOutcome` returns an outcome **id**; the wording shown to Reviewers is resolved from the Case Type's `outcomeOptions` (id → wording), and each option's `severity` (also required) is the sort key that orders outcomes (higher = worse). There is deliberately **no built-in Pass/Refer/Fail fallback and no inferred severity**: a Case Type must declare every outcome its `computeOutcome` can return, nominate a configured default outcome, and give every option an explicit severity, so ordering is driven wholly by config. The `CaseTypeConfig` typedef and load-time validation reject missing, malformed, duplicate, or unrecognised configured outcomes before a Case is reviewed. A hand-written `computeOutcome` that returns an unknown id still renders a visible "Outcome not configured" state rather than being silently papered over.
