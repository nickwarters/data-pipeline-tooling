// @ts-check

/**
 * What every report chart shares: the colour roles a mark may wear, the scale
 * and axis arithmetic, the attributes the tooltip controller reads off a mark,
 * and the number formats the figures are written in.
 *
 * A chart never names a colour. It names a role, and the role resolves to a
 * design token, so light and dark mode are the stylesheet's business and a
 * series can never borrow a status colour by accident. Red is a status here,
 * not a series: `danger` exists for marks that mean "overdue" or "the worst
 * outcome", always alongside a label that says so, and brand red is never a
 * data colour at all.
 */

/**
 * @typedef {'s1' | 's2' | 's3' | 's4' | 's5' | 's6' | 'quiet' | 'quiet-strong' | 'range' | 'danger' | 'warning'} ChartRole
 */

/** @type {Readonly<Record<ChartRole, string>>} */
const ROLE_TOKENS = Object.freeze({
  s1: 'var(--cora-viz-series-1)',
  s2: 'var(--cora-viz-series-2)',
  s3: 'var(--cora-viz-series-3)',
  s4: 'var(--cora-viz-series-4)',
  s5: 'var(--cora-viz-series-5)',
  s6: 'var(--cora-viz-series-6)',
  quiet: 'var(--cora-viz-quiet)',
  'quiet-strong': 'var(--cora-viz-quiet-strong)',
  range: 'var(--cora-viz-range)',
  danger: 'var(--cora-color-danger)',
  warning: 'var(--cora-color-warning)',
});

/**
 * The token a role paints with. An unknown role throws rather than falling
 * back to a default: a mark drawn in the wrong colour reads as a different
 * series, which is worse than a chart that does not draw.
 *
 * @param {ChartRole} role
 * @returns {string}
 */
export function paint(role) {
  const token = ROLE_TOKENS[role];
  if (!token) throw new TypeError(`unknown chart colour role: ${String(role)}`);
  return token;
}

/**
 * A straight-line mapping from a domain onto a range. A zero-width domain maps
 * everything onto the start of the range rather than dividing by zero.
 *
 * @param {number} d0
 * @param {number} d1
 * @param {number} r0
 * @param {number} r1
 * @returns {(value: number) => number}
 */
export function linearScale(d0, d1, r0, r1) {
  const span = d1 - d0;
  return (value) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

/**
 * A y-axis that ends on a round number and steps in whole units. Report axes
 * count Cases, so a step of a quarter-Case is a tick label nobody can read
 * honestly; anything under one rounds up to one.
 *
 * @param {number} max the largest value the axis has to hold
 * @param {number} [ticks] how many steps above zero to aim for
 * @returns {{ max: number, step: number }}
 */
export function niceAxis(max, ticks = 4) {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    Math.ceil(
      /** @type {number} */ (
        [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)
      )
    )
  );
  return { max: step * Math.ceil(max / step), step };
}

/**
 * Up to `want` indexes spread evenly from the first item to the last, always
 * including both ends — where an x-axis puts its labels when it cannot label
 * every point.
 *
 * @param {number} count
 * @param {number} want
 * @returns {number[]}
 */
export function evenIndexes(count, want) {
  if (count <= 0) return [];
  if (count <= want) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (Math.max(2, want) - 1);
  return [
    ...new Set(
      Array.from({ length: Math.max(2, want) }, (_, i) => Math.round(i * step))
    ),
  ];
}

/**
 * A rough rendered width for a label, used only to decide whether it fits —
 * never to position it exactly. SVG text cannot be measured before it is in a
 * document, and a pure view never waits for one.
 *
 * @param {string} text
 * @param {number} [fontSize]
 * @returns {number}
 */
export function textWidth(text, fontSize = 12) {
  return text.length * fontSize * 0.56;
}

const COUNT_FORMAT = new Intl.NumberFormat('en-GB');

/**
 * A whole count, grouped by thousands.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  return COUNT_FORMAT.format(Math.round(value));
}

/**
 * A share between 0 and 1, as a percentage.
 *
 * @param {number} value
 * @param {number} [digits]
 * @returns {string}
 */
export function formatPercent(value, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * The attributes the chart tooltip controller reads off a mark: it shows the
 * description on hover and on focus. A focusable mark also announces itself,
 * so a keyboard user hears the same sentence a pointer user reads; a mark that
 * is one of hundreds (a column of a long line chart) stays out of the tab
 * order, and the panel's table carries those values instead.
 *
 * @param {string} description
 * @param {{ focusable?: boolean }} [options]
 * @returns {Record<string, string>}
 */
export function markAttributes(description, { focusable = true } = {}) {
  /** @type {Record<string, string>} */
  const attributes = {
    'data-cora-chart-mark': 'true',
    'data-cora-chart-description': description,
  };
  if (focusable) {
    attributes.tabindex = '0';
    attributes.role = 'img';
    attributes['aria-label'] = description;
  }
  return attributes;
}

/**
 * Throw unless every value is a finite number. A chart is the last place a
 * malformed feed row can be caught before it becomes a bar of the wrong
 * length, so it is checked here rather than trusted.
 *
 * @param {unknown[]} values
 * @param {string} name what the values are, for the message
 */
export function requireFiniteValues(values, name) {
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${name} must be finite numbers`);
    }
  }
}
