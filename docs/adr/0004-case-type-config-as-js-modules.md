# Case Type configuration as JS modules (not JSON)

## Status

Accepted, as amended 2026-07 (#493) — see **Amendment (2026-07, #493)** below,
which bounds the blast radius of a Case Type module that fails to evaluate.
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md)
clarifies that data-only descriptors express variation while branching
behaviour remains in JavaScript.

Each **Case Type** is a JS module under `/Style Library/case-review/case-types/{slug}.js`, exporting a `default` POJO that conforms to a `CaseTypeConfig` JSDoc typedef. Loaded lazily via dynamic `import()` when a Case of that type is opened.

Chosen over JSON files because JS modules: (a) carry **JSDoc types** for IDE intellisense and CI type-checking, (b) can `import` shared helpers and constants (e.g., common field validators), (c) let the **outcome algorithm be an exported function** rather than something encoded in a data DSL, (d) cache identically to JSON in the browser. No build step is added — modern browsers load ES modules natively, consistent with ADR-0001.

**Question Bank content is a per-Case-Type text artifact in SharePoint**, not rows in a shared Question Definitions list. Each `case-types/{slug}.js` module loads `case-types/banks/{slug}.txt` as JSON text and exposes its questions, labels, and Outcome vocabulary through the `CaseTypeConfig` contract. The `.txt` extension avoids SharePoint SE's unreliable `.json` handling; it does not change the JSON content model. The Question Bank editor reads and compiles that same artifact (see ADR-0021).

**Deletes of Question Definitions are forbidden** to preserve stable references and version history — use a `deprecated` flag instead.

**Outcome vocabulary (`outcomeOptions`) and `defaultOutcomeId` are required.** `computeOutcome` returns an outcome **id**; the wording shown to Reviewers is resolved from the Case Type's `outcomeOptions` (id → wording), and each option's `severity` (also required) is the sort key that orders outcomes (higher = worse). There is deliberately **no built-in Pass/Refer/Fail fallback and no inferred severity**: a Case Type must declare every outcome its `computeOutcome` can return, nominate a configured default outcome, and give every option an explicit severity, so ordering is driven wholly by config. The `CaseTypeConfig` typedef and load-time validation reject missing, malformed, duplicate, or unrecognised configured outcomes before a Case is reviewed. A hand-written `computeOutcome` that returns an unknown id still renders a visible "Outcome not configured" state rather than being silently papered over.

## Amendment (2026-07, #493) — a Case Type module that throws costs only its Case Type

Configuration-as-code buys types, shared imports and a real `computeOutcome`
function; the price is that a Case Type module can _throw_ where a JSON file
could only be malformed. Boot paid that price app-wide: `loadCaseTypeSources()`
`Promise.all`-ed every registered slug with no per-slug catch, and eligibility
was applied only after loading, so one maintainer's typo — a syntax error, an
invalid outcome config, an unknown shared General Question key — took the whole
application down for **every** user, including users with no access to that Case
Type. With one live Case Type that was theoretical; at ten it is a routine
outage.

Case Type modules are therefore contained the way page modules already are under
[ADR-0002](./0002-spa-shell-with-hash-routing.md): the load is caught **per
slug**. A Case Type that fails to evaluate is logged with its slug and its
error, and **dropped**. Dropping is the whole safety property — a failed Case
Type produces no `CaseTypeSource` at all, so it cannot reach the app-wide
eligibility rule, and cannot appear in `caseSources`, `journeyCaseSources` or an
allocation source in any partial form. Containment can only ever narrow access,
never widen it, and the eligibility rule itself is unchanged.

The boundary is **"cannot produce a usable source"**, not "threw during
import" — the weaker reading left a real hole. A module that evaluated cleanly
but returned a partial config yielded a source whose `listName` was `undefined`;
it was counted as available, so it was never named in the banner, and it
resurfaced later as an opaque route error. Validation therefore runs inside the
per-slug catch, and the load goes through `loadCaseTypeConfig`, so a missing
`listName` and an invalid outcome configuration are contained and named on the
same path as a syntax error.

Containment covers **both environments**. `?mock=1` partitions the fixture Cases
by each Case Type's declared list inside `createSharePointClient`, which boot
awaits _before_ it resolves Case sources; uncontained, that made a broken Case
Type an app-wide outage in the dev loop, ~30 lines ahead of the containment
meant to prevent it. That partition is now caught per Case Type too: the broken
type's fixture Cases are dropped and reported, the rest still load. Dropping
them widens nothing — a read without a `listName` still throws and there is
still no default store ([issue #249](./0022-two-axis-role-model.md)).

Silence would be the wrong containment here, because removing a Case Type
removes _Cases_: a Reviewer whose list is suddenly empty cannot tell a broken
deploy from "nothing assigned to me". Boot therefore states the removal once,
app-wide, in a non-blocking warning banner naming the affected Case Types — the
existing banner styling, mounted beside the UAT badge, obscuring and gating
nothing. The raw error stays on the console for whoever fixes it. There is no
second, dashboard-specific rendering of the same condition:
[ADR-0036](./0036-dashboard-composition-is-dashboard-owned.md) keeps dashboard
composition dashboard-owned, and one app-wide surface is already visible from
every route.

This bounds failures that reach the browser; it does not excuse them.
Deploy-time validation (#459) remains the complementary defence that stops most
of them arriving, and the manifest sweep in `tests/case-type-manifest.test.js`
catches committed breakage in CI.
