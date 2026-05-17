# Plan: Fix Question Bank Editor layout regression at `#/question-bank`

## Symptoms
- Page is squashed in from the sides (a narrow column with empty gutters left/right).
- Nested elements visually pop out of their parent containers.
- Standalone `docs/question-bank-editor.html` looked correct before commit `20bedb2` extracted it to `#/question-bank`.

## Root cause

The editor is now mounted inside `#app`, which has `data-cr-root` set (set both in `dev/index.html:23` and forced on by `src/app.js:56`). That attribute triggers the global framework shell in `src/cr-styles.css:72-76`:

```css
[data-cr-root] {
  max-width: var(--cr-content-max-width);  /* 64rem */
  margin: 0 auto;
  padding: var(--cr-space-5) var(--cr-space-4);
}
```

The bank editor was designed as a full-viewport page (`min-height: 100vh`, masthead/case-bar with `padding: ... 56px`, `.bank-main` grid `280px 1fr`, fixed-position dock spanning `left:0 right:0`). Wrapping it in a 64rem centered, padded container produces exactly the symptoms reported:

- Outer `max-width: 64rem` + horizontal `padding` → "squashed in from the sides".
- Fixed-position `.dock` ignores the parent constraint and spans the viewport → visually escapes its container.
- `.bank-main`'s `280px 1fr` grid inside a narrow container forces content overflow → nested elements appear to pop out.

Secondary suspect: the global rule `[data-cr-root] button { ... }` (`cr-styles.css:97-105`) restyles any `<button>` inside the editor that doesn't carry one of the bank-editor's class selectors. Worth a sweep but probably not the squashing cause.

## Approach (recommended)

Make the `#/question-bank` route opt out of the framework shell rather than fight it from inside.

### Step 1 — let `cr-bank-editor` escape the shell

In `src/app.js`, the `#/question-bank` route's `mount` should add a marker class (e.g. `cr-fullbleed`) to the `#app` element; `unmount` removes it. This keeps the `data-cr-root` scope intact (so tokens and resets still apply) but disables the centered/max-width/padding shell.

### Step 2 — add the fullbleed escape hatch to `src/cr-styles.css`

Add a single rule that neutralises the layout shell when `cr-fullbleed` is present:

```css
[data-cr-root].cr-fullbleed {
  max-width: none;
  margin: 0;
  padding: 0;
}
```

Alternatively, use `[data-cr-root]:has(cr-bank-editor)` — works in Edge Chromium per ADR-0001's browser baseline — and avoid touching `app.js`. Pick this if you prefer a pure-CSS fix; it's the smaller change.

### Step 3 — audit `<button>` usage inside the editor's components

Search `src/cr-bank-*.js`, `src/cr-question-card.js`, `src/cr-wording-editor.js`, `src/cr-options-editor.js`, `src/cr-showwhen-*.js`, `src/cr-remediation-editor.js`, `src/cr-compile-drawer.js`, `src/cr-case-tabs.js`, `src/cr-toast.js` for `el('button', ...)` calls that don't carry a class with explicit `background`/`color` (e.g. `.pill-btn`, `.icon-btn`, `.mini-btn`, `.case-tab`, `.drawer-close`, `.dock-btn`, `.tag-add`, `.add-card`). Any bare `<button>` will pick up the blue framework button styling and look wrong. Either give it a class or add a `cr-bank-editor button { all: revert; }`-style reset at the top of `cr-question-bank-editor.css` *before* the component rules.

### Step 4 — verify visually

1. Run a static server (`npx serve .`) and load `http://localhost:3000/dev/?mock=1#/question-bank`.
2. Confirm masthead spans full viewport, `.bank-main` shows 280px rail + flexible editor column, dock sits flush against the viewport bottom edge, and `cr-showwhen-group` nesting stays inside its parent card.
3. Switch to `#/dashboard` and `#/case/:id` and confirm those routes still center within 64rem (the shell escape only applies to the bank route).

### Step 5 — tests

No existing test exercises the route mount/unmount class toggling, so add a small test in `tests/` that asserts the `cr-fullbleed` class is added when `#/question-bank` is the active route and removed when navigating away. If Step 2's `:has()` variant is chosen instead, this test is unnecessary.

## Files likely to change

- `src/app.js` — route mount/unmount toggles `cr-fullbleed` on `#app` (skip if using `:has()`).
- `src/cr-styles.css` — add `.cr-fullbleed` (or `:has(cr-bank-editor)`) escape rule.
- `src/cr-question-bank-editor.css` — optional defensive `cr-bank-editor button { ... }` reset at top.
- Possibly individual component files in `src/cr-bank-*.js` if any bare buttons need class names.
- New test under `tests/` (only if going the JS-toggled-class route).

## Out of scope

- Don't redesign the editor's layout — restore the pre-extraction visual, nothing more.
- Don't change ADR-0001/0003 scoping rules.
