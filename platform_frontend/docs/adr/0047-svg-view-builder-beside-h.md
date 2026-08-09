# 47. Charts are SVG, built by an `svg()` view builder beside `h()`

Date: 2026-08-09

## Status

Accepted — extends
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md) and
[ADR-0039](./0039-view-produces-render-commits.md), whose "a view is pure and
returns an `h()` tree" contract is preserved exactly: a chart view is still
pure, still returns a tree, and is still committed by `core/render.js`. Only the
element namespace widens.

## Context

The my-stats page needs a chart. There are no third-party runtime dependencies
and there never will be (ADR-0001), so the chart is ours to draw. The
requirement is bar charts today, line and stacked bars anticipated, hover
tooltips showing a formatted value, and a look that reads as part of the app
rather than bolted on.

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

**`core/render.js` is unchanged.** It never creates elements — it adopts the
nodes the builder produced and compares `nodeName`, which is consistent when
both sides come from the same builder.

**The tooltip is HTML, not SVG `<text>`**, positioned over the chart, so it gets
ordinary CSS wrapping, padding and shadow.

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
- **Charts theme for free.** `fill` and `stroke` read `cora-design-tokens.css`
  custom properties directly, so the chart inherits the palette rather than
  declaring its own.
- **Accessibility is now explicit work.** HTML bars would have been accessible
  by construction; SVG needs `role`, `<title>` or `aria-label` per mark. That
  cost is real and is the main thing lost against the CSS/DOM alternative.
