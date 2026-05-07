# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Before doing any non-trivial work in this repo, read:

1. **[CONTEXT.md](./CONTEXT.md)** — domain language. Use these terms exactly when discussing or coding (`Case Type`, `Question Definition`, `Applicable Question`, `Answer`, `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`, `Conversation`, `Outcome`).
2. **[docs/PLAN.md](./docs/PLAN.md)** — the slice-based execution roadmap. Slice 1 ("Hello Case") is the immediate next work; subsequent slices are sketched.
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

## Repository state

Pre-implementation. As of this commit there is no source code — only the README, CLAUDE.md, CONTEXT.md, docs/PLAN.md, and the ADRs. The first work is **Slice 1** in PLAN.md.

When implementation begins, document the directory layout that emerges and update this file.
