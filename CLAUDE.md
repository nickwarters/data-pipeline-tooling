# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Before doing any non-trivial work in this repo, read:

1. **[CONTEXT.md](./CONTEXT.md)** — domain language. Use these terms exactly when discussing or coding (`Case Type`, `Question Definition`, `Applicable Question`, `Answer`, `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`, `Conversation`, `Outcome`).
2. **[docs/guide/add-a-page.md](./docs/guide/add-a-page.md)** — the one-page
   authoring path: state → `h()`, actions, effects, route entry, and tests.
3. **[docs/adr/](./docs/adr/)** — 42 architecture decisions, numbered
   (`0001`–`0042`). Read the status before relying on an older decision, and do
   not deviate from an accepted ADR without surfacing the deviation explicitly.

## Project overview

Vanilla JavaScript, HTML, and CSS framework for a Case Review Platform frontend hosted on **SharePoint Subscription Edition**. **Edge Chromium only** as the browser baseline; no IE11. There is no transform step — no bundlers, no transpilers, no third-party runtime dependencies. Every byte of every deployed file is byte-identical to the byte in the repository. Modern browsers load the source `.js` natively.

## Architecture in one screen

- **SPA shell, hash routing, page independence**. One `.aspx` host page, one Content Editor, one `app.js`. The route table in `setup/register-routes.js` is the one place that names a page module, and it holds each one as a static `import` on the entry's `page` key (ADR-0042). `#/question-bank` is the single exception and keeps its `load` thunk: largest subsystem in the app, only a Maintainer opens it, and the thunk is the seam `AppContext.loadQuestionBankEditor` swaps. So the boot graph now does depend on every page but that one — a page that throws while its module is _evaluated_ is fatal to boot. What is contained is unchanged from there on. If a page module fails to load (broken, missing), the router (`lib/router.js`) catches it inside an async `navigate()`, logs it, and renders a plain-DOM `cora-route-error` panel into the route container; the nav lives outside that container and stays usable, so one broken page cannot break another or the boot. A navigation sequence token discards a stale mount that resolves after the user has already navigated on; `core/store-route.js` holds the matching token, so a page module that resolves late creates no slice and writes nothing. Registration is likewise isolated: `registerRoutes()` catches per entry, so one route failing to register costs only its own route. **Case Type modules are contained the same way (#493):** `loadCaseTypeSources()` in `setup/resolve-eligible-case-types.js` catches per slug, so a Case Type module that throws when it is evaluated is logged and DROPPED — it yields no `CaseTypeSource`, therefore appears in no `caseSources`/`journeyCaseSources`/allocation source in any partial form (containment can only narrow access, never widen it) — and every other Case Type still boots. Because a silently vanishing Case Type is indistinguishable from "no Cases assigned", boot names the dropped Case Types once in a non-blocking `cora-banner cora-banner-warning` notice (`setup/case-type-unavailable-banner.js`), mounted beside the UAT badge; nothing else in the app is hidden or gated by it. **Removal recipe — deleting a page is:** delete the page file (`src/pages/<page>.js`) + its entry in the `routeTable()` in `setup/register-routes.js` + its nav link. Still three steps; what changed is that forgetting the second one now fails `tsc`, `npm run verify` and boot loudly, where it used to cost one route quietly at runtime. `tests/component-layering-contract.test.js` enforces the layering: no file outside `src/pages/` may name a page module at all, static or dynamic, except the route table — and the route table's one dynamic page specifier must be the Question Bank editor. **The rest of boot is one static graph (#575).** Only three deferrals remain: the route table's Question Bank page thunk, the per-slug Case Type importer thunks, and the command palette in `setup/app-chrome.js` (a palette that fails to load is logged and skipped; the nav, whose failure is fatal, is now static). Everything else `src/app.js` needs is a header import, because a module whose failure kills boot gained nothing from being lazy except a serial chain of round trips. Boot's last line of defence is `boot().catch(renderBootError)` — `src/lib/boot-error-panel.js` renders a `cora-boot-error` alert panel, the same one `app-chrome.js` uses for its fatal-nav path, so a failed boot is visible instead of console-only. Its honest limit: a module in the static graph that throws while being _evaluated_ does so before that catch is registered, so the panel covers boot's body, not boot's module graph; covering that would need a fallback element in the host page that a successful boot clears, which is not done. The same contract test is the ratchet — `src/app.js` must contain no `import(` and must wire `renderBootError`.
- **Store-driven pure views in light DOM.** Each application route owns state
  shaped as `{ chrome, routes }`. Pages export `createRouteSlice()` with initial
  state, a reducer, and a pure `state → h()` view. Event callbacks dispatch
  `domain/event` actions; async work and persistence live in effects. The
  `createStoreRoute()` adapter creates the store and memo cache, commits through
  keyed `render()`, contains route failures, and cleans up on navigation. It also
  owns the mount lifetime: guard any post-`await` dispatch with `tools.isActive()`
  — never hand-roll a `let active = true` latch (#517). The same lifetime is also
  an `AbortSignal`: bind it to the client's **reads** once in `start()` with
  `withAbortSignal(client, tools.signal)` — inside the page's own falsy-client
  guard, so a client-less mount still degrades rather than failing the route —
  so navigating away cancels the requests the abandoned page had in flight, and
  handle the rejection with `ignoreAbortError` — an abort is navigation, never a
  toast or a `cora-route-error` (#545). Writes are never cancelled: `SaveQueue`
  holds the raw client and drops any `signal` handed to `loadCase`. **Every
  route slice that reads Cases now binds it** (#545, #567), and
  `tests/abort-binding-contract.test.js` is the ratchet — a new page cannot be
  added unbound. The one exemption is `roadmap.js`: `withAbortSignal` binds only
  the reads carrying an options bag (`getCase`/`listCases`/`countCases`), and
  `listRoadmapItems()` takes none, so wrapping it would read as covered while
  cancelling nothing. The contract test names that exemption and fails if it
  stops being true.
- **Case Review Sections are data plus a panel renderer.** `lib/section-registry.js`
  (ADR-0032) says which Sections exist and in what order; `pages/cora-case-review/section-panels.js`
  says how each one's panel is filled, keyed by Section id — the render loop in
  `cora-case-review.js` never branches on the id. **Adding a Section recipe:** an
  entry in `SECTION_REGISTRY` + its `MATRIX` access row in `services/section-access.js`
  - its `DEFAULT_SECTION_LABELS` label + a `SECTION_PANELS` renderer. `tsc` demands
    the first three; `tests/section-panels.test.js` demands the fourth. The panel map
    lives with the page, not the registry, because `src/lib/` must not import `src/pages/**`.
- **One authoring model.** Views are synchronous and side-effect free. They do
  not import clients or persistence services. Start with
  [`docs/guide/add-a-page.md`](./docs/guide/add-a-page.md); use
  [`docs/guide/store-actions-and-effects.md`](./docs/guide/store-actions-and-effects.md)
  and [`docs/guide/router.md`](./docs/guide/router.md) as reference.
  **Prop naming is a contract, not a style:** DOM events handed to `h()` are
  lowercase (`onclick`, `oninput`, `onchange`, `onkeydown`) and the class prop is
  `className`. camelCase `on[A-Z]` is reserved for component callback props
  (`onAnswer`, `onSort`, `onCommit`) — a view function reads those off its own
  props object, so they are never handed to `h()`. `h()` enforces both by
  throwing on `on[A-Z]` and on `class`: the mistake is caught where it is made,
  rather than by a repo-wide scan after the fact.
  **`view` produces, `render` commits (ADR-0039).** A _view_ is pure, returns an
  `h()` tree and touches nothing — `slice.view()`, `*View()`, `*-view.js`, the
  thunk passed to `memo()`. _Render_ means committing a tree into a live
  container, and `core/render.js` (`tools.render(container, tree)`) is the only
  thing that does it. Never name a producer `render`; the store's callback is
  `onStateChange` precisely because the store does not touch the DOM.
- **Light DOM and CSS isolation.** `h()` creates safe DOM nodes, keyed `render()`
  preserves focus/caret/scroll across renders, and the `cora-` CSS prefix remains
  the SharePoint-isolation boundary. See the current
  [state/action/render explainer](./docs/component-anatomy-explainer.html).
- **Case Type config as JS modules; Question Bank content as SharePoint-hosted text artifacts.** One module per Case Type under `case-types/{slug}.js`, lazy-loaded via `case-types/manifest.js`. Question Bank content (Question Definitions, labels, and Outcome vocabulary) lives in `case-types/banks/{slug}.txt`, stored in the SharePoint Style Library and loaded through `case-types/load-bank.js` as part of the Case Type config. There is no shared Question Definitions list and no planned runtime join to one. `HttpSharePointClient`/`MockSharePointClient` expose `getExportHash`/`getVersionedExport` for ADR-0021's immutable, point-in-time exports on reportable Cases.
- **JSDoc + `tsc --checkJs` for types**. No `.ts` files; the deployed JS is the source JS. `npm run check` runs `tsc --noEmit --checkJs --allowJs`.
- **Per-Case-Type `showWhen` graph + `outcome` function**. Applicability is data (declarative `showWhen`); outcome is code (exported function). Same module, one place to look.
- **Case storage: everything on the Case row**. `Answers` and `Conversation` as JSON blobs on a per-Case-Type SharePoint list row. Notes as plain text. Field-level PATCH only.
- **Auto-save: 1500ms debounce + ETag concurrency**. A single `SaveQueue`
  primitive owns writes; views never call `fetch` directly.
- **Mock-first dev loop**. All REST goes through a `SharePointClient` interface. `?mock=1` URL param swaps in `MockSharePointClient` from `dev/fixtures/`. The mock client and its fixtures stay behind a gated dynamic `import()` — `dev/` is not deployed — while `HttpSharePointClient` is a static import. `node --test` for unit tests.
- **Auth: browser NTLM/Kerberos; security via SharePoint list permissions**. Client-side group checks are UX-only; the real boundary is SharePoint's list ACLs.
- **Two live environments: prod and UAT (ADR-0033)**. Same source tree, deployed twice: prod at `Style Library/CODE/CORA` + `SitePages/app.aspx` + unprefixed lists; UAT at `CODE/CORA-UAT` + `SitePages/uat.app.aspx` + `uat_`-prefixed lists (`deploy_to_sharepoint.py --env uat`). The deployed host page declares its environment via the `{{CORA_ENV}}` token → `window.CORA_ENV`; `src/config/environment.js` is the only place that resolves it, and `HttpSharePointClient` applies the list prefix centrally. Never branch on the environment name elsewhere.

## Hard rules

- **No third-party runtime dependencies, ever.** Dev/CI tools (tsc, prettier, node test runner) are fine.
- **No transform step (ADR-0041).** Every byte of every deployed file — `.js`, `.css`, `.html`, `.aspx` and the `case-types/banks/*.txt` artifacts alike — is byte-identical to the byte in the repository; no tool produces code, and committing generated output does not satisfy this (the repository byte must be the authored byte). The only carve-out is literal `{{CORA_BASE}}`/`{{CORA_ENV}}` token substitution in `.html`/`.aspx` template files. Bundling, minification, transpilation and import rewriting are banned outright. Verification, hashing, graph analysis and upload ordering are fine — they are read-only over the bytes, the same category as tsc/prettier/eslint/husky.
- **Views never call `fetch()` directly** — effects use the `SharePointClient`
  interface. This is what makes the mock-first development loop work.
- **No `innerHTML` for user data.** XSS prevention; also preserves input state.
- **`cora-` is a CSS namespace, not an element registry.** The prefix stays the
  SharePoint isolation boundary for every class name and custom property
  (ADR-0001, ADR-0029) — but no `cora-*` custom element is registered or
  constructed any more (ADR-0034 as amended): render a plain element carrying a
  `cora-…` `className`. `tests/cora-element-type-contract.test.js` ratchets both
  halves — no `h('cora-…')`/`createElement('cora-…')` under `src/`, and no
  element-type `cora-*` selector in `src/styles/**`, which would match nothing
  and silently drop its declarations.
- **No issue, PR or ADR references in `.js` files.** Comments, test names and
  assertion messages must not cite `#123`, `ADR-00XX`, or work-item tags
  (`CASE-1`, `CORE-2`, `GRID-4`, `BANK-2`, `MAINT-11`). A comment explains
  **why the code is the way it is**, in its own words, so it reads without a
  tracker or the ADR index open — if a reference is doing the explaining, write
  the reason out instead. This applies to `src/`, `case-types/`, `dev/`,
  `tests/` and `scripts/` alike; ADR numbers still belong in `docs/adr/`,
  markdown, commit messages and PR bodies. JSDoc types are untouched by this
  rule.
- **Question Definitions are never deleted** — use a `deprecated` flag (avoids dangling references from Case Type modules).
- **Case Type descriptors express genuine Case Type variation; branching behaviour stays in code** (ADR-0035). Descriptors may select stable keys, labels, property paths, ordering, membership, and simple flags. Permission/lifecycle decisions, navigation, conditional formatting, event handling, and effects belong in code. Dashboard composition is dashboard-owned and must not be declared by Case Type configuration (ADR-0036); the dashboard consumes resolved `caseSources` only for Case data access. Case table columns are framework-owned the same way (ADR-0040): `standardCaseColumns()` is the fixed set for every Case Type, so scoping a Case table narrows its rows and never its columns. `sections` is the only Case Type presentation descriptor left.

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

Run `npm run verify` alongside it. `npm run check` (tsc) already catches a
dangling specifier and a case-mismatched one, so what the gate adds is: the
dependency-graph artifact at `.verify/import-graph.json` (gitignored, and
written only when the run is clean); rejection of bare package specifiers, which
tsc resolves through `node_modules` while the browser cannot; and Node's own
parser over every `.js` under `src/` and `case-types/`. The graph covers **every
file the deploy uploads**, not only the modules — `.css` `@import`s, the host
page's `{{CORA_BASE}}`-based `<link>`/`<script>` references (any other href is a
SharePoint-owned asset and is ignored), and the Case-Type-to-`banks/*.txt` edge —
so an unresolved asset reference is a gate failure too, and the artifact records
the include roots and suffixes it scanned for the deploy to assert against. On top of the graph it
then **evaluates the configuration in Node** (`scripts/verify-config.js`): every
Case Type module is imported and its config checked (a `computeOutcome`
function, an explicit `listName`, no duplicate Question Definition ids, no
dangling or cyclic `showWhen` reference, no `showWhen` node whose siblings the
evaluator would silently ignore, no unknown `sections` key); every
`case-types/banks/*.txt` artifact is parsed and shape-checked, and every registry
`bank` thunk must name one that exists; and the route table is checked for
malformed or duplicated hash patterns. These checks are skipped when the graph is
not clean, and the graph artifact is written only when everything passes.
Per-slug containment and the unavailable-Case-Type boot banner stay the
serving-time backstop regardless. Run `check`, then `verify`, then
`test:coverage`, then `test:deploy` (the Python suite for the deploy script)
before a deploy — there is no automated pipeline, so a deploy is only as verified
as the commands someone ran first. The one exception is `verify`: the deploy runs
it itself as a pre-flight gate and aborts on failure, orders its uploads from the
graph it writes, and re-fetches every deployed file afterwards to compare hashes
— see [`scripts/deploy_to_sharepoint.md`](./scripts/deploy_to_sharepoint.md).

The global floor is a backstop, not a quota. Keep security, SharePoint protocol,
concurrency, permissions, and outcome/applicability code at 100% line and branch
coverage wherever practical. Test exact external contracts there. Elsewhere,
prefer public behaviour over child positions, private listener registries, or
private methods; do not add white-box assertions solely to cover a syntactic
line.

## Git: linear history

**Keep branch history linear. Rebase onto `main`; do not merge `main` into a
branch.** When a branch falls behind, `git fetch origin && git rebase
origin/main`, then `git push --force-with-lease`. A merge commit on a feature
branch is a defect to fix, not a state to preserve.

One conflict recurs when rebasing, and it looks textual when it is not:

- **`CLAUDE.md`'s ADR count and Directory layout block.** Both move on almost
  every branch. Take the higher ADR count and the union of the layout entries —
  `tests/claude-md-layout-contract.test.js` will catch a dropped module, but
  only for `src/` and `case-types/`.

When a rebase reproduces a resolution you already worked out on a merge, tag the
merge commit first and `git diff --quiet <tag> HEAD` afterwards: the trees should
be identical, which is the cheapest proof the rebase did not lose anything.

## Directory layout

```
src/
  app.js                        # entry point
  sharepoint-client.js          # shared typedefs (SharePointClient interface)

  lib/                          # framework-level primitives (no domain knowledge)
    abort.js                    # isAbortError/ignoreAbortError: an aborted read is navigation, not a failure (#545)
    add-working-days.js
    boot-error-panel.js         # cora-boot-error: the "boot did not finish" panel, shared by app.js and app-chrome's fatal-nav path (#575)
    capture-engine.js
    case-loader.js              # loads a Case Review page and hands it over once via toStoreSnapshot() (was case-review-view-model.js, #555)
    case-machine.js
    case-route-links.js
    case-statuses.js            # CASE_STATUS: the persisted Case lifecycle values — do not change them
    empty-state.js              # EmptyState/LoadingState: the shared "nothing here yet" and
                                #   in-flight placeholders, one spelling of each
    html.js                     # h() plain-function view primitive
    navigate.js                 # navigateTo/redirectTo: the only writers of location.hash (#519)
    question-order.js           # generic question/category ordering helpers (was question-bank/)
    response-options.js         # single source of truth for response options + the NA_VALUE literal (#391)
    route-error-panel.js        # shared route-failure panel, used by router.js and core/store-route.js (#437)
    router.js                   # hash-based SPA router
    section-labels.js           # DEFAULT_SECTION_LABELS + per-Case-Type sectionLabels overrides
    section-registry.js         # ADR-0032 single source of truth for which Sections exist and their order
    showwhen-tree.js            # generic showWhen tree parse/serialise/mutate (was question-bank/)

  core/                         # store-driven view runtime (ADR-0034)
                                #   see docs/guide/store-actions-and-effects.md for the contract
    chrome-state.js             # shared toasts/nav/current-user/permissions store slice
    render.js                   # keyed DOM reconciler: commits an h() tree into a live container,
                                #   patching in place (focus/caret/scroll survive) — CORE-2 (#404),
                                #   named morph() until ADR-0039
    store.js                    # single route-local store: dispatch/reducer, coalesced
                                #   onStateChange — CORE-3 (#405)
    memo.js                     # per-view memo cache, keyed by position, cleared on unmount — CORE-4 (#406)
    store-route.js               # adapts a store-driven route module to the Router handler shape — CORE-6 (#407)
    route-state.js              # patchRoute/setRoute/patchSnapshot: the immutable route-slice
                                #   patch and whole-slice replace reducers call instead of
                                #   respelling the nest (#518, #546)

  actions/                      # effects: async work reached only via dispatch
    case-actions.js             # persistence effect example: SharePointClient + SaveQueue re-entering via dispatch

  components/                   # reusable pure views, layered by dependency
    base/                       # leaf primitives — compose no other view
      cora-people-picker.js        # pure People Picker renderer and search helpers
      cora-group-progress.js      # pure per-Question-Group progress strip
      cora-status-banner.js
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
    environment.js              # ADR-0033: the only resolver of window.CORA_ENV (prod vs uat)
    working-days.js

  pages/                        # route slices, top-level views, and focused page actions
    cora-case-review.js        # store slice + pure tab shell
    cora-case-review/          # store actions/effects and pure Section views
      answer-actions.js        # the pure Answer mutations; the store is the single owner (#510)
      section-panels.js        # SECTION_PANELS: one panel renderer per tab Section, keyed by id (#512)
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
      appeal-effects.js        # the persistence half of those transitions: injected clock + id, SaveQueue writes (#511)
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
    cora-my-team.js               # store-driven Team Workload slice + pure per-Reviewer workload view
    roadmap.js                    # store-driven Roadmap slice and pure view
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
      question-bank-flags.js     # ?simulate=1 style URL-param flags for the workbench
      question-bank-samples.js   # loads a capped sample of historical Cases for the simulator
      question-bank-simulate.js  # pure impact simulator: replays sample Answers against a draft bank (#202)
      question-bank-source.js
      simulate-panel.js         # pure golden-tested impact-simulation view

  views/                        # generic store-driven pure renderers
    case-columns.js             # shared Case-table column descriptors (#515): the Case-aware consumer of
                                #   data-table.js, and the fixed column set for every Case Type (ADR-0040)
    data-table.js               # descriptor-driven table view (value, sort, format, links)

  services/                     # non-UI modules: data, state, auth
    abortable-client.js           # binds a mount-lifetime AbortSignal to a client's Case reads; writes untouched (#545)
    account-name.js
    across-sources.js             # multi-list fan-out: one scoped request per Case source, merged (ADR-0022)
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
    remediation-details.js
    remediation-status.js         # question-level Remediation Resolution + completion gate (#499)
    question-group-progress.js   # per-Question-Group answered/total (was section-progress.js, #390)
    general-questions.js         # General Question answer-key namespace + load-time config gates (#472)
    summary-model.js
    team-workload-model.js       # per-Reviewer workload rows for the My Team page
    time-windows.js

  setup/                        # app startup helpers
    app-chrome.js                 # guarded nav + command-palette mount (fatal nav / skipped palette)
    case-type-unavailable-banner.js # boot notice naming Case Types that failed to load (#493)
    register-routes.js            # routeTable(): THE list of hash routes + the page module behind each
                                  #   one, statically imported — bar the Question Bank editor's thunk
    resolve-eligible-case-types.js  # per-slug Case Type containment + the app-wide eligibility rule
    uat-banner.js                 # ADR-0033 UAT-only environment badge; renders nothing on prod

  styles/
    cora-design-tokens.css
    cora-styles.css

case-types/                     # one module per Case Type, lazy-loaded via manifest.js
  manifest.js                   # CASE_TYPES: THE Case Type registry (slug + displayName +
                                #   lazy importer/bank thunks); CASE_TYPE_IMPORTERS,
                                #   QUESTION_BANK_IMPORTERS and permissions.caseTypes derive from it
  load-bank.js                  # loads a bank .txt artifact as parsed JSON (see Gotchas)
  general-questions.js          # shared General Question catalogue + resolveGeneralQuestions (#489)
  complaints.js                 # the only live Case Type (#383)
  banks/                        # Question Bank content, JSON text stored as .txt (see Gotchas)
    complaints.txt

scripts/
  scaffold_case_type.py         # scaffolds a new Case Type module + bank artifact (ADR-0028)
  deploy_to_sharepoint.py       # the diff sync, plus its pre-flight verify gate, graph-derived
                                #   leaf-first upload order and post-upload hash verification
  deploy_to_sharepoint.md       # THE deploy runbook: pre-conditions, prod/UAT steps, the failure
                                #   playbook, and the hand-upload/drive-by-edit caveats
  module-graph.js               # shared import-specifier scanner: the one answer to "what does
                                #   this file import?", used by the verify gate and the layering test
  verify-config.js              # the verify gate's configuration half: evaluates Case Type modules,
                                #   bank artifacts and the route table in Node, so a broken Case Type
                                #   is found before a browser loads it
  verify_build.js               # npm run verify: parses every src/ + case-types/ module, resolves every
                                #   specifier and asset reference case-sensitively over the whole deployed
                                #   file set; emits .verify/import-graph.json
  run_in_memory_flow.js
  uat_acl_smoke.js              # UAT list-ACL smoke check (npm run test:security:uat)
  uat-acl-smoke.example.json    # sample config for the ACL smoke check

dev/                            # local dev loop; not deployed
  index.html                    # dev host page for the mock-first loop (?mock=1)
  styleguide.html               # rendered component/style reference
  fixtures/                     # mock data used by MockSharePointClient (?mock=1)
    cases.js
    people.js                   # directory people backing searchPeople
    personas.js                 # ?asUser= personas (default: reviewer)
    roadmap.js

tests/                          # node:test unit tests — flat, one file per subject by filename
                                # (e.g. cora-toast.test.js imports the pure Toast view).
                                # `_`-prefixed files are shared helpers, not suites:
                                # _in-memory-flow-runner.js is the headless flow
                                # harness (also driven by scripts/run_in_memory_flow.js)
```
