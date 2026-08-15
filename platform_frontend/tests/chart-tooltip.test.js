// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl, walk } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { GroupedBarChart } =
  await import('../src/components/base/cora-grouped-bar-chart.js');
const { mountGroupedBarChartTooltip } =
  await import('../src/lib/chart-tooltip.js');

/**
 * @typedef {{ left: number, top: number, width: number, height: number }} Box
 */

/** @param {any} node @param {Box} box */
function setBox(node, box) {
  node.getBoundingClientRect = () => ({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
  });
}

/** @param {any} host */
function tooltipIn(host) {
  return host
    .querySelectorAll('div')
    .find(
      (/** @type {any} node */ node) => node.getAttribute('role') === 'tooltip'
    );
}

/** @param {{ formatValue?: (value: number, mark?: any, group?: any) => string }} [options] */
function fixture(options = {}) {
  const chart = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'week-one',
          label: 'Week one',
          marks: [
            { key: 'settled', label: 'Settled', value: 8 },
            { key: 'provisional', label: 'Provisional', value: 4 },
          ],
        },
      ],
    },
    config: {
      width: 240,
      height: 180,
      ariaLabel: 'Review counts',
      yMax: 10,
      tickCount: 2,
      ...(options.formatValue ? { formatValue: options.formatValue } : {}),
    },
  });
  const host = document.createElement('div');
  host.appendChild(chart);
  const view = /** @type {any} */ (new StubEl('window'));
  view.innerWidth = 320;
  view.innerHeight = 240;
  /** @type {any[]} */
  const markNodes = [];
  walk(/** @type {any} */ (chart), (node) => {
    if (
      node
        .getAttribute('class')
        ?.split(/\s+/)
        .includes('cora-grouped-bar-chart__bar')
    ) {
      markNodes.push(node);
    }
  });
  for (const mark of markNodes) {
    setBox(mark, { left: 100, top: 120, width: 20, height: 80 });
  }
  /** @type {Box} */
  const tooltipBox = { left: 0, top: 0, width: 80, height: 32 };
  const documentObject = /** @type {any} */ ({
    createElement(/** @type {string} */ tag) {
      const node = document.createElement(tag);
      if (tag === 'div') setBox(node, tooltipBox);
      return node;
    },
    addEventListener: document.addEventListener.bind(document),
    removeEventListener: document.removeEventListener.bind(document),
    _fire: /** @type {any} */ (document)._fire.bind(document),
    documentElement: { clientWidth: 320, clientHeight: 240 },
  });
  const controller = mountGroupedBarChartTooltip(chart, {
    host,
    document: documentObject,
    view: /** @type {any} */ (view),
  });
  return {
    chart,
    host,
    view,
    documentObject,
    controller,
    marks: markNodes,
    tooltip: tooltipIn(host),
    tooltipBox,
  };
}

test('chart tooltip uses one text-only overlay for hover and focus', () => {
  const { chart, marks, tooltip, host, controller } = fixture();
  assert.ok(tooltip);
  assert.equal(host.querySelectorAll('div').length, 1);
  assert.equal(tooltip.getAttribute('role'), 'tooltip');
  assert.equal(tooltip.hidden, true);

  fireEvent(marks[0], 'pointerover');
  assert.equal(tooltip.textContent, 'Week one: Settled, 8');
  assert.equal(tooltip.hidden, false);
  assert.equal(marks[0].getAttribute('aria-describedby'), tooltip.id);

  fireEvent(marks[1], 'pointerover');
  assert.equal(tooltip.textContent, 'Week one: Provisional, 4');
  assert.equal(marks[0].getAttribute('aria-describedby'), null);
  assert.equal(marks[1].getAttribute('aria-describedby'), tooltip.id);

  fireEvent(marks[1], 'focusin');
  fireEvent(marks[0], 'pointerover');
  assert.equal(
    tooltip.textContent,
    'Week one: Provisional, 4',
    'focused marks take priority over hovered marks'
  );
  assert.equal(marks[1].getAttribute('aria-describedby'), tooltip.id);

  fireEvent(marks[1], 'focusout');
  fireEvent(marks[0], 'pointerout');
  assert.equal(tooltip.hidden, true);

  fireEvent(marks[0], 'pointerover');
  const escape = fireEvent(document, 'keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(tooltip.hidden, true);
  assert.equal(marks[0].getAttribute('aria-describedby'), null);
  controller.refresh();
  assert.equal(tooltip.hidden, true);

  fireEvent(marks[0], 'pointerover');
  assert.equal(tooltip.hidden, false);
  assert.equal(chart.parentNode, host);
  controller.dispose();
});

test('chart tooltip keeps hostile descriptions as text', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const { marks, tooltip, controller } = fixture({
    formatValue: (value, mark) => (mark ? hostile : String(value)),
  });

  fireEvent(marks[0], 'pointerover');
  assert.equal(tooltip.textContent, `Week one: Settled, ${hostile}`);
  assert.equal(tooltip.innerHTML, '');
  assert.equal(tooltip.querySelector('script'), null);
  controller.dispose();
});

test('chart tooltip positions above, falls below, clamps, and refreshes on scroll', () => {
  const { marks, tooltip, view, documentObject, tooltipBox, controller } =
    fixture();
  const mark = marks[0];

  setBox(mark, { left: 100, top: 120, width: 20, height: 40 });
  fireEvent(mark, 'pointerover');
  assert.equal(tooltip.style.left, '70px');
  assert.equal(tooltip.style.top, '80px');

  setBox(mark, { left: 0, top: 20, width: 10, height: 10 });
  tooltipBox.width = 100;
  tooltipBox.height = 30;
  fireEvent(view, 'resize');
  assert.equal(tooltip.style.left, '8px');
  assert.equal(tooltip.style.top, '38px');

  setBox(mark, { left: 310, top: 100, width: 10, height: 10 });
  documentObject._fire('scroll', { type: 'scroll' });
  assert.equal(tooltip.style.left, '212px');

  setBox(mark, { left: 200, top: 100, width: 10, height: 10 });
  documentObject._fire('scroll', { type: 'scroll' });
  assert.equal(tooltip.style.left, '155px');
  controller.dispose();
});

test('chart tooltip disposal restores the chart and is idempotent', () => {
  const fixtureState = fixture();
  const { host, marks, controller } = fixtureState;

  fireEvent(marks[0], 'focusin');
  const tooltip = fixtureState.tooltip;
  assert.equal(marks[0].getAttribute('aria-describedby'), tooltip.id);
  controller.dispose();
  assert.equal(host.querySelectorAll('div').length, 0);
  assert.equal(marks[0].getAttribute('aria-describedby'), null);
  controller.dispose();
});
