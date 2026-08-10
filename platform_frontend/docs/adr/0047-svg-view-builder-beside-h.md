# 47. Charts are SVG, built by an `svg()` view builder beside `h()`

Date: 2026-08-09

## Status

Accepted — extends
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md) and
[ADR-0039](./0039-view-produces-render-commits.md): a view is still pure,
returns a tree, and is still committed by `core/render.js`. The tree now
supports both `h()` and `svg()`; only the element namespace widens.

## Context

The my-stats page needs a chart. There are no third-party runtime dependencies
and there never will be (ADR-0001), so the chart is ours to draw. The current
consumer needs grouped bars with axes, value labels, formatted values, and an
HTML tooltip layered over the SVG; line charts and stacked bars are
anticipated.

**The blocker is not the missing library — it is the view primitive.** `h()`
builds elements with `document.createElement(tag)`. An `<svg>` produced that way
is an `HTMLUnknownElement` and renders nothing.

`applyProp` fails on SVG twice over, and both failures are quiet or confusing:

```js
} else if (key === 'className') { el.className = value; }
} else if (key in el)          { el[key] = value; }
```

`className` on an SVG element is a **read-only `SVGAnimatedString`**, and
modules are strict mode, so that assignment throws. The `key in el` branch is
worse: nearly every SVG geometry attribute (`x`, `y`, `width`, `height`, `cx`,
`r`) exists as a read-only `SVGAnimated*` property, so `h('rect', { width: 10 })`
takes the property branch and fails too. A naive `createElementNS` patch alone
would produce blank charts and confusing throws.

## Decision

**A sibling `svg()` builder in `src/lib/html.js`**, using
`document.createElementNS`. `h()` itself is not modified, so every existing view
carries zero risk.

**`applyProp` and `removeProp` branch on `el.namespaceURI`.** For an SVG node
they use `setAttribute`/`removeAttribute` for everything except `on*` listeners,
including `className` → `setAttribute('class', …)`. This has to live in the prop
helpers rather than only in the builder, because `core/render.js` calls them
when patching a node between renders.

**`core/render.js` never creates elements.** It adopts the nodes the builders
produce and compares `nodeName`. Its controlled-form optimisation remains
HTML-only: SVG `value` and `checked` props go through the ordinary
attribute helpers so build-time and reconciliation-time mapping stay identical.

**`GroupedBarChart` lives in `src/components/base/cora-grouped-bar-chart.js`.**
It takes externally supplied grouped data and configuration and returns a
detached, keyed SVG tree. The implementation is deliberately grouped bars
only: it does not load data or implement line charts, stacked bars, or custom
tooltips. It validates the data contract, gives repeated mark keys stable
key-sorted series slots, and sparsifies large x-axis label sets.

The pure SVG builder exposes each mark's full description, including its
formatted value and provisional status, as data metadata on the focusable
rectangle (`data-cora-chart-mark` and `data-cora-chart-value`). The my-stats
route uses its custom render seam to mount one HTML `[role="tooltip"]` under
the app root after the SVG is committed. The controller delegates pointer and
keyboard focus events from the SVG, keeps the focused mark ahead of a hovered
mark, positions the overlay over the chart, and dismisses it with Escape from
the document while it is open. It owns the temporary `aria-describedby` link
and removes the overlay and listeners when the route unmounts.

### Rejected

**Canvas.** One element, drawn imperatively. It fails the hover requirement on
its own terms: with no DOM nodes, hover means hand-written hit-testing
arithmetic. It also fights ADR-0039 — drawing is a side effect _after_ render,
where a view must be pure — and it is unselectable, inaccessible, and needs
manual DPI handling.

**CSS/DOM bars.** Genuinely good for bars: `div`s with percentage heights, no
framework change at all, naturally accessible, hollow bars are one border rule.
It was the recommendation until line charts entered the requirement. CSS fakes a
line with rotated elements or clip-paths, which is where the approach stops
being elegant. Rejected for the anticipated requirement, not the current one.

**Teaching `h()` itself to switch namespace.** Needs either a tag allow-list —
ambiguous for `title`, `a` and `script`, which exist in both namespaces — or
contextual namespace inheritance, which makes the most-used function in the app
stateful. A separate builder makes the namespace explicit at the call site and
leaves `h()` alone.

## Consequences

- **"No third-party runtime dependencies" is untouched.** We are writing a
  chart, not vendoring one.
- **Line charts and stacked bars are anticipated and deliberately not built.**
  The first consumer needs neither, and the guardrail is to build what the first
  consumer needs. This decision exists partly so the builder does not get
  designed in a way that precludes them — SVG was chosen _for_ them. Adding
  either later is a chart-component change, not a primitive change.
- **A new contract test is the ratchet:** SVG nodes take attributes, never
  properties. Without it the property branch can silently return, and the
  failure mode — a chart that renders but ignores a dimension — is much harder
  to spot than a throw.
- **The controlled-form optimisation is HTML-only.** SVG `value` and
  `checked` are ordinary attributes, so the reconciler's form-property path
  does not apply to namespaced nodes.
- **Charts theme for free.** `fill` and `stroke` read `cora-design-tokens.css`
  custom properties directly, so the chart inherits the palette rather than
  declaring its own.
- **Accessibility is now explicit work.** HTML bars would have been accessible
  by construction; SVG keeps `role="img"` and `aria-label` on each focusable
  mark rectangle. The per-mark SVG `<title>` is superseded by the HTML
  tooltip, which exposes the full mark description, while legend titles remain.
  Keyboard focus reaches the same mark target as pointer hover, and Escape
  dismisses the tooltip even when it was opened by pointer hover.
- **Series identity is key-based.** Marks with the same key share a horizontal
  slot across groups, including when a group omits or reorders marks. Slots are
  sorted by key for deterministic output. A repeated key whose label or
  effective tone disagrees throws instead of silently choosing one occurrence.
- **Large group sets stay readable.** The x-axis keeps a single semantic group
  label layer, samples at most twelve visible labels while retaining the
  endpoints, and omits duplicate labels.
- **The legend and value labels have reserved bands.** Wrapped legend rows and
  the mark-value band are included in layout before the plot starts, including
  with `margin.top: 0`; a narrow or overfull chart fails with a message about
  its data shape and available geometry.
- **Domains and labels stay useful.** Derived y domains are positive for empty,
  zero, and constant data. The default formatter uses significant figures so
  nonzero subunit values remain visible; invalid or duplicate formatted tick
  labels are rejected.
- **Hollow marks are caller-owned provenance.** `GroupedBarChart` renders
  `provisional: true` as hollow and all other marks solid; my-stats will use
  that seam for the settled-versus-live provenance in ADR-0048 without
  treating hollow as zero or excluded. The provisional class is a semantic
  marker only and has no live CSS rule.
