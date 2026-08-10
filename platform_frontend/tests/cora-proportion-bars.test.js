// @ts-check

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDom } from './_dom-stub.js';
import { queryAllByRole } from './helpers/semantic-dom.js';

installDom();

const { ProportionBars } =
  await import('../src/components/base/cora-proportion-bars.js');

/** @param {any} root @returns {any[]} */
function progressBars(root) {
  return queryAllByRole(root, 'progressbar');
}

test('ProportionBars renders a full-width row with visible label and count', () => {
  const root = ProportionBars({
    rows: [{ key: 'complaints', label: 'Complaints', count: 8, share: 1 }],
  });
  const [bar] = progressBars(root);

  assert.equal(root.tagName, 'UL');
  assert.match(root.textContent, /Complaints/);
  assert.match(root.textContent, /8/);
  assert.match(root.textContent, /100%/);
  assert.equal(bar.getAttribute('role'), 'progressbar');
  assert.equal(bar.getAttribute('aria-valuenow'), '100');
  assert.equal(bar.style.width, '100%');
  assert.equal(bar.getAttribute('style'), 'width: 100%');
});

test('ProportionBars renders equal rows at 50 percent', () => {
  const root = ProportionBars({
    rows: [
      { key: 'a', label: 'Alpha', count: 2, share: 0.5 },
      { key: 'b', label: 'Beta', count: 2, share: 0.5 },
    ],
  });
  const bars = progressBars(root);

  assert.equal(bars.length, 2);
  assert.deepEqual(
    bars.map((bar) => [bar.getAttribute('aria-valuenow'), bar.style.width]),
    [
      ['50', '50%'],
      ['50', '50%'],
    ]
  );
  assert.match(root.textContent, /Alpha2.*50%.*Beta2.*50%/);
});

test('ProportionBars renders the optional empty state without progress bars', () => {
  const root = ProportionBars({
    rows: [],
    emptyStateText: 'No data for this range.',
  });

  assert.equal(progressBars(root).length, 0);
  assert.equal(
    root.querySelector('.cora-proportion-bars-empty')?.textContent,
    'No data for this range.'
  );
});

test('ProportionBars bounds unsafe shares and keeps labels as text', () => {
  const root = ProportionBars({
    rows: [
      { key: 'low', label: '<script>bad</script>', count: 1, share: -2 },
      { key: 'high', label: 'High', count: 3, share: Number.NaN },
      { key: 'over', label: 'Over', count: 4, share: 2 },
    ],
  });
  const bars = progressBars(root);

  assert.deepEqual(
    bars.map((bar) => bar.getAttribute('aria-valuenow')),
    ['0', '0', '100']
  );
  assert.match(root.textContent, /<script>bad<\/script>/);
  assert.equal(root.innerHTML, '');
});

test('ProportionBars exposes label, count, and percentage in each accessible description', () => {
  const root = ProportionBars({
    rows: [{ key: 'complaints', label: 'Complaints', count: 3, share: 0.75 }],
  });
  const [bar] = progressBars(root);

  assert.equal(bar.getAttribute('aria-valuemin'), '0');
  assert.equal(bar.getAttribute('aria-valuemax'), '100');
  assert.match(bar.getAttribute('aria-label'), /Complaints/);
  assert.match(bar.getAttribute('aria-label'), /3/);
  assert.match(bar.getAttribute('aria-label'), /75%/);
  assert.equal(bar.getAttribute('aria-valuetext'), 'Complaints: 3 (75%)');
});
