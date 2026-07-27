# 34. Store-driven pure views replace component-owned state (Project Palimpsest)

Date: 2026-07-18

## Status

Accepted, as amended 2026-07 (#536) — see **Amendment (2026-07, #536)** below,
which closes decision 7's conditional custom-element seam.

Implemented through SUNSET-1 on 2026-07-20. The legacy view shell and scroll-
snapshot helper are deleted, and contract tests now prevent class components,
legacy view APIs, app-layer signal imports, and view-to-client imports from
returning. `lib/signal.js` is deleted: its last app-layer consumers went with
this decision, the Case Review loader was converted to plain fields in #529,
and `SaveQueue` — the only consumer that remained — now notifies status
subscribers from a plain listener set. The contract test forbidding application
surfaces (`actions`, `components`, `pages`, `routes`, `setup`, and `views`)
from importing a signals module is kept as a ratchet against reintroducing
one.

Supersedes [ADR-0003](./0003-web-components-with-signals.md). Deliberately
preserves [ADR-0002](./0002-spa-shell-with-hash-routing.md) (SPA shell + hash
routing, route-level page independence and lazy `import()`) and
[ADR-0009](./0009-mock-first-dev-loop.md) (mock-first dev loop) unchanged. It
changes the rendering mechanism, not the accepted information architecture in
[ADR-0014](./0014-tabbed-case-review-layout.md),
[ADR-0016](./0016-summary-section-replaces-outcome-tab.md), or
[ADR-0024](./0024-remediation-tracking-tab.md), the `cora-` isolation decision
in [ADR-0029](./0029-cora-branding-and-cr-prefix-rename.md), or the code-owned
Section vocabulary in [ADR-0032](./0032-data-driven-section-registry.md). Every
hard rule in [CLAUDE.md](../../CLAUDE.md) remains intact.

This is the foundation ADR for **Project Palimpsest** (parent epic #402,
sub-issue CORE-1 #403). It must be signed off before CORE-2 (`morph()`
reconciler) and CORE-3 (store/dispatch/effects) build against it.

### Two scale requirements, stated up front

These are not optimisations to reach for later — they are **mandatory core
features** of the target architecture, because live Case Types reach ~500
Question Definitions:

1. **Group-scoped rendering is mandatory.** A state change re-renders only the
   Question Group(s) it affects, never the whole page. The reconciler and store
   are designed around this from CORE-2/CORE-3, not retrofitted.
2. **Per-card memoisation is mandatory.** Each Question card's view is memoised
   (CORE-4 `memo()`) so an unchanged card is skipped entirely during a
   re-render. Applicability (`showWhen`) changes must not force sibling cards to
   re-run their view functions.

And the go/no-go for the whole programme:

3. **CORE-5 keystroke-latency gate (~5 ms) is the tripwire.** On a synthetic
   500-question bank, on the Edge Chromium baseline (ADR-0001), a single
   keystroke's dispatch → store update → group-scoped `morph()` must complete in
   **~5 ms** at the 95th percentile. If it does not hold after CORE-2/CORE-3/
   CORE-4, **the programme stops** and this ADR is revisited. Nothing downstream
   of CORE-5 (PILOT, GRID, CASE, BANK, SUNSET) begins until the gate is green.
   See "The performance tripwire" below.

## Context

ADR-0003 chose custom elements in light DOM plus a home-grown `signal()` /
`computed()` / `effect()` primitive as the UI foundation. That choice was right
for the framework it grew: it gave standards-level lifecycle hooks and
fine-grained reactivity at ~50 LOC of runtime, and it carried the framework from
Slice 1 through Slice 11.

The July 2026 architecture review found that the _cost_ of that model has
outgrown its benefit at the current scale:

- **~22,000 source lines**, with a test estate around **~48,000 lines**.
- State is owned by ~35 `ShellElement` component classes, each wiring signals to
  DOM, each with its own lifecycle scope and focus/scroll-restoration machinery.
- The Case Review page alone is 13 controller files coordinating those
  components and a node registry.
- A new developer must hold **four** mental models at once: signals + component
  lifecycle + two-and-a-half authoring styles (`defineView`, `ShellElement`,
  raw `customElements.define`) + the controllers/registries that glue them.

The reactivity is _fine-grained by construction_ — every component subscribes to
the signals it reads — but that fine grain is exactly what spreads state
ownership across dozens of files and makes the data-flow hard to follow. The
review's conclusion: the same fine-grained update guarantee that 500-question
Case Types need can be delivered by a **single store + pure view functions + a
small keyed reconciler**, with _one_ mental model ("state in, DOM out, actions
back") and materially less code (~13–15,000 source lines targeted).

Crucially, most of the codebase is **not** implicated. Evaluators, services,
Case Type config, the Question Bank artifacts, and the `SharePointClient`
implementations (~5,500 lines) are pure logic and data access with no view
coupling. They carry over untouched. This ADR is about the _view layer_ only.

## Decision

Adopt a **store-driven, pure-view architecture** for the app layer.

1. **Single app store.** One store holds app state. Views never own state;
   they receive it. State transitions happen only by dispatching **actions**
   (CORE-3). This replaces per-component signal ownership.

2. **Pure view functions: `state → h() tree`.** A view is a pure function of its
   input state that returns an `h()` node tree (the existing `lib/html.js`
   primitive). No side effects, no lifecycle, no subscriptions inside a view.
   Given the same state, a view returns the same tree.

3. **Keyed DOM-morphing reconciler (`morph()`, CORE-2).** A small hand-built
   reconciler diffs the previous `h()` tree against the new one and mutates the
   live DOM in place, keyed so that node identity (and therefore input focus,
   selection, and scroll position) is preserved across re-renders. This is what
   makes "re-render the group" safe without the focus/scroll-restore machinery
   the old model needed. **No third-party diffing library** — it is framework
   code, subject to the same Hard rules as everything else.

4. **Group-scoped rendering + per-card memoisation are first-class** (see the
   two mandatory scale requirements above). The store exposes group-scoped
   slices; `morph()` runs against the affected group's container; `memo()`
   (CORE-4) skips unchanged cards.

5. **Actions and effects own all async work.** SaveQueue (ADR-0008 auto-save +
   ETag concurrency) and the `SharePointClient` (ADR-0009) are driven from
   effects, never from inside a view. The Hard rule stands, restated in the new
   model: **views never call `fetch()`**, and now more strongly, views do no I/O
   at all — a view is pure, effects do the work.

6. **Signals are retired from the app layer.** `signal()`/`computed()`/
   `effect()` are removed from application code as part of SUNSET. (Whether the
   store implements its own change notification internally is an implementation
   detail of CORE-3, not the app-layer reactivity primitive ADR-0003
   established.)

7. **Custom elements are retained only at route boundaries, and only if
   SharePoint embedding requires a tag.** The `cora-` prefix and the custom-
   element seam are kept _where the router mounts a route into the host page_ if
   a custom-element tag is what SharePoint hosting needs; everywhere below that
   seam, UI is pure view functions rendered by `morph()`, not `<cora-*>`
   components. The `cora-` CSS prefix (isolation) is unaffected — that is a Hard
   rule and stays.

### Amendment (2026-07, #536) — decision 7 tightened to zero custom elements

Decision 7 above left a conditional door open: custom elements "retained only at
route boundaries, and only if SharePoint embedding requires a tag". SharePoint
embedding turned out not to require one. The router mounts into a plain host
element on the `.aspx` page, no `customElements.define()` call survives
SUNSET-1, and the last unregistered `cora-*` hosts were removed by #514 and
#494.

The door is therefore closed: **no `cora-*` element is registered or constructed
anywhere.** What remained after SUNSET-1 was not a seam but a hazard — an
unregistered `<cora-app-nav>` renders as an inert unknown element, and the
element-type CSS written for it (`cora-app-nav { position: sticky; … }`) matches
nothing and drops every declaration silently. That is how the nav bar lost its
sticky surface and the People Picker's dropdown lost its containing block; the
same scan found four `cora-notes > …` rules nobody had noticed.

Both halves are now ratcheted by `tests/cora-element-type-contract.test.js`: no
`h('cora-…')` or `createElement('cora-…')` under `src/`, and no element-type
`cora-*` selector in `src/styles/**` — including inside a functional
pseudo-class or a nested rule, where such a selector is just as live and just as
invisible.

**The `cora-` prefix itself is untouched**, exactly as decision 7 already said:
it remains the CSS/SharePoint isolation namespace of [ADR-0001](./0001-target-sharepoint-se-and-edge-chromium.md)
and [ADR-0029](./0029-cora-branding-and-cr-prefix-rename.md), carried on class
names and custom properties. The amendment narrows _what kind of thing_ may
carry the prefix, not the prefix. The corresponding CLAUDE.md hard rule is
reworded to match.

### What is deliberately preserved, unchanged

- **ADR-0002 — route-level page independence and lazy `import()`.** The
  strangler seam _is_ the router. Each route still lazy-loads its page via
  dynamic `import()`; a broken route still cannot break its siblings or the
  boot. Old-style routes and new store-driven routes coexist behind exactly this
  contract (see migration sequencing).
- **ADR-0009 — mock-first dev loop.** `?mock=1`, `MockSharePointClient`,
  fixtures, `node --test`, and `tsc --checkJs` are untouched. The new store is
  developed and tested against the same mock client.
- **Every Hard rule in CLAUDE.md** — no third-party runtime deps, no runtime
  build step, no direct `fetch()` from the view layer, `cora-` prefix, no
  `innerHTML` for user data, Question Definitions never deleted.

### Migration sequencing (a decision, not just a plan)

The migration is a **strangler** executed through the router seam:

- Routes are converted one at a time. Because ADR-0002 guarantees route
  isolation, a converted (store-driven) route and an unconverted (component-
  owned) route run side by side with no shared view state — the router is the
  only thing they share, and it is unchanged.
- **After PILOT-2 lands, no new feature code is written in the old style.** New
  feature slices continue throughout Palimpsest, but from PILOT-2 onward they
  are authored store-driven. The old framework is deleted only once every route
  that depends on it has been converted (SUNSET-1).
- Ordering is fixed by the epic's blocker graph (#402): CORE → PILOT → GRID /
  CASE / BANK → SUNSET, with CORE-5 as a hard gate before anything past CORE
  begins.

### The performance tripwire (CORE-5)

CORE-5 is a **go/no-go gate for the entire programme**, recorded here as an
explicit decision, not an aspiration:

- **Benchmark:** a synthetic 500-question bank exercised on the Edge Chromium
  baseline.
- **Metric:** end-to-end keystroke latency — keydown in a free-text Answer →
  action dispatch → store update → group-scoped `morph()` — measured at p95.
- **Threshold:** **~5 ms.** If p95 keystroke latency does not hold at ~5 ms once
  the reconciler (CORE-2), store (CORE-3), and memoisation (CORE-4) are in
  place, the programme **stops** and this ADR is reopened rather than pressing on
  into PILOT/GRID/CASE/BANK.
- CORE-5 is itself HITL: a human signs off the measured result before PILOT-1
  starts.

The CORE-5 measurements are recorded in the
[Palimpsest 500-question performance gate report](../palimpsest-performance-gate.md).
The technical latency gate passes: headed Edge steady-state keystroke p95 was
**0.30 ms** against the ~5 ms tripwire. The go decision was signed off by the
project owner via the acceptance checkbox on PR #433, recorded on issue #408
on 2026-07-18. The macOS arm64 measurement environment was accepted on the
basis of the ~16x headroom between the measured p95 and the tripwire, without
a Windows confirmation run.

## Considered alternatives

- **Keep ADR-0003 (signals + component-owned state), refactor incrementally.**
  Rejected. The four-mental-model cost and the state-scattered-across-35-classes
  cost are structural, not incidental; incremental cleanup inside the same model
  does not collapse them. The review's line-count and single-mental-model targets
  are only reachable by changing the model.
- **Adopt a third-party view/reactive library (React, Preact, Lit, a signals
  package).** Rejected outright — violates the "no third-party runtime deps, no
  runtime build step" Hard rule, which is non-negotiable on this SharePoint SE /
  Edge-only deployment. The reconciler and store are small enough to own.
- **Coarse re-render (rebuild the whole route on every change), no memoisation.**
  Rejected. It fails the 500-question requirement: focus/scroll thrash and
  keystroke latency both blow past the ~5 ms gate. Group-scoping and per-card
  memoisation are why the pure-view model can be _both_ simple and fast, which is
  why they are mandatory core features rather than later optimisations.
- **Virtual-DOM library-style reconciler with unkeyed diffing.** Rejected.
  Without keyed identity, input focus and scroll position are lost on re-render —
  the exact failure mode ADR-0003's fine-grained reactivity was chosen to avoid.
  Keying is what lets a pure re-render preserve form state.
- **Big-bang rewrite instead of a strangler.** Rejected. Route isolation
  (ADR-0002) already gives a safe seam to convert one route at a time while the
  rest of the app keeps working; a big-bang rewrite discards that safety for no
  benefit and freezes feature delivery, which the epic explicitly forbids.

## Consequences

- **One mental model** for the app layer: state in, DOM out, actions back.
  The legacy component shell, its focus/scroll-restore machinery, the case-
  review controllers/node-registry, and app-layer signals were removed by
  SUNSET-1. The retained signal primitive is internal state/service plumbing,
  not an app-layer authoring API.
- **Materially less code.** Target ~13–15,000 source lines (from ~22,000), with
  the test estate shrinking proportionally.
- **Evaluators, services, Case Type config, the Question Bank, and the
  SharePoint client carry over untouched** — this ADR does not touch the ~5,500
  lines of pure logic/data-access.
- **A hard performance dependency is now explicit and gated.** The programme is
  contingent on CORE-5; that risk is surfaced at the top of this ADR rather than
  discovered late.
- **ADR-0003 is superseded** but its rationale is preserved: the _reasons_ it
  gave (light-DOM form ergonomics, the need for fine-grained updates on a
  500-question page, CSS isolation via prefix) are all still honoured — the new
  model satisfies them differently (keyed `morph()` for fine grain, pure views in
  light DOM for form ergonomics, the unchanged `cora-` prefix for isolation).
- **ADR-0002 and ADR-0009 are load-bearing for the migration**, not just
  preserved: the router seam is the strangler mechanism, and the mock-first loop
  is how each converted route is developed and tested.
