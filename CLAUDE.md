# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Before doing any non-trivial work in this repo, read:

1. **[CONTEXT.md](./CONTEXT.md)** — domain language. Use these terms exactly when discussing or coding (`Case Type`, `Question Definition`, `Applicable Question`, `Answer`, `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`, `Conversation`, `Outcome`).
2. **[docs/PLAN.md](./docs/PLAN.md)** — the slice-based execution roadmap. Slice 1 ("Example Case") is the immediate next work; subsequent slices are sketched.
3. **[docs/adr/](./docs/adr/)** — 10 architecture decisions, numbered. Every non-trivial decision in the codebase traces back to one of these. Don't deviate from an ADR without surfacing the deviation explicitly.

## Project overview

Vanilla JavaScript, HTML, and CSS framework for a Case Review Platform frontend hosted on **SharePoint Subscription Edition** (ADR-0001). **Edge Chromium only** as the browser baseline; no IE11. There is no runtime build toolchain — no bundlers, no transpilers, no third-party runtime dependencies. Modern browsers load the source `.js` natively.

## Architecture in one screen

- **SPA shell, hash routing** (ADR-0002). One `.aspx` host page, one Content Editor, one `app.js`. Views like `#/dashboard`, `#/case/{id}` swap via dynamic `import()`.
- **Web Components in light DOM + home-grown signal primitive** (ADR-0003). Custom elements (`<cr-*>`) are the unit of UI; `signal()`/`computed()`/`effect()` (~50 LOC) drive fine-grained reactivity. Light DOM (not Shadow DOM) for form ergonomics; `cr-` CSS prefix for SharePoint isolation.
- **Case Type config as JS modules** (ADR-0004). One module per Case Type under `case-types/{slug}.js`, lazy-loaded. **Question Definitions in a shared SharePoint list** (live-edit propagates to in-progress cases).
- **JSDoc + `tsc --checkJs` for types** (ADR-0005). No `.ts` files; the deployed JS is the source JS. CI runs `tsc --noEmit --checkJs --allowJs`.
- **Per-Case-Type `showWhen` graph + `outcome` function** (ADR-0006). Applicability is data (declarative `showWhen`); outcome is code (exported function). Same module, one place to look.
- **Case storage: everything on the Case row** (ADR-0007). `Answers` and `Conversation` as JSON blobs on a per-Case-Type SharePoint list row. Notes as plain text. Field-level PATCH only.
- **Auto-save: 1500ms debounce + ETag concurrency** (ADR-0008). Single `SaveQueue` primitive; components never call `fetch` directly.
- **Mock-first dev loop** (ADR-0009). All REST goes through a `SharePointClient` interface. `?mock=1` URL param swaps in `MockSharePointClient` from `dev/fixtures/`. `node --test` for unit tests.
- **Auth: browser NTLM/Kerberos; security via SharePoint list permissions** (ADR-0010). Client-side group checks are UX-only; the real boundary is SharePoint's list ACLs.

## Hard rules

- **No third-party runtime dependencies, ever.** Dev/CI tools (tsc, prettier, node test runner) are fine.
- **No build step at runtime.** Source JS is deployed JS.
- **Components never call `fetch()` directly** — always through the `SharePointClient` interface. This is what makes mock-first dev work.
- **No `innerHTML` for user data.** XSS prevention; also preserves input state.
- **Custom elements use the `cr-` prefix** (also the CSS namespace).
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

  components/                   # reusable cr-* custom elements
    cr-element.js               # base class
    cr-allocation.js
    cr-case-tabs.js
    cr-compile-drawer.js
    cr-conversation.js
    cr-data-table.js
    cr-case-table.js
    cr-notes.js
    cr-options-editor.js
    cr-outcome.js
    cr-owner-summary.js
    cr-question.js
    cr-question-list.js
    cr-question-card.js
    cr-remediation-editor.js
    cr-remediation-section.js
    cr-showwhen-editor.js
    cr-showwhen-group.js
    cr-showwhen-leaf.js
    cr-status-banner.js
    cr-toast.js
    cr-wording-editor.js

  pages/                        # top-level view components (one per route)
    cr-case-review.js
    cr-conversation-view.js
    cr-dashboard.js
    cr-responsible-party-dashboard.js

  question-bank/                # question bank editor subsystem
    cr-bank-dock.js
    cr-bank-dom.js
    cr-bank-editor.js
    cr-bank-list.js
    cr-bank-rail.js
    cr-question-bank-editor.css
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
    cr-styles.css

case-types/                     # one module per Case Type (lazy-loaded by cr-case-review)
  example-review.js

dev/
  fixtures/                     # mock data used by MockSharePointClient (?mock=1)

tests/                          # node:test unit tests (mirror src/ file names)
```
