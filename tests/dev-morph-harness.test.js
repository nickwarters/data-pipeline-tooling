// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByTag, findAllByClass } from './_dom-stub.js';

installDom();

const { visibleItems, harnessView, createRouteSlice } =
  await import('../src/pages/dev-morph-harness.js');
const { createStoreRoute } = await import('../src/core/store-route.js');

const G = /** @type {any} */ (globalThis);

/** @type {import('../src/pages/dev-morph-harness.js').Item[]} */
const ITEMS = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Bravo' },
  { key: 'c', label: 'Cat' },
];

test('visibleItems: an empty query returns every item unchanged', () => {
  assert.deepEqual(visibleItems(ITEMS, ''), ITEMS);
  assert.deepEqual(visibleItems(ITEMS, '   '), ITEMS);
});

test('visibleItems: filters by substring and orders shortest label first', () => {
  const shown = visibleItems(ITEMS, 'a');
  // Alpha, Bravo, Cat all contain "a"; shortest label (Cat) comes first.
  assert.deepEqual(
    shown.map((i) => i.label),
    ['Cat', 'Alpha', 'Bravo']
  );
});

test('visibleItems: equal-length labels fall back to key order', () => {
  const items = [
    { key: 'z', label: 'Zeta' },
    { key: 'm', label: 'Meta' },
  ];
  assert.deepEqual(
    visibleItems(items, 'eta').map((i) => i.key),
    ['m', 'z']
  );
});

test('harnessView: renders the controlled input and a keyed row per visible item', () => {
  const tree = harnessView({ query: '' }, () => {});
  const input = findByTag(tree, 'input');
  assert.ok(input, 'has a filter input');
  assert.equal(input.value, '');
  const rows = findAllByClass(tree, 'cora-morph-harness__item');
  assert.equal(rows.length, 8, 'all default items shown');
});

test('dev morph route slice: typing re-renders the list while keeping the input focused', async () => {
  const container = G.document.createElement('div');
  const handler = createStoreRoute({
    load: async () => ({ createRouteSlice }),
    context: {},
  });
  await handler.mount(container, {});

  const input = findByTag(container, 'input');
  const before = findAllByClass(container, 'cora-morph-harness__item').length;
  assert.equal(before, 8);

  // The user focuses the input and types "o".
  input.focus();
  assert.equal(G.document.activeElement, input);
  input.value = 'o';
  input.dispatchEvent(new G.CustomEvent('input'));
  await Promise.resolve();

  // The list re-rendered (fewer rows), and the same input still holds focus.
  const after = findAllByClass(container, 'cora-morph-harness__item');
  assert.ok(after.length < before, 'list filtered down on keystroke');
  assert.ok(after.length > 0, 'some items still match "o"');
  const inputAfter = findByTag(container, 'input');
  assert.equal(inputAfter, input, 'the input is the same DOM node');
  assert.equal(input.value, 'o', 'typed value preserved');
  assert.equal(
    G.document.activeElement,
    input,
    'focus not lost across re-render'
  );

  handler.unmount();
});
