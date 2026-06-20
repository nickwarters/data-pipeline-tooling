# Mock-first dev loop, `node --test` for unit tests

All SharePoint REST access is funneled through a single `SharePointClient` interface (a JSDoc typedef). Two implementations:

- **`HttpSharePointClient`** — real REST, used in production.
- **`MockSharePointClient`** — in-memory store seeded from JSON fixtures under `dev/fixtures/`, used for local development and tests.

Selection is at boot via URL param: `?mock=1` triggers a dynamic `import()` of the mock client and seeds it; absent the param, the real client loads. The mock client is **not** in the production critical path (gated dynamic import). The `?mock=1` flag is a dev affordance only — not a security boundary; the mock client never touches real data.

Local dev: serve the repo with any static HTTP server (`python3 -m http.server` is the suggested default — no Node required to _run_ the framework). Open `dev/index.html?mock=1`. Persona switching for permission testing via `?asUser=reviewer | owner | admin`.

**Tooling stack** (Node-based, dev-time only — does not affect runtime):

- `tsc --noEmit --checkJs --allowJs` for type checking (CI gate).
- `prettier` for formatting.
- `node --test` for unit tests of pure-JS primitives (signals, applicability evaluator, outcome helpers, save queue, mock client). **No DOM testing layer in v1** — manual browser testing covers component-level behaviour until a regression justifies adding `happy-dom`.

The hard rule that makes this all work: **components never call `fetch()` directly**. Every REST interaction goes through the `SharePointClient` interface, full stop.
