// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  queryAllByRole,
  queryByRole,
  textContent,
} from './helpers/semantic-dom.js';

installDom();

const { KpiRow } = await import('../src/components/report/stat-tile.js');

/** @param {Partial<import('../src/reports/contract.js').StatTileSpec>} [overrides] */
function tile(overrides = {}) {
  return { key: 'open', label: 'Open Cases', value: '42', ...overrides };
}

/** @param {any} root @param {string} selector */
function part(root, selector) {
  return root.querySelector(selector);
}

/** @param {any} element */
function inlineStyle(element) {
  return String(element.getAttribute('style') ?? element.style);
}

test('a tile shows its label and its already-formatted value', () => {
  const row = KpiRow([tile()]);

  assert.equal(
    textContent(part(row, '.cora-report-tile__label')),
    'Open Cases'
  );
  assert.equal(textContent(part(row, '.cora-report-tile__value')), '42');
});

test('a row draws one tile per figure, in the order given', () => {
  const row = KpiRow([
    tile({ key: 'a', label: 'First', value: '1' }),
    tile({ key: 'b', label: 'Second', value: '2' }),
    tile({ key: 'c', label: 'Third', value: '3' }),
  ]);

  const labels = Array.from(
    row.querySelectorAll('.cora-report-tile__label')
  ).map((label) => textContent(label));
  assert.deepEqual(labels, ['First', 'Second', 'Third']);
});

test('a unit sits beside the value only when the tile has one', () => {
  const withUnit = KpiRow([tile({ unit: 'days' })]);
  const without = KpiRow([tile()]);

  assert.equal(textContent(part(withUnit, '.cora-report-tile__unit')), 'days');
  assert.equal(part(without, '.cora-report-tile__unit'), null);
});

test('a status marker carries an accessible name saying what it means', () => {
  const danger = KpiRow([tile({ status: 'danger' })]);
  const warning = KpiRow([tile({ status: 'warning' })]);

  const dangerMarker = queryByRole(danger, 'img');
  const warningMarker = queryByRole(warning, 'img');
  assert.equal(dangerMarker?.getAttribute('aria-label'), 'Needs attention');
  assert.match(dangerMarker?.className ?? '', /--danger/);
  assert.equal(warningMarker?.getAttribute('aria-label'), 'Due soon');
  assert.match(warningMarker?.className ?? '', /--warning/);
});

test('a tile with no status draws no status marker', () => {
  const row = KpiRow([tile()]);

  assert.equal(part(row, '.cora-report-tile__status'), null);
  assert.equal(queryByRole(row, 'img'), null);
});

test('a tile with a trend draws a sparkline, and one without does not', () => {
  const trended = KpiRow([tile({ trend: [3, 5, 4, 9] })]);
  const plain = KpiRow([tile()]);

  assert.ok(part(trended, '.cora-sparkline'));
  assert.equal(part(plain, '.cora-sparkline'), null);
});

test('a change names its direction with an arrow and its tone with a class', () => {
  const arrows = {
    up: '▲',
    down: '▼',
    flat: '■',
  };
  const tones = ['good', 'bad', 'neutral'];

  for (const [direction, arrow] of Object.entries(arrows)) {
    for (const tone of tones) {
      const row = KpiRow([
        tile({
          delta: {
            text: '3 since Monday',
            direction: /** @type {'up' | 'down' | 'flat'} */ (direction),
            tone: /** @type {'good' | 'bad' | 'neutral'} */ (tone),
          },
        }),
      ]);
      const delta = part(row, '.cora-report-tile__delta');

      assert.equal(textContent(delta), `${arrow} 3 since Monday`);
      assert.match(delta.className, new RegExp(`--${tone}$`));
    }
  }
});

test('a meter reads as a percentage against its named target', () => {
  const row = KpiRow([
    tile({ meter: { value: 0.625, target: 0.8, label: 'the SLA' } }),
  ]);

  const meter = queryByRole(row, 'img');
  assert.equal(
    meter?.getAttribute('aria-label'),
    '62.5% against the SLA of 80%'
  );
  assert.match(
    inlineStyle(part(row, '.cora-report-tile__meter-fill')),
    /width: 62\.5%/
  );
  assert.match(
    inlineStyle(part(row, '.cora-report-tile__meter-target')),
    /left: 80\.0%/
  );
});

test('a meter never draws past either end of its track', () => {
  const over = KpiRow([
    tile({ meter: { value: 1.4, target: 1.2, label: 'target' } }),
  ]);
  const under = KpiRow([
    tile({ meter: { value: -0.2, target: -0.5, label: 'target' } }),
  ]);

  assert.match(
    inlineStyle(part(over, '.cora-report-tile__meter-fill')),
    /width: 100\.0%/
  );
  assert.match(
    inlineStyle(part(over, '.cora-report-tile__meter-target')),
    /left: 100\.0%/
  );
  assert.match(
    inlineStyle(part(under, '.cora-report-tile__meter-fill')),
    /width: 0\.0%/
  );
  assert.match(
    inlineStyle(part(under, '.cora-report-tile__meter-target')),
    /left: 0\.0%/
  );
});

test('the foot appears for a change or a meter, and is absent with neither', () => {
  const bare = KpiRow([tile({ trend: [1, 2] })]);
  const changed = KpiRow([
    tile({ delta: { text: 'same', direction: 'flat', tone: 'neutral' } }),
  ]);
  const measured = KpiRow([
    tile({ meter: { value: 0.5, target: 0.5, label: 'target' } }),
  ]);

  assert.equal(part(bare, '.cora-report-tile__foot'), null);
  assert.ok(part(changed, '.cora-report-tile__foot'));
  assert.equal(part(changed, '.cora-report-tile__meter'), null);
  assert.ok(part(measured, '.cora-report-tile__foot'));
  assert.equal(part(measured, '.cora-report-tile__delta'), null);
});

test('a tile can carry a change and a meter together', () => {
  const row = KpiRow([
    tile({
      delta: { text: '2 fewer', direction: 'down', tone: 'good' },
      meter: { value: 0.3, target: 0.5, label: 'target' },
    }),
  ]);

  assert.ok(part(row, '.cora-report-tile__delta'));
  assert.equal(queryAllByRole(row, 'img').length, 1);
});

test('a row lays tiles one per line only when asked to stack', () => {
  const wide = KpiRow([tile()]);
  const narrow = KpiRow([tile()], { stacked: true });

  assert.doesNotMatch(wide.className, /stacked/);
  assert.match(narrow.className, /cora-report-kpis--stacked/);
});
