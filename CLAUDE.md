# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Before doing any non-trivial work in this repo, read:

1. **[CONTEXT.md](./CONTEXT.md)** — domain language. Use these terms exactly when discussing or coding (`Case Type`, `Question Definition`, `Applicable Question`, `Answer`, `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`, `Conversation`, `Outcome`).
2. **[docs/PLAN.md](./docs/PLAN.md)** — the slice-based execution roadmap. Slice 1 ("Example Case") is long done; the framework is deep into later slices. Current work is **Slice 11 — User groups & remediation workflow** (two-axis roles, case lifecycle, remediation loop, Amend Outcome, Appeals — see [`docs/user-groups-workflow-grilling-session-plan.md`](./docs/user-groups-workflow-grilling-session-plan.md)). Read the slice list to see what's shipped vs. sketched before assuming a feature doesn't exist yet.
3. **[docs/adr/](./docs/adr/)** — 31 architecture decisions, numbered (`0001`–`0031`). Every non-trivial decision in the codebase traces back to one of these. Don't deviate from an ADR without surfacing the deviation explicitly.

## Project overview

Vanilla JavaScript, HTML, and CSS framework for a Case Review Platform frontend hosted on **SharePoint Subscription Edition**. **Edge Chromium only** as the browser baseline; no IE11. There is no runtime build toolchain — no bundlers, no transpilers, no third-party runtime dependencies. Modern browsers load the source `.js` natively.

## Architecture in one screen

- **SPA shell, hash routing**. One `.aspx` host page, one Content Editor, one `app.js`. Views like `#/dashboard`, `#/case/{id}` swap via dynamic `import()`.
- **Web Components in light DOM + home-grown signal primitive**. Custom elements (`<cora-*>`) are the unit of UI; `signal()`/`computed()`/`effect()` (~50 LOC) drive fine-grained reactivity. Light DOM (not Shadow DOM) for form ergonomics; `cora-` CSS prefix for SharePoint isolation. Components register themselves via a top-level `customElements.define(...)` call as a module side effect — there is no central registry module. A component only becomes available once something side-effect-imports it (typically the page/section that mounts it). `tests/framework-contract.test.js` asserts a global registry (`registerComponents`/`register-components`) never comes back — don't reintroduce one.
- **Case Type config as JS modules; Question Bank content as bundled artifacts (current) — SharePoint list is the planned target.** One module per Case Type under `case-types/{slug}.js`, lazy-loaded via `case-types/manifest.js`. Today, Question Bank content (the catalogue of Question Definitions, labels, and Outcome vocabulary) ships as bundled `case-types/banks/{slug}.txt` artifacts loaded through `case-types/load-bank.js`, not as a live SharePoint list — see ADR-0021's 2026-07-09 amendment. The original "Question Definitions in a shared SharePoint list, live-edit propagates to in-progress Cases" design is still the direction of travel: `HttpSharePointClient`/`MockSharePointClient` already expose `getExportHash`/`getVersionedExport` (ADR-0021) for versioned, point-in-time bank snapshots on Completed/reportable Cases, which is the SharePoint-list-shaped seam this will grow into.
- **JSDoc + `tsc --checkJs` for types**. No `.ts` files; the deployed JS is the source JS. CI runs `tsc --noEmit --checkJs --allowJs`.
- **Per-Case-Type `showWhen` graph + `outcome` function**. Applicability is data (declarative `showWhen`); outcome is code (exported function). Same module, one place to look.
- **Case storage: everything on the Case row**. `Answers` and `Conversation` as JSON blobs on a per-Case-Type SharePoint list row. Notes as plain text. Field-level PATCH only.
- **Auto-save: 1500ms debounce + ETag concurrency**. Single `SaveQueue` primitive; components never call `fetch` directly.
- **Mock-first dev loop**. All REST goes through a `SharePointClient` interface. `?mock=1` URL param swaps in `MockSharePointClient` from `dev/fixtures/`. `node --test` for unit tests.
- **Auth: browser NTLM/Kerberos; security via SharePoint list permissions**. Client-side group checks are UX-only; the real boundary is SharePoint's list ACLs.

## Hard rules

- **No third-party runtime dependencies, ever.** Dev/CI tools (tsc, prettier, node test runner) are fine.
- **No build step at runtime.** Source JS is deployed JS.
- **Components never call `fetch()` directly** — always through the `SharePointClient` interface. This is what makes mock-first dev work.
- **No `innerHTML` for user data.** XSS prevention; also preserves input state.
- **Custom elements use the `cora-` prefix** (also the CSS namespace).
- **Question Definitions are never deleted** — use a `deprecated` flag (avoids dangling references from Case Type modules).

## Gotchas

- **Question Bank artifacts are JSON stored in `.txt` files, on purpose.** `case-types/banks/*.txt` (loaded via `case-types/load-bank.js`) hold plain JSON text. This is intentional, not an oversight: SharePoint Subscription Edition has been unreliable at storing/serving `.json` files (MIME/blocking issues), so the artifact extension is `.txt` while the content stays JSON, parsed explicitly by the loader. A repo-wide search for `*.json` will not find the banks — search `case-types/banks/*.txt` instead.

## Test discipline: Red-Green-Refactor, 100% coverage

**Every line of production code must be covered by a test.** No exceptions.

Workflow for all new code:

1. **Red** — write a failing test for the behaviour you are about to add.
2. **Green** — write the minimum production code to make it pass.
3. **Refactor** — clean up, keeping tests green.

Never merge production code without a corresponding test. Run `node --test --experimental-test-coverage` to verify coverage before committing. A branch, line, or function that appears in the coverage report as uncovered is a bug in the development process, not just the code.

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
    router.js                   # hash-based SPA router
    signal.js                   # home-grown signal/computed/effect (~50 LOC)
    view.js

  components/                   # reusable cora-* custom elements, layered by dependency
    base/                       # leaf primitives — compose no other component (cf. lib/signal.js)
      cora-data-table.js
      cora-options-editor.js
      cora-people-picker.js
      cora-question-labels.js
      cora-section-progress.js
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
      cora-remediation-editor.js
      cora-remediation-section.js
      cora-remediation-tracking.js
      cora-showwhen-editor.js
      cora-showwhen-group.js
      cora-summary.js
      cora-wording-editor.js
    collections/                # page/tab-level assemblies mounted directly by pages
      cora-appeal-review.js
      cora-case-table.js
      cora-case-tabs.js
      cora-compile-drawer.js
      cora-question-list.js

  config/
    working-days.js

  pages/                        # top-level view components, mostly one per route
    cora-action-centre.js
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
    cora-controls-dashboard.js
    cora-conversation-view.js
    cora-dashboard.js
    cora-home.js
    cora-journey-cases.js
    cora-reports-index.js
    cora-responsible-party-dashboard.js
    cora-reviewer-team-report.js
    cora-team-cases.js

  question-bank/                # question bank editor subsystem
    cora-bank-dock.js
    cora-bank-editor.js
    cora-bank-list.js
    cora-bank-rail.js
    cora-outcome-options-editor.js
    cora-question-bank-editor.css
    question-bank-compile.js
    question-bank-order.js
    question-bank-source.js
    question-bank-store.js
    question-bank-tree.js

  routes/                       # route handler modules, one per hash route
    case.js
    conversation.js
    dashboard.js
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
    section-progress.js
    summary-model.js
    time-windows.js

  setup/                        # app startup helpers
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
  example-review.js
  product-sale-review.js
  stress-review.js
  complaints.js
  banks/                        # Question Bank content, JSON text stored as .txt (see Gotchas)
    example-review.txt
    product-sale-review.txt
    stress-review.txt
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
