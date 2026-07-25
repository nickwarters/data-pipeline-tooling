# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Before doing any non-trivial work in this repo, read:

1. **[CONTEXT.md](./CONTEXT.md)** — domain language. Use these terms exactly when discussing or coding (`Case Type`, `Question Definition`, `Applicable Question`, `Answer`, `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`, `Conversation`, `Outcome`).
2. **[docs/guide/add-a-page.md](./docs/guide/add-a-page.md)** — the one-page
   authoring path: state → `h()`, actions, effects, lazy route, and tests.
3. **[docs/adr/](./docs/adr/)** — 37 architecture decisions, numbered
   (`0001`–`0037`). Read the status before relying on an older decision, and do
   not deviate from an accepted ADR without surfacing the deviation explicitly.

## Project overview

Vanilla JavaScript, HTML, and CSS framework for a Case Review Platform frontend hosted on **SharePoint Subscription Edition**. **Edge Chromium only** as the browser baseline; no IE11. There is no runtime build toolchain — no bundlers, no transpilers, no third-party runtime dependencies. Modern browsers load the source `.js` natively.

## Architecture in one screen

- **SPA shell, hash routing, page independence**. One `.aspx` host page, one Content Editor, one `app.js`. Every route lazy-loads its page inside its own `mount()` via dynamic `import()` (`src/routes/*.js`) — the boot graph does not statically depend on any page. If a page module fails to load (broken, missing), the router (`lib/router.js`) catches it inside an async `navigate()`, logs it, and renders a plain-DOM `cora-route-error` panel into the route container; the nav lives outside that container and stays usable, so one broken page cannot break another or the boot. A navigation sequence token discards a stale mount that resolves after the user has already navigated on. Registration is likewise isolated: `setup/register-routes.js` wraps each route's registration in `safeRegister`, so a route module that throws at registration costs only its own route. **Removal recipe — deleting a page is:** delete the page file (`src/pages/<page>.js`) + its route file (`src/routes/<route>.js`) + its `safeRegister(...)` line in `setup/register-routes.js` + its nav link. Nothing else breaks. `tests/component-layering-contract.test.js` enforces the layering: no static page import outside `src/pages/`, dynamic page `import()` only in `src/routes/*`, and route modules imported only by `setup/register-routes.js`.
- **Store-driven pure views in light DOM.** Each application route owns state
  shaped as `{ chrome, routes }`. Pages export `createRouteSlice()` with initial
  state, a reducer, and a pure `state → h()` view. Event callbacks dispatch
  `domain/event` actions; async work and persistence live in effects. The
  `createStoreRoute()` adapter creates the store and memo cache, renders through
  keyed `morph()`, contains route failures, and cleans up on navigation.
- **One authoring model.** Views are synchronous and side-effect free. They do
  not import clients or persistence services, and application pages do not use
  the internal notification primitive retained by `SaveQueue` and
  `CaseReviewViewModel`. Start with
  [`docs/guide/add-a-page.md`](./docs/guide/add-a-page.md); use
  [`docs/guide/store-actions-and-effects.md`](./docs/guide/store-actions-and-effects.md)
  and [`docs/guide/router.md`](./docs/guide/router.md) as reference.
- **Light DOM and CSS isolation.** `h()` creates safe DOM nodes, keyed `morph()`
  preserves focus/caret/scroll across renders, and the `cora-` CSS prefix remains
  the SharePoint-isolation boundary. See the current
  [state/action/render explainer](./docs/component-anatomy-explainer.html).
- **Case Type config as JS modules; Question Bank content as SharePoint-hosted text artifacts.** One module per Case Type under `case-types/{slug}.js`, lazy-loaded via `case-types/manifest.js`. Question Bank content (Question Definitions, labels, and Outcome vocabulary) lives in `case-types/banks/{slug}.txt`, stored in the SharePoint Style Library and loaded through `case-types/load-bank.js` as part of the Case Type config. There is no shared Question Definitions list and no planned runtime join to one. `HttpSharePointClient`/`MockSharePointClient` expose `getExportHash`/`getVersionedExport` for ADR-0021's immutable, point-in-time exports on reportable Cases.
- **JSDoc + `tsc --checkJs` for types**. No `.ts` files; the deployed JS is the source JS. CI runs `tsc --noEmit --checkJs --allowJs`.
- **Per-Case-Type `showWhen` graph + `outcome` function**. Applicability is data (declarative `showWhen`); outcome is code (exported function). Same module, one place to look.
- **Case storage: everything on the Case row**. `Answers` and `Conversation` as JSON blobs on a per-Case-Type SharePoint list row. Notes as plain text. Field-level PATCH only.
- **Auto-save: 1500ms debounce + ETag concurrency**. A single `SaveQueue`
  primitive owns writes; views never call `fetch` directly.
- **Mock-first dev loop**. All REST goes through a `SharePointClient` interface. `?mock=1` URL param swaps in `MockSharePointClient` from `dev/fixtures/`. `node --test` for unit tests.
- **Auth: browser NTLM/Kerberos; security via SharePoint list permissions**. Client-side group checks are UX-only; the real boundary is SharePoint's list ACLs.
- **Two live environments: prod and UAT (ADR-0033)**. Same source tree, deployed twice: prod at `Style Library/CODE/CORA` + `SitePages/app.aspx` + unprefixed lists; UAT at `CODE/CORA-UAT` + `SitePages/uat.app.aspx` + `uat_`-prefixed lists (`deploy_to_sharepoint.py --env uat`). The deployed host page declares its environment via the `{{CORA_ENV}}` token → `window.CORA_ENV`; `src/config/environment.js` is the only place that resolves it, and `HttpSharePointClient` applies the list prefix centrally. Never branch on the environment name elsewhere.

## Hard rules

- **No third-party runtime dependencies, ever.** Dev/CI tools (tsc, prettier, node test runner) are fine.
- **No build step at runtime.** Source JS is deployed JS.
- **Views never call `fetch()` directly** — effects use the `SharePointClient`
  interface. This is what makes the mock-first development loop work.
- **No `innerHTML` for user data.** XSS prevention; also preserves input state.
- **Custom elements use the `cora-` prefix** (also the CSS namespace).
- **Question Definitions are never deleted** — use a `deprecated` flag (avoids dangling references from Case Type modules).
- **Case Type descriptors express genuine Case Type variation; branching behaviour stays in code** (ADR-0035). Descriptors may select stable keys, labels, property paths, ordering, membership, and simple flags. Permission/lifecycle decisions, navigation, conditional formatting, event handling, and effects belong in code. Dashboard composition is dashboard-owned and must not be declared by Case Type configuration (ADR-0036); the dashboard consumes resolved `caseSources` only for Case data access.

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
    html.js                     # h() plain-function view primitive
    question-order.js           # generic question/category ordering helpers (was question-bank/)
    route-error-panel.js        # shared route-failure panel, used by router.js and core/store-route.js (#437)
    router.js                   # hash-based SPA router
    showwhen-tree.js            # generic showWhen tree parse/serialise/mutate (was question-bank/)
    signal.js                   # internal state/service notification primitive
    toast.js                    # transient toast store + showToast action

  core/                         # store-driven view runtime (ADR-0034)
                                #   see docs/guide/store-actions-and-effects.md for the contract
    chrome-state.js             # shared toasts/nav/current-user/permissions store slice
    morph.js                    # keyed DOM-morphing reconciler: patches live DOM to an h() tree
                                #   in place (focus/caret/scroll survive) — CORE-2 (#404)
    store.js                    # single route-local store: dispatch/reducer, coalesced render — CORE-3 (#405)
    memo.js                     # per-view memo cache, keyed by position, cleared on unmount — CORE-4 (#406)
    store-route.js               # adapts a store-driven route module to the Router handler shape — CORE-6 (#407)

  actions/                      # effects: async work reached only via dispatch
    case-actions.js             # persistence effect example: SharePointClient + SaveQueue re-entering via dispatch

  components/                   # reusable pure views, layered by dependency
    base/                       # leaf primitives — compose no other view
      cora-people-picker.js        # pure People Picker renderer and search helpers
      cora-group-progress.js      # pure per-Question-Group progress strip
      cora-status-banner.js
      cora-tabs.js
      cora-toast.js
    sections/                   # domain-feature units: take config, wire base components together
      cora-allocation.js          # pure allocation view and candidate loader
      cora-app-nav.js
      cora-attribute-menu.js
      cora-capture-groups.js      # pure Issue Capture Group renderer
      cora-command-palette.js
      cora-owner-summary.js       # pure ownership-summary view and loader
    collections/                # page/tab-level assemblies mounted directly by pages
      cora-case-tabs.js           # pure Question Bank Case Type tab bar

  config/
    working-days.js

  pages/                        # route slices, top-level views, and focused page actions
    cora-case-review.js        # store slice + pure tab shell
    cora-case-review/          # store actions/effects and pure Section views
      details-view.js          # config-driven, read-only Case Details pure view (mirrors current Section behaviour)
      case-actions.js          # Answer dispatch -> unchanged SaveQueue; save status dispatch bridge
      question-panel-view.js   # CASE-2 group-scoped Questions view with memoised cards
      general-questions-view.js # pure, non-outcome-driving General Questions section (#472)
      conversation-view.js     # CASE-3 pure conversation panel + unchanged JSON-blob PATCH effect
      notes-view.js            # CASE-3 pure Notes and Case Justification view; SaveQueue remains the writer
      summary-view.js          # CASE-4 pure configured Summary view
      outcome-view.js          # CASE-4 configured Outcome view
      completion-actions.js    # CASE-4 CaseMachine-guarded completion actions
      remediation-actions.js   # CASE-5 route action for configurable Remediation Detail edits
      remediation-view.js      # CASE-5 pure Issues and Remediation Actions view
      remediation-tracking-view.js # pure question-level Remediation tab, reviewer + responsible-party renderings (#499)
      appeal-actions.js        # CASE-6 immutable Appeal/resolution/amendment state transitions
      appeal-view.js           # CASE-6 pure Appeal request form and history view
      appeal-review-view.js    # CASE-6 pure Controls resolution form and history view
      amend-outcome-view.js    # CASE-6 pure ADR-0026 Amend Outcome form and record view
    cora-conversation-view.js
    cora-dashboard.js             # store-driven dashboard slice + descriptor-selected panels (GRID-3/4)
    dashboard/
      action-centre-view.js       # pure reason-descriptor view + bounded load actions (ADR-0030 flags unchanged)
      controls-view.js            # pure generic-table Appeals panel + paged load action
      kpi-view.js                 # pure renderer for kpi-strip-model output
      panel-descriptors.js        # code-owned panel registry and role visibility
    home.js                      # store-driven Home route slice and pure view
    cora-journey-cases.js         # store-driven Journey Cases slice + generic descriptors (GRID-2)
    cora-responsible-party-dashboard.js # store-driven Responsible Party slice shared by dashboard and #/my-cases
    responsible-party/
      view.js                     # pure outcome/remediation/unread views using generic tables
    cora-team-cases.js          # store-driven Team Cases + Case Type table descriptors (GRID-1/5)
    question-bank/              # question bank editor subsystem ("just another page", #382)
      bank-slice.js             # route-local bank editor state, derived selectors, and actions (BANK-1)
      cora-bank-dock.js
      cora-bank-editor.js       # store-driven route slice + pure editor view
      cora-bank-list.js         # memoises Question Definition cards for 500-question banks (BANK-2)
      cora-bank-rail.js
      cora-outcome-options-editor.js
      cora-question-bank-editor.css
      compile-drawer.js         # pure compile/simulation/publish drawer view (BANK-3)
      cora-remediation-actions-editor.js # edits a Question Definition's Remediation Actions (moved from components/sections, #381)
      options-editor.js          # pure Question Definition response-option editor (BANK-2)
      question-card.js           # pure memoised Question Definition editing card (BANK-2)
      question-labels.js         # pure reporting-label editor (BANK-2)
      showwhen-editor.js         # pure showWhen editor shell (BANK-2)
      showwhen-group.js          # pure recursive showWhen group view (BANK-2)
      showwhen-leaf.js           # pure showWhen condition view (BANK-2)
      wording-editor.js          # pure Question Definition wording editor (BANK-2)
      question-bank-compile.js
      question-bank-source.js
      simulate-panel.js         # pure golden-tested impact-simulation view

  views/                        # generic store-driven pure renderers
    data-table.js               # descriptor-driven table view (value, sort, format, links)

  routes/                       # route handler modules, one per hash route
    case.js
    conversation.js
    dashboard.js
    journey-cases.js
    my-cases.js
    question-bank.js
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
    save-queue.js
    section-access.js
    team-cases-fetcher.js
    team-cases-params.js

  evaluators/                   # pure logic: applicability, failure, and outcome
    amended-outcome.js
    answer-remediation.js        # leaf: what remediation an Answer carries — no applicability/failure deps (#499)
    applicability-evaluator.js
    configured-outcome.js
    failure-evaluator.js
    issue-capture.js
    kpi-strip-model.js
    overdue-evaluator.js
    remediation-actions.js
    remediation-details.js
    remediation-status.js         # question-level Remediation Resolution + completion gate (#499)
    question-group-progress.js   # per-Question-Group answered/total (was section-progress.js, #390)
    general-questions.js         # General Question answer-key namespace + load-time config gates (#472)
    summary-model.js
    time-windows.js

  setup/                        # app startup helpers
    app-chrome.js                 # guarded nav + command-palette mount (fatal nav / skipped palette)
    register-routes.js
    resolve-eligible-case-types.js

  styles/
    cora-design-tokens.css
    cora-styles.css

  testing/
    in-memory-flow-runner.js

case-types/                     # one module per Case Type, lazy-loaded via manifest.js
  manifest.js                   # CASE_TYPE_IMPORTERS / QUESTION_BANK_IMPORTERS registries
  load-bank.js                  # loads a bank .txt artifact as parsed JSON (see Gotchas)
  general-questions.js          # shared General Question catalogue + resolveGeneralQuestions (#489)
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
                                # (e.g. cora-toast.test.js imports the pure Toast view)
```
