# 42. The route table imports its pages statically, except the Question Bank editor

Date: 2026-07-30

## Status

Accepted — amends
[ADR-0002](./0002-spa-shell-with-hash-routing.md), whose per-view code-splitting
claim now holds for one route rather than all of them, and
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md), which
reaffirmed that claim as "deliberately preserved, unchanged". Route-level page
independence _at runtime_ survives both amendments intact; the lazy `import()`
that used to implement it does not.

## Context

Every route in `setup/register-routes.js` held its page behind a thunk:
`load: () => import('../pages/home.js')`. The thunk bought two different things,
and only one of them still needs buying.

It bought **containment of a load-time failure**. A page file that was missing,
unparseable, or reached for a specifier that did not resolve failed inside the
router's async `navigate()`, which logged it and rendered a `cora-route-error`
panel into the route container. The nav lives outside that container, so one
broken page cost exactly one route and boot was untouched. That containment was
worth real money when nothing else in the toolchain looked at a page module
before a browser did.

Something else does now. `npm run verify` parses every `.js` under `src/` and
`case-types/` with Node's own parser, resolves every specifier and asset
reference case-sensitively across the whole deployed file set, rejects bare
package specifiers the browser cannot resolve, and then evaluates the
configuration in Node. `scripts/deploy_to_sharepoint.py` runs that gate as a
pre-flight and aborts on failure, orders its uploads leaf-first from the graph
the gate writes, and re-fetches every deployed file afterwards to compare
hashes. And a boot that fails at all now renders the visible `cora-boot-error`
panel rather than dying in the console. A missing, unparseable or
wrongly-specified page module is caught three times before a Reviewer sees it.

Against that, the thunk costs a serial round trip on the first navigation to
every route — the user waits for a fetch the app could have started at boot —
and a contract test to police the rule. This is the same trade already settled
for the rest of boot: a deferral that contains nothing is a deferral that only
makes startup serial.

## Decision

**The route table imports its page modules statically, and holds each one
directly on its entry as `page`.** Every route but one:

```js
import * as homePage from '../pages/home.js';
// …
root: { paths: ['#/'], page: homePage },
```

The table keeps its shape — one list, one entry per route, one place that
answers "what pages exist?". `guard()` and the permission-driven initialisation
around it are untouched.

**`#/question-bank` keeps its `load` thunk.** Three reasons, and it needs all
three to be worth the exception: it is by a wide margin the largest subsystem in
the app; only a Maintainer ever opens it, so most sessions never pay for it at
all; and the thunk is the seam `AppContext.loadQuestionBankEditor` swaps, which
a static import cannot offer. The exception is documented where it lives — in
the table entry, and asserted by name in
`tests/component-layering-contract.test.js`.

**`createStoreRoute` accepts `page` or `load`, exactly one, and throws a
`TypeError` on neither or both.** Everything it does after getting hold of the
module is unchanged: the navigation sequence token, the mount-lifetime
`AbortController` behind `tools.isActive()` and `tools.signal`, `listen()`
cleanup, the `mounted` latch, and the post-mount render `try/catch` that renders
`cora-route-error` into the route's own container. **Runtime containment is
therefore exactly what it was**: a page that throws while its slice is created,
or on any render after mount, still costs only its own route.

## Alternatives considered

**Keep everything lazy.** Rejected. It charges every user a round trip per route
they visit, in exchange for containing a class of failure the verify gate now
catches before the bytes are uploaded — and for which a page-shaped failure at
_evaluation_ time was never fully contained anyway, since the panel it produced
told the Reviewer nothing they could act on.

**Make `#/question-bank` static too, for uniformity.** Rejected. Uniformity is
not free here: it would put the largest module in the app into every Reviewer's
boot for a page they will never open, and it would delete the swap seam the dev
harness uses. One documented exception, asserted by a test, is cheaper than
either.

**`<link rel="modulepreload">` for the page modules.** Rejected. It would warm
the cache without removing the thunk, so the indirection, the contract test and
the ambiguity all stay while a hand-maintained host page acquires nine more
lines that must be kept in step with the route table by eye.

## Consequences

- **A page that throws while its module is evaluated is now fatal to boot.**
  This is the real cost and it is not small. The user gets a blank app, not a
  route-error panel, because `boot().catch(renderBootError)` covers boot's body
  and not boot's module graph — a limit CLAUDE.md already records, and one that
  would need a fallback element in the host page to close. Only load,
  `createRouteSlice` and render failures stay contained per route.
- Mitigating that: the verify gate parses **and now evaluates** every page
  module in Node, because building the route table imports all of them. A page
  reaching for `window` or `document` at module scope is a gate failure with the
  route named, not a blank app. `checkConfiguration()` reaches the table through
  its own `import()` inside a `try`/`catch` for exactly this reason — a page that
  will not evaluate must be one more reported failure, not the thing that stops
  the gate reporting the Case Type and artifact findings too. The deploy runs the
  gate pre-flight and aborts on it.
- **Boot's static module graph grows from 27 files to 100.** Nine page entry
  points, but each drags in its transitive components, evaluators, services and
  views — the counts come from the verify gate's own
  `.verify/import-graph.json`, walking static edges from `src/app.js` before and
  after. And they do not arrive flat: with no bundler, the browser can only
  discover an import once it has fetched and parsed the file holding it, so the
  graph loads in waves by depth, six deep where it used to be three. What is
  saved is the serial fetch a first navigation to each route used to pay.
  Whether the trade is faster or slower in the SharePoint SE environment is not
  measured today, by anything, and this ADR claims no win — only that the
  previous shape was not measured either.
- The layering contract inverts: `tests/component-layering-contract.test.js` now
  asserts that only `setup/register-routes.js` names a page module at all, static
  or dynamic, and that its one dynamic page specifier is the Question Bank editor.
- **The page-removal recipe still has three steps** — delete the page file, its
  table entry, its nav link — but the failure mode of forgetting the second one
  inverts. It used to cost one route quietly at runtime; it now fails `tsc`,
  `npm run verify` and boot, loudly, before anything is deployed.
- The guard no longer saves an ineligible user the page-module download, because
  there is no download left to save. It still short-circuits the mount, so no
  slice, store, effect or request runs for them — which was always the part that
  mattered.
