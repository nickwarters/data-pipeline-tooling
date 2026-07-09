# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Before doing any non-trivial work in this repo, read:

1. **[CONTEXT.md](./CONTEXT.md)** — domain language. Use these terms exactly when discussing or coding (`Case Type`, `Question Definition`, `Applicable Question`, `Answer`, `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`, `Conversation`, `Outcome`).
2. **[docs/PLAN.md](./docs/PLAN.md)** — the slice-based execution roadmap. Slice 1 ("Example Case") is the immediate next work; subsequent slices are sketched.
3. **[docs/adr/](./docs/adr/)** — 10 architecture decisions, numbered. Every non-trivial decision in the codebase traces back to one of these. Don't deviate from an ADR without surfacing the deviation explicitly.

## Project overview

Vanilla JavaScript, HTML, and CSS framework for a Case Review Platform frontend hosted on **SharePoint Subscription Edition**. **Edge Chromium only** as the browser baseline; no IE11. There is no runtime build toolchain — no bundlers, no transpilers, no third-party runtime dependencies. Modern browsers load the source `.js` natively.

## Architecture in one screen

- **SPA shell, hash routing**. One `.aspx` host page, one Content Editor, one `app.js`. Views like `#/dashboard`, `#/case/{id}` swap via dynamic `import()`.
- **Web Components in light DOM + home-grown signal primitive**. Custom elements (`<cora-*>`) are the unit of UI; `signal()`/`computed()`/`effect()` (~50 LOC) drive fine-grained reactivity. Light DOM (not Shadow DOM) for form ergonomics; `cora-` CSS prefix for SharePoint isolation.
- **Case Type config as JS modules**. One module per Case Type under `case-types/{slug}.js`, lazy-loaded. **Question Definitions in a shared SharePoint list** (live-edit propagates to in-progress cases).
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
    signal.js                   # home-grown signal/computed/effect (~50 LOC)
    router.js                   # hash-based SPA router

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

  pages/                        # top-level view components (one per route)
    cora-case-review.js
    cora-conversation-view.js
    cora-dashboard.js
    cora-responsible-party-dashboard.js

  question-bank/                # question bank editor subsystem
    cora-bank-dock.js
    cora-bank-dom.js
    cora-bank-editor.js
    cora-bank-list.js
    cora-bank-rail.js
    cora-question-bank-editor.css
    question-bank-compile.js
    question-bank-store.js
    question-bank-tree.js

  routes/                       # route handler modules (one per hash route)
    root.js
    dashboard.js
    conversation.js
    question-bank.js
    case.js

  services/                     # non-UI modules: data, state, auth
    create-sharepoint-client.js
    http-sharepoint-client.js
    mock-sharepoint-client.js
    permissions.js
    save-queue.js
    section-access.js

  evaluators/                   # pure logic: applicability and failure
    applicability-evaluator.js
    failure-evaluator.js

  setup/                        # app startup helpers
    register-components.js
    register-routes.js
    resolve-eligible-case-types.js

  styles/
    cora-styles.css

case-types/                     # one module per Case Type (lazy-loaded by cora-case-review)
  example-review.js

dev/
  fixtures/                     # mock data used by MockSharePointClient (?mock=1)

tests/                          # node:test unit tests — flat, one file per subject by filename
                                # (e.g. cora-toast.test.js imports components/base/cora-toast.js)
```
