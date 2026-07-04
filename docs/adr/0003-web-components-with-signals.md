# Web Components (light DOM) + home-grown signals

The framework's UI primitives are **custom elements rendered into light DOM**, with a small home-grown reactivity layer (`signal`, `computed`, `effect`) built into the framework itself. No third-party libraries — vanilla is a hard rule from the README.

Custom elements were chosen for their built-in lifecycle hooks (`connectedCallback` / `disconnectedCallback`), which map cleanly onto SPA mount/unmount and let signal subscriptions auto-clean up. **Light DOM** was chosen over Shadow DOM because the app is forms-heavy (the question engine is mostly inputs, validation, and a possible parent `<form>`); Shadow DOM makes form participation, native validation, and autofill awkward. CSS isolation from SharePoint is achieved instead with a strict `cora-` prefix on every class plus a scoped reset.

Fine-grained reactivity (rather than rebuilding sections on every state change) is required by the question engine: 500 questions with conditional show/hide must re-render only the affected nodes, or input focus, scroll, and perceived performance break down. The signal primitive solves this at standards-level cost (~50 LOC).

## Amendment (2026-07)

The isolation prefix described above was originally `cr-`. It was renamed to `cora-` when the platform was branded **CORA**. The mechanism is unchanged — any single, unique prefix satisfies the SharePoint CSS-isolation requirement; nothing tied it specifically to `cr-`. See [ADR-0029](0029-cora-branding-and-cr-prefix-rename.md).
