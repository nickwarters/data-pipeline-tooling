# Plan: Fix Question Bank Editor layout regression at `#/question-bank`

## Symptoms

- Page is squashed in from the sides (a narrow column with empty gutters left/right).
- Nested elements visually pop out of their parent containers.
- Standalone `docs/question-bank-editor.html` looked correct before commit `20bedb2` extracted it to `#/question-bank`.

## Root cause

The editor is now mounted inside `#app`, which has `data-cora-root` set (set both in `dev/index.html:23` and forced on by `src/app.js:56`). That attribute triggers the global framework shell in `src/cora-styles.css:72-76`:

```css
[data-cora-root] {
  max-width: var(--cora-content-max-width); /* 64rem */
  margin: 0 auto;
  padding: var(--cora-space-5) var(--cora-space-4);
}
```

The bank editor was designed as a full-viewport page (`min-height: 100vh`, masthead/case-bar with `padding:... 56px`, `.bank-main` grid `280px 1fr`, fixed-position dock spanning `left:0 right:0`). Wrapping it in a 64rem centered, padded container produces exactly the symptoms reported:

- Outer `max-width: 64rem` + horizontal `padding` → "squashed in from the sides".
- Fixed-position `.dock` ignores the parent constraint and spans the viewport → visually escapes its container.
- `.bank-main`'s `280px 1fr` grid inside a narrow container forces content overflow → nested elements appear to pop out.

Secondary suspect: the global rule `[data-cora-root] button {... }` (`cora-styles.css:97-105`) restyles any `<button>` inside the editor that doesn't carry one of the bank-editor's class selectors. Worth a sweep but probably not the squashing cause.

## Approach (recommended)

Make the `#/question-bank` route opt out of the framework shell rather than fight it from inside.

### Step 1 — let `cora-bank-editor` escape the shell

In `src/app.js`, the `#/question-bank` route's `mount` should add a marker class (e.g. `cora-fullbleed`) to the `#app` element; `unmount` removes it. This keeps the `data-cora-root` scope intact (so tokens and resets still apply) but disables the centered/max-width/padding shell.

### Step 2 — add the fullbleed escape hatch to `src/cora-styles.css`

Add a single rule that neutralises the layout shell when `cora-fullbleed` is present:

```css
[data-cora-root].cora-fullbleed {
  max-width: none;
  margin: 0;
  padding: 0;
}
```

Alternatively, use `[data-cora-root]:has(cora-bank-editor)` — works in Edge Chromium per the architecture decision's browser baseline — and avoid touching `app.js`. Pick this if you prefer a pure-CSS fix; it's the smaller change.

### Step 3 — audit `<button>` usage inside the editor's components

Search `src/cora-bank-*.js`, `src/cora-question-card.js`, `src/cora-wording-editor.js`, `src/cora-options-editor.js`, `src/cora-showwhen-*.js`, `src/cora-remediation-editor.js`, `src/cora-compile-drawer.js`, `src/cora-case-tabs.js`, `src/cora-toast.js` for `el('button',...)` calls that don't carry a class with explicit `background`/`color` (e.g. `.pill-btn`, `.icon-btn`, `.mini-btn`, `.case-tab`, `.drawer-close`, `.dock-btn`, `.tag-add`, `.add-card`). Any bare `<button>` will pick up the blue framework button styling and look wrong. Either give it a class or add a `cora-bank-editor button { all: revert; }`-style reset at the top of `cora-question-bank-editor.css` _before_ the component rules.

### Step 4 — verify visually

1. Run a static server (`npx serve.`) and load `http://localhost:3000/dev/?mock=1#/question-bank`.
2. Confirm masthead spans full viewport, `.bank-main` shows 280px rail + flexible editor column, dock sits flush against the viewport bottom edge, and `cora-showwhen-group` nesting stays inside its parent card.
3. Switch to `#/dashboard` and `#/case/:id` and confirm those routes still center within 64rem (the shell escape only applies to the bank route).

### Step 5 — tests

No existing test exercises the route mount/unmount class toggling, so add a small test in `tests/` that asserts the `cora-fullbleed` class is added when `#/question-bank` is the active route and removed when navigating away. If Step 2's `:has()` variant is chosen instead, this test is unnecessary.

## Files likely to change

- `src/app.js` — route mount/unmount toggles `cora-fullbleed` on `#app` (skip if using `:has()`).
- `src/cora-styles.css` — add `.cora-fullbleed` (or `:has(cora-bank-editor)`) escape rule.
- `src/cora-question-bank-editor.css` — optional defensive `cora-bank-editor button {... }` reset at top.
- Possibly individual component files in `src/cora-bank-*.js` if any bare buttons need class names.
- New test under `tests/` (only if going the JS-toggled-class route).

## Out of scope

- Don't redesign the editor's layout — restore the pre-extraction visual, nothing more.
- Don't change the architecture decision/0003 scoping rules.
