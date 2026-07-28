# 39. `view` produces, `render` commits: one word per operation in the view runtime

Date: 2026-07-28

## Status

Accepted — amends the naming introduced by
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md)
(CORE-2's `morph()`, CORE-3's store callback). ADR-0034's decisions about
architecture — store-driven pure views, keyed in-place reconciliation, the
performance gate — are unchanged and remain in force. Only the vocabulary
changes.

## Context

The store-driven view runtime performs two operations that are genuinely
different, and until this ADR the codebase used the word "render" for both:

- **Producing** a tree of nodes. Pure, returns `Node`s, touches nothing:
  `slice.view()`, every `*View()` function and `*-view.js` module, the thunk
  passed to `memo()`, the `SECTION_PANELS` entries.
- **Committing** a tree into a live container. Side-effecting, returns nothing
  useful: `morph()`, `slice.render()`, and the store's `render` callback.

The producer family already had a good word — `view` — used consistently by the
`*-view.js` convention and `slice.view()`. But three producers were named
`render` anyway (`questionsView.render()`, the `PanelRenderer` typedef,
`memo()`'s `renderFn` parameter), and the committing family had no consistent
word at all.

Two concrete costs followed:

1. **`morph()` did not say what it did to a reader who had not met morphdom.**
   The name is the established one in the no-vdom ecosystem (morphdom,
   Idiomorph, htmx's `hx-swap="morph"`), so it was searchable — but it did not
   read as "put this on screen" at its ~20 call sites, and it was the first
   thing developers new to the codebase asked about.

2. **A three-level `render` chain in `store-route.js`.** `createStore`'s
   `render:` option called `slice.render(...)`, which called `tools.morph(...)`.
   Three different things named "render" in one call stack, which is precisely
   where a reader is trying to work out who owns what.

The store's callback was the worst offender: `src/core/store.js` is entirely
DOM-agnostic — it owns state and a coalescing microtask schedule and nothing
else — so naming its callback `render` asserted something the module does not
know and cannot guarantee.

## Decision

**One word per operation, across the runtime:**

- **`view`** — produces a tree of nodes. Pure, no side effects. Applies to
  `slice.view()`, `*View()` functions, `*-view.js` modules, `memo()`'s `viewFn`,
  and the `PanelView` typedef.
- **`render`** — commits a tree into a live container. `src/core/render.js`
  exports `render(parent, tree, stats)`, exposed to slices as
  `tools.render(container, tree)`. `slice.render(container, state, tools)` keeps
  its name: a slice that commits its own containers is doing exactly this.

Specifically:

| Before                         | After                            |
| ------------------------------ | -------------------------------- |
| `src/core/morph.js`, `morph()` | `src/core/render.js`, `render()` |
| `tools.morph(container, tree)` | `tools.render(container, tree)`  |
| `MorphStats`                   | `RenderStats`                    |
| `createStore({ render })`      | `createStore({ onStateChange })` |
| `store.render()`               | `store.flush()`                  |
| `questionsView.render(props)`  | `questionsView.view(props)`      |
| `PanelRenderer`                | `PanelView`                      |
| `memo(key, deps, renderFn)`    | `memo(key, deps, viewFn)`        |

`onStateChange` names what the store actually promises: state settled, here it
is, do what you like. `flush()` names the synchronous, schedule-bypassing call
the initial mount needs.

## Alternatives considered

**Keep `morph()`.** The status quo. Its lineage is real and the technique stays
searchable under "DOM morphing" — but it left the producer/committer confusion
unresolved, which is the larger problem. The header comment in
`src/core/render.js` keeps the morphdom pointer, so the searchability is not
lost.

**`reconcile()`.** Precise, matches React's vocabulary, and collision-free
without touching `store.js`. Rejected as the second choice: it is heavier at
~20 call sites, and it leaves the store's misleading `render` callback in place
rather than resolving the overload.

**`patch()`.** Precedented (snabbdom, Vue), but `patch` already means an
_immutable state merge_ in this codebase — `patchRoute`/`patchSnapshot` in
`src/core/route-state.js`. Reusing it for DOM mutation would be a worse
collision than the one being fixed.

**`diff()`.** Rejected outright. A diff computes and returns a delta without
mutating; this function mutates in place and returns only instrumentation. The
name would describe the opposite of the behaviour.

## Consequences

- **The rename is mechanical and complete.** No behaviour changes; the test
  suite passes unchanged in substance (assertions and fixture names follow the
  rename). `src/core/render.js`'s header records the former name and the
  morphdom lineage so the technique stays findable.
- **New pages get the rule from CLAUDE.md**, which now states the
  view-produces/render-commits contract alongside the prop-naming contract.
- **Earlier ADRs keep their original wording.** ADR-0003, ADR-0032 and ADR-0034
  still say `morph()`; they are dated records of what was decided when, and
  rewriting them would make the history lie. This ADR is the pointer. The same
  applies to `docs/palimpsest-performance-gate.md`, which carries a terminology
  note rather than edited measurements.
- **This is a vocabulary decision, not an architectural one.** It does not
  reopen ADR-0034's choice of a hand-built reconciler, and it does not bear on
  the standing "no third-party runtime dependencies" rule.
