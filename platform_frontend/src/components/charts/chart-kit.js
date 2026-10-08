// @ts-check

/** @typedef {'s1' | 's2' | 's3' | 's4' | 's5' | 's6' | 'quiet' | 'quiet-strong' | 'range' | 'danger' | 'warning'} ChartRole */

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
 * @param {ChartRole} role
 * @returns {string}
 */
export function paint(role) {
  const token = ROLE_TOKENS[role];
  if (!token) throw new TypeError(`unknown chart colour role: ${String(role)}`);
  return token;
}

/**
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
 * @param {number} max
 * @param {number} [ticks]
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
 * @param {string} text
 * @param {number} [fontSize]
 * @returns {number}
 */
export function textWidth(text, fontSize = 12) {
  return text.length * fontSize * 0.56;
}

const COUNT_FORMAT = new Intl.NumberFormat('en-GB');

/**
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  return COUNT_FORMAT.format(Math.round(value));
}

/**
 * @param {number} value
 * @param {number} [digits]
 * @returns {string}
 */
export function formatPercent(value, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
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
 * @param {unknown[]} values
 * @param {string} name
 */
export function requireFiniteValues(values, name) {
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${name} must be finite numbers`);
    }
  }
}
