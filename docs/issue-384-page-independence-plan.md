# Issue #384 — Page independence: execution plan

Lazy route loading + route-level error boundaries so breaking one page cannot break another.

Orchestration decided by the human: **Phase 1 = one sonnet sub-agent; Phase 2 = eight sonnet sub-agents run sequentially in this worktree; Phases 3+4+5 = one sonnet sub-agent.** Every sub-agent works strict TDD (red → green → refactor, ONE test at a time — never a batch of tests upfront) and **commits + pushes after finishing its unit** (branch `claude/issue-384-orchestration-728bfe`, commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

## 1. Problem / goal recap

One static module graph means one broken page file kills the whole app at boot: `app.js` dynamic-imports `setup/register-routes.js` (app.js:72), which _statically_ imports all nine `routes/*` modules (register-routes.js:2–10), and each route (except question-bank) statically imports its page. `lib/router.js` calls `handler.mount()` bare and synchronously (router.js:63) — no error boundary. `app.js` also eagerly imports the whole case-review graph at boot (app.js:14), and `pages/cora-dashboard.js` statically imports three sibling pages.

**Behavioural definition of done:** delete `src/pages/cora-reports-index.js` entirely → app boots, nav renders, `#/dashboard` works, `#/reports` shows an in-page load-failure panel. Restoring the file restores the route with no other change. (This is a browser-level check — see §7 "DoD verification".)

The in-repo reference is `src/routes/question-bank.js`: the editor is dynamic-imported inside `mount()`.

## 2. Known-good baseline (do NOT chase these)

Full `node --test` on this machine (Node v18.10.0) shows **exactly 2 pre-existing failures, both unrelated to #384**, caused by the local Node lacking globals:

- `tests/question-bank-compile.test.js` — `crypto is not defined`
- `tests/view.test.js` — `CustomEvent is not defined`

All router/routes tests pass at baseline. Every agent must treat ONLY these two as acceptable pre-existing failures. "Green full suite" throughout this plan means: no failures other than these two. Introducing any new failure is a defect in your change.

## 3. Verification commands (used by every task)

```sh
# focused (per task — substitute the route test file)
node --test tests/routes-<name>.test.js tests/router.test.js tests/register-routes.test.js

# full suite (only the 2 baseline failures may remain)
node --test

# types
npm run check        # = tsc --noEmit --checkJs --allowJs
```

Run all three before committing. Coverage discipline: `node --test --experimental-test-coverage` — no uncovered lines in files you touched.

## 4. Divergences from the ticket found in the real code

1. **`routes/root.js` mounts into `context.appEl`, not the router container** (`appEl.replaceChildren(...HomePage(...))`, and unmount clears `appEl`). The Phase 1 error panel renders into the router _container_; for the root route a failed load therefore leaves `appEl`'s previous content untouched and puts the panel in the container. Acceptable — do not "fix" root's mount target in this ticket.
2. **`routes/question-bank.js` has a static page import the ticket missed**: `import { simulatorEnabled } from '../pages/question-bank/question-bank-flags.js'` (line 5). Via `register-routes.js`'s static route imports, a broken/missing `question-bank-flags.js` today kills _all_ routes. Phase 5's rule (a) would flag it; the Phases 3–5 agent converts it to a dynamic import inside `mount()` (§Phase 5) rather than allowlisting.
3. **`routes/question-bank.js` `mount()` fires `loadEditor().then(...)` without returning the promise** — a failed editor load is an unhandled rejection today and would bypass the Phase 1 boundary. Phase 5 makes the mount async and awaits (§Phase 5), giving question-bank the same error panel as everyone else.
4. **`tests/register-routes.test.js` contains route-_mount_ behaviour tests** (for `#/`, `#/dashboard`, `#/reports`, `#/reports/reviewer-team` redirect, `#/question-bank` fullbleed add/remove which chains a `#/dashboard` navigate). These call `router.navigate(...)` synchronously and assert immediately. Each Phase 2 task must update the register-routes tests that exercise _its_ route (await the navigate). This file also installs `HTMLElement`/`customElements` stubs _because_ routes statically import pages — after Phase 2 the comment at lines 13–15 is stale (the Phases 3–5 agent refreshes it in Phase 5).
5. **`src/testing/in-memory-flow-runner.js` statically imports `pages/cora-case-review/completion-controller.js`.** It is a dev/test harness (used by `scripts/run_in_memory_flow.js` and tests), not part of the boot graph. Phase 5 rule (a) allowlists it explicitly.
6. **Ticket line numbers verified accurate** against current code: app.js:11–15 (boot `Promise.all`), app.js:14 (case-review import), app.js:2–7 (stale comment), app.js:72 (register-routes import), app.js:87 (boot catch), router.js:63 (bare mount), register-routes.js:2–10 (static route imports). No drift.
7. **There is no test for `app.js` itself** (it is a side-effecting entry module; `tests/app-fullbleed.test.js` only _simulates_ its fullbleed wiring against a Router). Phase 3 therefore extracts the new guarded chrome-mount logic into a testable `src/setup/` helper instead of burying untestable try/catch in app.js (§Phase 3).

## 5. Phase 1 — Router: async mount + error boundary (ONE sub-agent)

**Files:** `src/lib/router.js`, `tests/router.test.js`, `src/setup/register-routes.js`, `tests/register-routes.test.js`. Nothing else.

**Context capsule for the agent:** those 4 files + CLAUDE.md (Hard rules, Test discipline) + §2/§3 of this plan.

### Target contract (everything in Phase 2 copies this)

- `RouteHandler` typedef becomes `{ mount: (el, params) => void | Promise<void>, unmount: () => void }`.
- `navigate(hash)` becomes `async`. **Critical ordering:** match → early-return on no match → bump a navigation token (`this._navSeq = (this._navSeq ?? 0) + 1`; capture `const token = this._navSeq`) → unmount current → set `_current` → call `mount` inside `try { await matched.handler.mount(container, params) } catch (err) { ... }`. Because an `async` function runs synchronously until its first `await`, the unmount + mount _call_ still happen synchronously — **all existing sync route tests and `tests/app-fullbleed.test.js` keep passing unmodified**. Do not add any `await` before the `mount` call.
- **Error boundary:** in the `catch`, if `token !== this._navSeq` return silently (stale). Otherwise `console.error` including the route pattern/hash and the error, and render a minimal panel into the container using **plain `document.createElement` + `textContent`** (keep router dependency-free — do not import `lib/html.js`; no `innerHTML` ever): a wrapper with `className = 'cora-route-error'`, a short heading ("This page failed to load") and a body line ("Use the navigation to go somewhere else, or reload to retry."). Replace container children with it. The nav lives outside the router container, so it stays usable.
- **Stale-navigation guard on success too:** after the `await` resolves normally, nothing needs re-rendering (mount already rendered), so the success path needs no token check — only the _error_ path must not clobber a newer page. (If the agent instead centralises rendering, the guard must cover both; keep it minimal: guard the catch.)
- `init()` unchanged except the hashchange listener and initial call may ignore the returned promise (`void this.navigate(...)` is fine; ensure no unhandled rejection — navigate never rejects because it catches).
- **Belt-and-braces in `setup/register-routes.js`:** registration-time failures. Because the `registerX` functions are static imports, the try/catch is only testable via an exported helper: add `export function safeRegister(name, fn, router, context)` that calls `fn(router, context)` in try/catch + `console.error('[CORA] route registration failed: ' + name, err)`; `registerRoutes` calls `safeRegister('root', registerRoot, ...)` etc. for all nine. Unit-test `safeRegister` directly with a throwing fn (asserts no throw + console.error called) and a succeeding fn.

### TDD checklist (one test at a time)

1. RED: test — an async mount that rejects renders an element with `className` `'cora-route-error'` into the container (spy container `replaceChildren`; stub `console.error` around the awaited `router.navigate(...)`). GREEN: async navigate + try/catch + panel. REFACTOR.
2. RED: test — the rejection is logged via `console.error` mentioning the hash. GREEN/refactor.
3. RED: test — an async mount that _resolves_ renders normally and no error panel appears (`await router.navigate(...)`).
4. RED: **race test** — register two routes whose mounts are controlled promises; `const p1 = router.navigate('#/slow')` then `await router.navigate('#/fast')`; then reject/resolve the slow one and `await p1`; assert the container still shows the fast route's content and no `cora-route-error` was rendered. GREEN: token guard.
5. RED: test — a mount that throws _synchronously_ also produces the error panel (covers the sync-throw branch).
6. RED (register-routes): test — `safeRegister('x', throwingFn, router, ctx)` does not throw and logs. GREEN: add `safeRegister`, rewire `registerRoutes` through it (existing register-routes tests prove the rewire didn't lose routes).
7. Refactor pass, update the `RouteHandler` typedef + file-top comment in router.js, run §3 commands, confirm zero uncovered lines in both touched src files, commit + push: `Router: async mount, route error boundary, stale-nav guard (#384 phase 1)`.

**Must-not:** do not modify any `src/routes/*` or `src/pages/*` file; do not rewrite existing passing tests (only add).

## 6. Phase 2 — Convert 8 routes to lazy page loading (EIGHT sub-agents, sequential)

### The shared pattern (paste into every task brief)

Each route module changes from a static page import to an **injectable page loader with a dynamic-import default**, evaluated inside an async `mount()`:

```js
// before
import { HomePage } from '../pages/cora-home.js';
export function register(router, context) { ... mount() { ...HomePage(...) ... } ... }

// after
/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-home.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-home.js')
) {
  router.register('#/', {
    async mount(container, params) {
      const { HomePage } = await loadPage();
      // ...render exactly as before...
    },
    unmount() { /* unchanged */ },
  });
}
```

Rules:

- **Guards run before the `await`.** Routes with redirects (`reports/reviewer-team`'s `isReviewerManager` check, `journey-cases`' empty-sources check) keep the guard as the first synchronous statement of `mount()` and `return` before any import — a redirected user must not pay for (or be broken by) the page module.
- **Let rejections propagate** — no try/catch in the route; the Phase 1 router boundary owns failure.
- The third `loadPage` parameter exists **only** so tests can inject a rejecting loader (mirrors `question-bank.js`'s `context.loadQuestionBankEditor` injection idea without widening `AppContext` for eight routes). `register-routes.js` keeps calling `register(router, context)` — the default stays covered by the happy-path test, which uses the real dynamic import.
- **Do not change any `src/pages/*` file.** Do not change `router.js`. Read `src/routes/question-bank.js` first as the in-repo reference for "page code loads at mount time".

Paired-test changes (every task):

- Any test that calls `router.navigate(...)` and then asserts must `await router.navigate(...)` (mount is now async; the real page module import resolves on a later microtask — asserting synchronously now fails, and `finally` blocks that restore `globalThis.document` would otherwise restore it _before_ the page renders).
- Add ONE new test: `register(router, context, () => Promise.reject(new Error('boom')))` (stub `console.error`), `await router.navigate('#/<pattern>')`, assert the container received a `cora-route-error` element instead of an unhandled rejection.
- Update the tests **in `tests/register-routes.test.js` that exercise this route's mount** (see table) to await the navigate. Leave other routes' tests alone.

TDD checklist per task:

1. RED: write the rejecting-loader → `cora-route-error` test (fails: `register` has no third param / mount is sync). GREEN: convert the route to the pattern above. This same step usually turns the existing happy-path mount test red (sync assert) — fix by awaiting, which is part of GREEN.
2. RED→GREEN: adjust each remaining affected existing test one at a time (await navigates; register-routes tests for this route).
3. REFACTOR; run §3 focused + full + `npm run check`; commit + push: `Lazy-load <page> in routes/<name> (#384 phase 2.<n>)`.

### Per-route capsules

Every capsule implicitly includes: `src/lib/router.js` + `tests/router.test.js` (the Phase 1 contract — read, don't touch), `src/routes/question-bank.js` (reference — read, don't touch), CLAUDE.md hard rules + test discipline, §§2–3 and the shared pattern above.

**Task 2.1 — root.** Files: `src/routes/root.js`, `tests/routes-root.test.js`. Make lazy: `import { HomePage } from '../pages/cora-home.js'`. Pattern: `#/`. Quirk: mount renders into `context.appEl.replaceChildren(...)`, not the container, and unmount clears `appEl` — preserve exactly. Also update in `tests/register-routes.test.js`: `'#/ mount renders home route directly (no redirect)'` (await the navigate).

**Task 2.2 — dashboard.** Files: `src/routes/dashboard.js`, `tests/routes-dashboard.test.js`. Make lazy: `import { DashboardPage } from '../pages/cora-dashboard.js'`. Pattern: `#/dashboard`. Also update in `tests/register-routes.test.js`: `'#/dashboard mount composes the dashboard page into the container'` AND `'#/question-bank unmount removes cora-fullbleed from appEl'` (its follow-on `router.navigate('#/dashboard')` must be awaited before the `finally` restores `document`). Note `tests/routes-dashboard.test.js` uses `installDom()` from `tests/_dom-stub.js` + top-level `await import` of the route — keep that structure.

**Task 2.3 — conversation.** Files: `src/routes/conversation.js`, `tests/routes-conversation.test.js`. Make lazy: `import { ConversationView } from '../pages/cora-conversation-view.js'`. Patterns: `#/conversation/:caseType/:id` and `#/conversation/:id` — one shared handler registered twice; the single `loadPage` covers both. Test file imports `./_register-example-review.js` and `installDom()` — keep.

**Task 2.4 — case.** Files: `src/routes/case.js`, `tests/routes-case.test.js`. Make lazy: `import { CaseReviewPage } from '../pages/cora-case-review.js'`. Patterns: `#/case/:caseType/:id`, `#/case/:id` (shared handler). Note: until Phase 3 removes the eager `app.js` import, laziness here is correct but not yet effective at runtime — expected, say so in the commit body. Test file uses `_register-example-review.js`, `installDom`, `flush` — keep; `flush()` after awaited navigate is fine.

**Task 2.5 — reports (two pages, loaded separately).** Files: `src/routes/reports.js`, `tests/routes-reports.test.js`. Make lazy: `import { ReportsIndexPage } from '../pages/cora-reports-index.js'` and `import { ReviewerTeamReportPage } from '../pages/cora-reviewer-team-report.js'` — **each in its own route's mount**, so a broken reviewer-team report cannot break the reports index. Injection shape: `register(router, context, { loadIndex = () => import('../pages/cora-reports-index.js'), loadReviewerTeam = () => import('../pages/cora-reviewer-team-report.js') } = {})`. The `isReviewerManager` redirect guard stays synchronous _before_ `await loadReviewerTeam()`. Add TWO rejection tests (one per pattern: `#/reports`, `#/reports/reviewer-team`). Also update in `tests/register-routes.test.js`: `'#/reports mount renders reports index directly'` and `'#/reports/reviewer-team redirects when the user is not a reviewer manager'` (the redirect test still passes synchronously but await anyway for consistency).

**Task 2.6 — team-cases.** Files: `src/routes/team-cases.js`, `tests/routes-team-cases.test.js`. Make lazy: `import { TeamCasesPage } from '../pages/cora-team-cases.js'`. Pattern: `#/team-cases`. Quirk: mount computes `queryString` from `location.hash` — compute it **before** the `await` so it captures the hash at navigation time.

**Task 2.7 — my-cases.** Files: `src/routes/my-cases.js`, `tests/routes-my-cases.test.js`. Make lazy: `import { ResponsiblePartyDashboard } from '../pages/cora-responsible-party-dashboard.js'`. Pattern: `#/my-cases`. Preserve the explanatory comment about `cora-open-conversation` having no listener.

**Task 2.8 — journey-cases.** Files: `src/routes/journey-cases.js`, `tests/routes-journey-cases.test.js`. Make lazy: `import { JourneyCasesPage } from '../pages/cora-journey-cases.js'`. Pattern: `#/journey-cases`. Quirk: the `journeyCaseSources.length === 0` redirect guard stays synchronous before the `await`; keep its comment.

## 7. Phases 3 + 4 + 5 — Boot slimming, cross-page imports, enforcement + docs (ONE sub-agent, in order)

**Context capsule:** `src/app.js`, `src/setup/register-routes.js`, `src/setup/uat-banner.js` (pattern reference for small setup helpers + its test `tests/uat-banner.test.js`), `src/pages/cora-dashboard.js`, `src/pages/cora-action-centre.js`, `src/pages/cora-controls-dashboard.js`, `tests/cora-action-centre.test.js`, `tests/cora-controls-dashboard.test.js`, `tests/cora-dashboard.test.js`, `src/routes/question-bank.js`, `tests/routes-question-bank.test.js`, `tests/component-layering-contract.test.js`, `tests/register-routes.test.js`, CLAUDE.md, §§2–4 of this plan. Commit + push after EACH of the three phases.

### Phase 3 — Boot slimming (`src/app.js` + new tested helper)

Decision (recorded here so the agent doesn't re-litigate): **a broken `cora-app-nav` is fatal-with-message** — without nav the app is unusable, so render a plain-DOM error into `appEl` ("CORA failed to start: navigation could not load. Reload to retry.", `className 'cora-boot-error'`, `textContent` only) and stop boot. **A broken command palette is non-fatal**: `console.error` and continue.

Because `app.js` is an untestable side-effecting entry module (see §4.7), put the guarded logic in a new tested helper `src/setup/app-chrome.js`:

```js
export async function mountAppChrome(appEl, capabilities, {
  loadNav = () => import('../components/sections/cora-app-nav.js'),
  loadPalette = () => import('../components/sections/cora-command-palette.js'),
  body = document.body,
} = {}) → Promise<boolean>  // false = nav failed (fatal message already rendered)
```

- nav path: `await loadNav()` in try/catch → on failure render the boot error into `appEl`, `console.error`, return `false`; on success create `cora-app-nav`, set `.capabilities`, append to `appEl`.
- palette path: `await loadPalette()` in try/catch → on failure `console.error` and skip; on success append `cora-command-palette` to `body`.

TDD (one at a time): (1) RED nav-success mounts nav with capabilities → GREEN; (2) RED palette-failure logs + still returns true + no palette appended; (3) RED nav-failure renders `cora-boot-error` into appEl and returns false; (4) RED palette-success appends palette to body. Use `installDom()` from `tests/_dom-stub.js`; new test file `tests/app-chrome.test.js`.

Then edit `app.js`: delete the boot `Promise.all` (lines 11–15) entirely — `cora-app-nav`/`cora-command-palette` now load inside `mountAppChrome`, and `./pages/cora-case-review.js` is no longer imported at boot (Phase 2.4 made the route lazy). Call `const ok = await mountAppChrome(appEl, capabilities); if (!ok) return;` at the point where nav/palette were created (after `appEl` setup, before the router container). Rewrite the stale comment block (lines 2–7): the shell wires shared services; **every page loads on demand inside its route's `mount()`, guarded by the router error boundary**; nav failure is fatal-with-message, palette failure is skipped. `app.js` itself stays test-exempt as today.

Verify §3 (`tests/app-chrome.test.js tests/router.test.js tests/register-routes.test.js`, full suite, `npm run check`). Commit: `Boot slimming: on-demand pages only, guarded chrome mounts (#384 phase 3)`.

### Phase 4 — Remove cross-page static imports

`git mv src/pages/cora-action-centre.js src/components/collections/cora-action-centre.js` and `git mv src/pages/cora-controls-dashboard.js src/components/collections/cora-controls-dashboard.js` (both are only mounted by the dashboard, never routed). Then:

- Fix relative imports **inside the moved files** — depth changes from `src/pages/` (one level below `src/`) to `src/components/collections/` (two levels): `../lib/...` → `../../lib/...`, `../services/...` → `../../services/...`, `../evaluators/...` → `../../evaluators/...`, `../sharepoint-client.js` → `../../sharepoint-client.js`, `../setup/...` → `../../setup/...`; and `../components/collections/cora-case-table.js` (in cora-controls-dashboard.js) → `./cora-case-table.js`. Check JSDoc `import(...)` type paths too — `tsc` will catch stragglers.
- `src/pages/cora-dashboard.js`: `./cora-action-centre.js` → `../components/collections/cora-action-centre.js`; `./cora-controls-dashboard.js` → `../components/collections/cora-controls-dashboard.js`. Its `./cora-responsible-party-dashboard.js` import **stays** — that file remains a page (routed by my-cases); add a one-line comment marking this cross-import as accepted for now (it is the Phase 5 allowlist entry).
- `tests/cora-action-centre.test.js` and `tests/cora-controls-dashboard.test.js`: update the module paths to `../src/components/collections/...`.

TDD shape for a pure move: flip each test's import path first (RED: module not found), then `git mv` + fix paths (GREEN), refactor nothing. The moved files gain no behaviour change; existing tests are the safety net. Note: `tests/component-layering-contract.test.js` scans `src/components/**` — the moved files import no question-bank code, so it stays green (verify). Full suite + `npm run check`. Commit: `Move action-centre + controls-dashboard to components/collections (#384 phase 4)`.

### Phase 5 — Enforcement contract + question-bank cleanup + docs

**(i) Fix the two question-bank holes first (they'd violate the new rules):** in `src/routes/question-bank.js`,

- drop the static `question-bank-flags.js` import; make `mount` async: `context.appEl.classList.add('cora-fullbleed');` then resolve loaders as today, then `await loadEditor(); const el = document.createElement('cora-bank-editor'); container.replaceChildren(el); const { simulatorEnabled } = await import('../pages/question-bank/question-bank-flags.js'); if (simulatorEnabled()) loadSamples();` — awaiting instead of `.then(...)` also routes editor-load failures into the Phase 1 boundary (fixes §4.2 and §4.3 in one move). RED first: add a test to `tests/routes-question-bank.test.js` that a rejecting `loadQuestionBankEditor` yields `cora-route-error` via `await router.navigate('#/question-bank')`; then adjust the existing `tick()`-based tests (awaiting the navigate makes most `tick()`s redundant — keep tests one-change-at-a-time). The default samples-loader test already waits on a deadline; keep it.

**(ii) Extend `tests/component-layering-contract.test.js`** (same file, new tests; reuse `jsFilesUnder`) — scan **all of `src/`**, stripping comment lines (`^\s*(\*|//)`) before matching so JSDoc `import('../pages/...')` _type_ references don't trip the rules:

- Rule (a) — _no static page imports outside pages_: for every `src/**/*.js` NOT under `src/pages/`, assert no `from '...pages/...'` (regex `from\s+['"][^'"]*\bpages\//`). Explicit allowlist with reasons: `src/testing/in-memory-flow-runner.js` (dev flow harness, §4.5). Companion rule: dynamic `import(` of a `pages/` path (non-comment lines) is allowed **only** in `src/routes/*`.
- Rule (b) — _routes are register-routes' private detail_: for every `src/**/*.js` except `src/setup/register-routes.js` and files under `src/routes/` themselves, assert no `from '...routes/...'` and no dynamic `import(` of a routes path (`tests/*` are outside the scan by construction).
- Also assert the cross-**page** static-import allowlist: under `src/pages/`, the only static import of another top-level page module is `cora-dashboard.js` → `cora-responsible-party-dashboard.js` (documented leftover; `src/pages/cora-case-review/*` and `src/pages/question-bank/*` intra-subsystem imports are fine — scope the rule to imports of `src/pages/<file>.js` top-level modules).

TDD: write each rule's test, watch it fail on the real offender (or on a temporary seeded offender if the tree is already clean), fix/allowlist, refactor.

**(iii) Docs — CLAUDE.md:** in "Architecture in one screen", the "Views like `#/dashboard`, `#/case/{id}` swap via dynamic `import()`" claim is now precisely true — state that every route lazy-loads its page inside `mount()` and that the router renders a `cora-route-error` panel (nav stays usable) when a page module fails to load. Add the removal recipe: _deleting a page = delete the page file + its `src/routes/_`file + its`safeRegister`line in`setup/register-routes.js`+ its nav link* — nothing else breaks. Refresh the stale comment at`tests/register-routes.test.js:13–15` (routes no longer statically import pages; stubs remain for mount-time dynamic imports).

**(iv) DoD verification (manual, then revert):** `mv src/pages/cora-reports-index.js /tmp/ && node --test tests/router.test.js tests/register-routes.test.js` (must stay green — proving boot/registration survives a deleted page; `tests/routes-reports.test.js` and `tests/cora-reports-index.test.js` will fail while the file is absent — expected, do not commit in this state) then `mv` it back and re-run the full suite. The browser-level DoD (nav renders, `#/reports` shows the panel with `?mock=1`) is a human check on SharePoint/local — flag it in the final report, don't attempt it.

Full suite + `npm run check`. Commit: `Enforce page/route layering, question-bank lazy flags, docs sync (#384 phase 5)`.

## 8. Risks / gotchas for all agents

- **Async-until-first-await is load-bearing** (Phase 1): unmount + mount-call must stay synchronous inside `navigate()` or dozens of existing sync tests break.
- **`finally { globalThis.document = orig }` blocks in route tests** restore stubs before an un-awaited async mount finishes — every navigate in a converted route's tests must be awaited _inside_ the `try`.
- **Dynamic imports are cached per process**: the first awaited navigate in a test file pays real module-eval (page modules `customElements.define` at eval — the `installDom()` / stub `customElements` setups already handle this; `tests/routes-root.test.js` and `tests/routes-reports.test.js` use ad-hoc document stubs instead of `_dom-stub.js`; if page eval needs more than they provide, switch the file to `installDom()` like the other route tests rather than growing the ad-hoc stub).
- **Don't reintroduce a central component registry** — `tests/framework-contract.test.js` forbids it; lazy page imports triggering `customElements.define` side effects is the intended mechanism.
- **No `innerHTML`** in the error panels (Hard rule).
- **`npm run check` (tsc)** will police the injectable-loader typedefs and every moved-file import path; run it before each commit, not just at the end.
- Node here is v18.10.0 — ignore the two baseline failures (§2); never "fix" them in these commits.
