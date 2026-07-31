# ADR-0029: CORA branding and the `cr-` → `cora-` prefix rename

## Status

Accepted

The `cora-` naming and CSS-isolation boundary remain current under
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md).

Two of the renamed surfaces below no longer exist to carry the prefix: there are
no `cora-*` custom element tags and no `cora-*` custom events, retired by
ADR-0034 and closed off entirely by its **Amendment (2026-07, #536)**. The
prefix itself is unaffected — it lives on class names, custom properties, the
`[data-cora-root]` scoping hook, and filenames — and the reworded CLAUDE.md hard
rule now says so.

## Context

The platform is now named **CORA**. Since ADR-0003, every custom element tag,
CSS class, CSS custom property, `data-*` scoping attribute, internal custom
event, and the backing JS class names carried a `cr-` (or `CR`) prefix. That
prefix existed for one reason: CSS isolation from SharePoint chrome
needs a single unique namespace so the framework's styles cannot leak into — or
be clobbered by — the surrounding SharePoint page. Nothing about the isolation
mechanism depends on the specific letters `cr`; any consistent, unique prefix
satisfies it.

With the CORA name settled, the `cr-` prefix is off-brand. The deploy target was
already `Style Library/CODE/CORA` and `host/index.html` already used a
`{{CORA_BASE}}` token, so the branding was half-applied.

## Decision

Rename the prefix everywhere it appears in the codebase, `cr-` → `cora-` and
`CR*` → `CORA*`:

- **Custom element tag names** — `cr-question` → `cora-question`, including every
  `customElements.define(...)` / `defineView(...)` call and every tag referenced
  in markup or template strings.
- **JS class names** — `CRQuestion` → `CORAQuestion`. The all-caps `CORA`
  initialism mirrors the previous all-caps `CR`, keeping the substitution
  mechanical and unambiguous.
- **Filenames** — `cr-*.js` / `cr-*.css` → `cora-*.js` / `cora-*.css` across
  `src/components/`, `src/pages/`, `src/question-bank/`, `src/styles/`, and the
  mirrored `tests/` files, plus the `src/pages/cr-case-review/` directory.
- **CSS** — every `.cr-*` selector, every `--cr-*` custom property, and the
  `[data-cr-root]` / `data-cr-theme` scoping hooks.
- **Custom events** — internal event names such as `cr-tab-change`,
  `cr-attribute-change`, `cr-case-open` (dispatch and listener sides move
  together).
- **Docs / prose / UI copy** — README, CONTEXT, ADRs, and the nav brand.

This is a pure branding substitution with no behavioural change. It is landed as
its own PR, separate from the component directory-layering work, so
neither diff simultaneously renames and moves 100+ files.

### Explicitly not renamed

- **`CR-Maintainers`** (`src/services/permissions.js`) is a **SharePoint
  security group name**, not a framework token. Per ADR-0010 the real
  authorization boundary is SharePoint's group/ACL configuration; renaming this
  string would rebind the app to a differently-named group that does not exist
  in the SharePoint environment. Changing it is an operations decision (rename
  the SharePoint group _and_ the code together), out of scope for a branding
  sweep.
- The GitHub repository name `case-review-frontend-framework` and any external
  URLs/identifiers outside this codebase.
- The `Cr` inside unrelated English words.

## Consequences

- ADR-0003 is amended to describe the prefix as `cora-`, with a pointer here for
  the history.
- The CLAUDE.md hard rule ("Custom elements use the `cora-` prefix") and the
  documented directory tree use `cora-*`.
- Behaviour, public API, and test coverage are unchanged — the test suite moves
  with its subjects and asserts the same behaviour under the new names.
