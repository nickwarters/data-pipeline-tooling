// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  register,
  deregister,
  actions,
  openPalette,
  closePalette,
  isOpen,
  filterActions,
} = await import('../src/services/command-palette-store.js');

/** @returns {import('../src/services/command-palette-store.js').PaletteAction} */
function makeAction(id = 'a', overrides = {}) {
  return {
    id,
    label: `Action ${id}`,
    keywords: [],
    handler: () => {},
    ...overrides,
  };
}

// Reset between tests by deregistering known ids — avoids module re-import cost.

test('register: adds action to actions signal', () => {
  register(makeAction('r1'));
  assert.ok(actions.get().some((a) => a.id === 'r1'));
  deregister('r1');
});

test('deregister: removes action by id', () => {
  register(makeAction('r2'));
  deregister('r2');
  assert.ok(!actions.get().some((a) => a.id === 'r2'));
});

test('register: duplicate id replaces existing entry', () => {
  register(makeAction('r3', { label: 'First' }));
  register(makeAction('r3', { label: 'Second' }));
  const matches = actions.get().filter((a) => a.id === 'r3');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].label, 'Second');
  deregister('r3');
});

test('filterActions: empty query returns all actions', () => {
  const all = [makeAction('x'), makeAction('y')];
  assert.deepEqual(filterActions('', all), all);
});

test('filterActions: matches label as case-insensitive substring', () => {
  const all = [
    makeAction('x', { label: 'Go to Case' }),
    makeAction('y', { label: 'Dashboard' }),
  ];
  const result = filterActions('case', all);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'x');
});

test('filterActions: matches keyword entries case-insensitively', () => {
  const all = [
    makeAction('x', { label: 'Allocate', keywords: ['next', 'assign'] }),
    makeAction('y', { label: 'Open', keywords: ['navigate'] }),
  ];
  assert.equal(filterActions('NEXT', all).length, 1);
  assert.equal(filterActions('NEXT', all)[0].id, 'x');
});

test('openPalette: sets isOpen to true; closePalette: sets it to false', () => {
  closePalette();
  assert.equal(isOpen.get(), false);
  openPalette();
  assert.equal(isOpen.get(), true);
  closePalette();
  assert.equal(isOpen.get(), false);
});
