# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Before doing any non-trivial work in this repo, read:

1. **[CONTEXT.md](./CONTEXT.md)** — domain language. Use these terms exactly when discussing or coding (`Case Type`, `Question Definition`, `Applicable Question`, `Answer`, `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`, `Conversation`, `Outcome`).
2. **[docs/PLAN.md](./docs/PLAN.md)** — the slice-based execution roadmap. Slice 1 ("Example Case") is long done; the framework is deep into later slices. Current work is **Slice 11 — User groups & remediation workflow** (two-axis roles, case lifecycle, remediation loop, Amend Outcome, Appeals — see [`docs/user-groups-workflow-grilling-session-plan.md`](./docs/user-groups-workflow-grilling-session-plan.md)). Read the slice list to see what's shipped vs. sketched before assuming a feature doesn't exist yet.
3. **[docs/adr/](./docs/adr/)** — 34 architecture decisions, numbered (`0001`–`0034`). Every non-trivial decision in the codebase traces back to one of these. Don't deviate from an ADR without surfacing the deviation explicitly.

## Project overview

Vanilla JavaScript, HTML, and CSS framework for a Case Review Platform frontend hosted on **SharePoint Subscription Edition**. **Edge Chromium only** as the browser baseline; no IE11. There is no runtime build toolchain — no bundlers, no transpilers, no third-party runtime dependencies. Modern browsers load the source `.js` natively.

## Architecture in one screen

- **SPA shell, hash routing, page independence**. One `.aspx` host page, one Content Editor, one `app.js`. Every route lazy-loads its page inside its own `mount()` via dynamic `import()` (`src/routes/*.js`) — the boot graph does not statically depend on any page. If a page module fails to load (broken, missing), the router (`lib/router.js`) catches it inside an async `navigate()`, logs it, and renders a plain-DOM `cora-route-error` panel into the route container; the nav lives outside that container and stays usable, so one broken page cannot break another or the boot. A navigation sequence token discards a stale mount that resolves after the user has already navigated on. Registration is likewise isolated: `setup/register-routes.js` wraps each route's registration in `safeRegister`, so a route module that throws at registration costs only its own route. **Removal recipe — deleting a page is:** delete the page file (`src/pages/<page>.js`) + its route file (`src/routes/<route>.js`) + its `safeRegister(...)` line in `setup/register-routes.js` + its nav link. Nothing else breaks. `tests/component-layering-contract.test.js` enforces the layering: no static page import outside `src/pages/`, dynamic page `import()` only in `src/routes/*`, and route modules imported only by `setup/register-routes.js`.
- **Web Components in light DOM + home-grown signal primitive**. Custom elements (`<cora-*>`) are the unit of UI; `signal()`/`computed()`/`effect()` (~50 LOC) drive fine-grained reactivity. Light DOM (not Shadow DOM) for form ergonomics; `cora-` CSS prefix for SharePoint isolation. Components register themselves via a top-level `customElements.define(...)` call as a module side effect — there is no central registry module. A component only becomes available once something side-effect-imports it (typically the page/section that mounts it). `tests/framework-contract.test.js` asserts a global registry (`registerComponents`/`register-components`) never comes back — don't reintroduce one. For the anatomy of a single component (pure view function → `defineView`/`ShellElement` shell, registration, lifecycle, events, and a new-component checklist) see [`docs/component-anatomy-explainer.html`](./docs/component-anatomy-explainer.html).
- **ADR-0034 strangler migration in progress (Project Palimpsest, #402).** Routes are converting one at a time from the signal/`ShellElement` component model above to a single-store + pure-view + `morph()` architecture, entered through the router seam via `createStoreRoute()` (`core/store-route.js`). Old-style and new-style routes coexist behind that seam by design — do not "correct" a new store-driven page back to signals/`ShellElement`. New pages follow the slice module pattern in [`docs/guide/store-actions-and-effects.md`](./docs/guide/store-actions-and-effects.md).
- **New feature code follows the Palimpsest playbook.** From PILOT-2 onward, use [`docs/palimpsest-playbook.md`](./docs/palimpsest-playbook.md) for the state shape, action naming, test pattern, and conversion PR checklist; do not add new feature code in the old component-owned-state style.
- **Case Type config as JS modules; Question Bank content as SharePoint-hosted text artifacts.** One module per Case Type under `case-types/{slug}.js`, lazy-loaded via `case-types/manifest.js`. Question Bank content (Question Definitions, labels, and Outcome vocabulary) lives in `case-types/banks/{slug}.txt`, stored in the SharePoint Style Library and loaded through `case-types/load-bank.js` as part of the Case Type config. There is no shared Question Definitions list and no planned runtime join to one. `HttpSharePointClient`/`MockSharePointClient` expose `getExportHash`/`getVersionedExport` for ADR-0021's immutable, point-in-time exports on reportable Cases.
- **JSDoc + `tsc --checkJs` for types**. No `.ts` files; the deployed JS is the source JS. CI runs `tsc --noEmit --checkJs --allowJs`.
- **Per-Case-Type `showWhen` graph + `outcome` function**. Applicability is data (declarative `showWhen`); outcome is code (exported function). Same module, one place to look.
- **Case storage: everything on the Case row**. `Answers` and `Conversation` as JSON blobs on a per-Case-Type SharePoint list row. Notes as plain text. Field-level PATCH only.
- **Auto-save: 1500ms debounce + ETag concurrency**. Single `SaveQueue` primitive; components never call `fetch` directly.
- **Mock-first dev loop**. All REST goes through a `SharePointClient` interface. `?mock=1` URL param swaps in `MockSharePointClient` from `dev/fixtures/`. `node --test` for unit tests.
- **Auth: browser NTLM/Kerberos; security via SharePoint list permissions**. Client-side group checks are UX-only; the real boundary is SharePoint's list ACLs.
- **Two live environments: prod and UAT (ADR-0033)**. Same source tree, deployed twice: prod at `Style Library/CODE/CORA` + `SitePages/app.aspx` + unprefixed lists; UAT at `CODE/CORA-UAT` + `SitePages/uat.app.aspx` + `uat_`-prefixed lists (`deploy_to_sharepoint.py --env uat`). The deployed host page declares its environment via the `{{CORA_ENV}}` token → `window.CORA_ENV`; `src/config/environment.js` is the only place that resolves it, and `HttpSharePointClient` applies the list prefix centrally. Never branch on the environment name elsewhere.

## Hard rules

- **No third-party runtime dependencies, ever.** Dev/CI tools (tsc, prettier, node test runner) are fine.
- **No build step at runtime.** Source JS is deployed JS.
- **Components never call `fetch()` directly** — always through the `SharePointClient` interface. This is what makes mock-first dev work.
- **No `innerHTML` for user data.** XSS prevention; also preserves input state.
- **Custom elements use the `cora-` prefix** (also the CSS namespace).
- **Question Definitions are never deleted** — use a `deprecated` flag (avoids dangling references from Case Type modules).

## Gotchas

- **Question Bank artifacts are JSON stored in `.txt` files, on purpose.** `case-types/banks/*.txt` (loaded via `case-types/load-bank.js`) hold plain JSON text. This is intentional, not an oversight: SharePoint Subscription Edition has been unreliable at storing/serving `.json` files (MIME/blocking issues), so the artifact extension is `.txt` while the content stays JSON, parsed explicitly by the loader. A repo-wide search for `*.json` will not find the banks — search `case-types/banks/*.txt` instead.

## Test discipline: Red-Green-Refactor, risk-based coverage

**Every behaviour change must be covered at the smallest useful public seam.**

Workflow for all new code:

1. **Red** — write a failing test for the behaviour you are about to add.
2. **Green** — write the minimum production code to make it pass.
3. **Refactor** — clean up, keeping tests green.

Never merge a production behaviour change without a corresponding test. Run
`npm run test:coverage` before committing. The command explicitly includes all
JavaScript under `src/` and `case-types/` and enforces a consistent global floor
of 95% for line, branch, and function coverage.

The global floor is a backstop, not a quota. Keep security, SharePoint protocol,
concurrency, permissions, and outcome/applicability code at 100% line and branch
coverage wherever practical. Test exact external contracts there. Elsewhere,
prefer public behaviour over child positions, private listener registries, or
private methods; do not add white-box assertions solely to cover a syntactic
line.

## Directory layout

```
src/
  app.js                        # entry point
  sharepoint-client.js          # shared typedefs (SharePointClient interface)

  lib/                          # framework-level primitives (no domain knowledge)
    add-working-days.js
    capture-engine.js
    case-machine.js
    case-review-view-model.js
    case-route-links.js
    html.js                     # h() / reactive() / defineView() plain-function view primitives
    question-order.js           # generic question/category ordering helpers (was question-bank/)
    route-error-panel.js        # shared route-failure panel, used by router.js and core/store-route.js (#437)
    router.js                   # hash-based SPA router
    showwhen-tree.js            # generic showWhen tree parse/serialise/mutate (was question-bank/)
    signal.js                   # home-grown signal/computed/effect (~50 LOC)
    toast.js                    # transient toast primitive (toastMsg signal + showToast)
    view.js

  core/                         # store-driven view runtime (ADR-0034 / Project Palimpsest)
                                #   see docs/guide/store-actions-and-effects.md for the contract
    chrome-state.js             # shared toasts/nav/current-user/permissions store slice
    morph.js                    # keyed DOM-morphing reconciler: patches live DOM to an h() tree
                                #   in place (focus/caret/scroll survive) — CORE-2 (#404)
    store.js                    # single route-local store: dispatch/reducer, coalesced render — CORE-3 (#405)
    memo.js                     # per-view memo cache, keyed by position, cleared on unmount — CORE-4 (#406)
    store-route.js               # adapts a store-driven route module to the Router handler shape — CORE-6 (#407)

  actions/                      # effects: async work reached only via dispatch (CORE-3 / Project Palimpsest)
    case-actions.js             # persistence effect example: SharePointClient + SaveQueue re-entering via dispatch

  components/                   # reusable cora-* custom elements, layered by dependency
    base/                       # leaf primitives — compose no other component (cf. lib/signal.js)
      cora-data-table.js
      cora-options-editor.js
      cora-people-picker.js
      cora-question-labels.js
      cora-group-progress.js      # per-Question-Group progress strip (was cora-section-progress, #390)
      cora-showwhen-leaf.js
      cora-status-banner.js
      cora-tabs.js
      cora-toast.js
    sections/                   # domain-feature units: take config, wire base components together
      cora-allocation.js
      cora-amend-outcome.js
      cora-app-nav.js
      cora-appeal.js
      cora-attribute-menu.js
      cora-capture-groups.js
      cora-case-details.js
      cora-command-palette.js
      cora-conversation.js
      cora-kpi-strip.js
      cora-notes.js
      cora-outcome.js
      cora-owner-summary.js
      cora-question.js
      cora-question-card.js
      cora-remediation-section.js
      cora-remediation-tracking.js
      cora-showwhen-editor.js
      cora-showwhen-group.js
      cora-summary.js
      cora-wording-editor.js
    collections/                # page/tab-level assemblies mounted directly by pages
      cora-action-centre.js       # dashboard panel (moved from pages/, #384)
      cora-appeal-review.js
      cora-case-table.js
      cora-case-tabs.js
      cora-compile-drawer.js
      cora-controls-dashboard.js   # dashboard panel (moved from pages/, #384)
      cora-question-list.js

  config/
    working-days.js

  pages/                        # top-level view components, mostly one per route
    dev-morph-harness.js        # dev-only morph() demo (store-less scratch view, #404)
    dev-performance-harness.js  # dev-only CORE-5 500-question keystroke-latency gate (mock-only)
                                #   see docs/palimpsest-performance-gate.md for the measured result
    cora-case-review.js
    cora-case-review/          # page shell + per-tab controllers (13 files, ~900 lines)
      tab-controller.js
      node-registry.js
      completion-controller.js
      amend-outcome-controller.js
      appeal-review-controller.js
      controllers.js
      conversation-controller.js
      header-controller.js
      question-panel-controller.js
      remediation-controller.js
      remediation-tracking-controller.js
      summary-notes-appeal-controller.js
      types.js
    cora-conversation-view.js
    cora-dashboard.js
    home.js                      # store-driven Home pure view (Palimpsest PILOT-2)
    cora-journey-cases.js
    reports-index.js             # store-driven pure view (Palimpsest PILOT-1)
    cora-responsible-party-dashboard.js
    cora-reviewer-team-report.js
    cora-team-cases.js
    question-bank/              # question bank editor subsystem ("just another page", #382)
      cora-bank-dock.js
      cora-bank-editor.js       # page shell; owns the ONLY store imports + child wiring
      cora-bank-list.js
      cora-bank-rail.js
      cora-outcome-options-editor.js
      cora-question-bank-editor.css
      cora-remediation-actions-editor.js # edits a Question Definition's Remediation Actions (moved from components/sections, #381)
      question-bank-compile.js
      question-bank-source.js
      question-bank-store.js    # bank-editor state singleton (re-exports lib/toast.js)
      simulate-panel.js         # impact-simulation panel fed to cora-compile-drawer via props

  routes/                       # route handler modules, one per hash route
    case.js
    conversation.js
    dashboard.js
    dev-morph.js                # dev-only #/dev/morph, self-gated on ?mock=1 (#404)
    dev-performance.js          # dev-only #/dev/performance, self-gated on ?mock=1 (CORE-5, #408)
    journey-cases.js
    my-cases.js
    question-bank.js
    reports.js
    root.js
    team-cases.js

  services/                     # non-UI modules: data, state, auth
    account-name.js
    action-centre-flags.js
    action-centre-model.js
    command-palette-store.js
    create-sharepoint-client.js
    http-sharepoint-client.js
    journey-cases-fetcher.js
    mock-sharepoint-client.js
    permissions.js
    reviewer-team-fetcher.js
    save-queue.js
    section-access.js
    team-cases-fetcher.js
    team-cases-params.js

  evaluators/                   # pure logic: applicability, failure, and outcome
    amended-outcome.js
    applicability-evaluator.js
    configured-outcome.js
    failure-evaluator.js
    issue-capture.js
    kpi-strip-model.js
    overdue-evaluator.js
    remediation-actions.js
    remediation-details.js
    reviewer-team-aggregator.js
    question-group-progress.js   # per-Question-Group answered/total (was section-progress.js, #390)
    summary-model.js
    time-windows.js

  setup/                        # app startup helpers
    app-chrome.js                 # guarded nav + command-palette mount (fatal nav / skipped palette)
    register-routes.js
    resolve-eligible-case-types.js
                                 # NOTE: no register-components.js — components register via
                                 # top-level customElements.define() side effects (see Hard rules)

  styles/
    cora-design-tokens.css
    cora-styles.css

  testing/
    in-memory-flow-runner.js

case-types/                     # one module per Case Type, lazy-loaded via manifest.js
  manifest.js                   # CASE_TYPE_IMPORTERS / QUESTION_BANK_IMPORTERS registries
  load-bank.js                  # loads a bank .txt artifact as parsed JSON (see Gotchas)
  complaints.js                 # the only live Case Type (#383)
  banks/                        # Question Bank content, JSON text stored as .txt (see Gotchas)
    complaints.txt

scripts/
  scaffold_case_type.py         # scaffolds a new Case Type module + bank artifact (ADR-0028)
  deploy_to_sharepoint.py
  run_in_memory_flow.js

dev/
  fixtures/                     # mock data used by MockSharePointClient (?mock=1)

tests/                          # node:test unit tests — flat, one file per subject by filename
                                # (e.g. cora-toast.test.js imports components/base/cora-toast.js)
```
