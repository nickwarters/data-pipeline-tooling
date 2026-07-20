// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();
const { mountCommandPalette } =
  await import('../src/components/sections/cora-command-palette.js');
const { createCommandPaletteStore } =
  await import('../src/services/command-palette-store.js');

/** @param {string} id @param {Record<string, any>} [overrides] */
function action(id, overrides = {}) {
  return {
    id,
    label: `Action ${id}`,
    keywords: [],
    handler() {},
    ...overrides,
  };
}

function harness() {
  const root = new StubEl('div');
  const target = new StubEl('document');
  const store = createCommandPaletteStore();
  const cleanup = mountCommandPalette(/** @type {any} */ (root), {
    store,
    target,
  });
  return { root, target, store, cleanup };
}

/** @param {ReturnType<typeof harness>} h @param {string} key */
function pressMain(h, key) {
  /** @type {any} */ (h.root.querySelector('.palette-input')).dispatchEvent({
    type: 'keydown',
    key,
    preventDefault() {},
  });
}

test('mounted command palette renders from store open/query actions', () => {
  const h = harness();
  assert.equal(h.root.childElementCount, 0);
  h.store.dispatch({ type: 'palette/register', action: action('case') });
  h.store.dispatch({ type: 'palette/register', action: action('dash') });
  h.store.dispatch({ type: 'palette/open' });
  assert.equal(h.root.querySelectorAll('.palette-item').length, 2);

  /** @type {any} */ (h.root.querySelector('.palette-input')).dispatchEvent({
    type: 'input',
    target: { value: 'dash' },
  });
  assert.equal(h.root.querySelectorAll('.palette-item').length, 1);
  assert.match(h.root.textContent, /Action dash/);
  h.cleanup();
});

test('command palette arrow and Enter actions execute the selected simple action', () => {
  const h = harness();
  let called = 0;
  h.store.dispatch({
    type: 'palette/register',
    action: action('run', { handler: () => called++ }),
  });
  h.store.dispatch({ type: 'palette/open' });
  pressMain(h, 'ArrowDown');
  assert.match(
    /** @type {any} */ (h.root.querySelector('.palette-item')).className,
    /selected/
  );
  pressMain(h, 'Enter');
  assert.equal(called, 1);
  assert.equal(h.store.getState().isOpen, false);
  h.cleanup();
});

test('command palette Escape closes and clears the query', () => {
  const h = harness();
  h.store.dispatch({ type: 'palette/open' });
  h.store.dispatch({ type: 'palette/query', query: 'case' });
  pressMain(h, 'Escape');
  assert.equal(h.store.getState().isOpen, false);
  assert.equal(h.store.getState().query, '');
  h.cleanup();
});

test('command palette input actions collect an argument before closing', () => {
  const h = harness();
  let received = '';
  h.store.dispatch({
    type: 'palette/register',
    action: action('go', {
      kind: 'input',
      input: { placeholder: 'Case reference' },
      handler: (/** @type {string} */ value) => {
        received = value;
      },
    }),
  });
  h.store.dispatch({ type: 'palette/open' });
  pressMain(h, 'ArrowDown');
  pressMain(h, 'Enter');
  const input = h.root.querySelector('.palette-arg-input');
  assert.ok(input);
  input.dispatchEvent({
    type: 'keydown',
    key: 'Enter',
    target: { value: 'CASE-42' },
    preventDefault() {},
  });
  assert.equal(received, 'CASE-42');
  assert.equal(h.store.getState().isOpen, false);
  h.cleanup();
});

test('command palette option actions select an option value before closing', () => {
  const h = harness();
  let received = '';
  h.store.dispatch({
    type: 'palette/register',
    action: action('set', {
      kind: 'options',
      options: [
        { label: 'Pass', value: 'pass' },
        { label: 'Fail', value: 'fail' },
      ],
      handler: (/** @type {string} */ value) => {
        received = value;
      },
    }),
  });
  h.store.dispatch({ type: 'palette/open' });
  pressMain(h, 'ArrowDown');
  pressMain(h, 'Enter');
  assert.equal(h.root.querySelectorAll('.palette-option').length, 2);
  pressMain(h, 'ArrowDown');
  pressMain(h, 'Enter');
  assert.equal(received, 'pass');
  h.cleanup();
});

test('mounted command palette binds Ctrl+K and cleanup removes the shortcut', () => {
  const h = harness();
  h.target.dispatchEvent({
    type: 'keydown',
    key: 'k',
    ctrlKey: true,
    preventDefault() {},
  });
  assert.equal(h.store.getState().isOpen, true);
  h.store.dispatch({ type: 'palette/close' });
  h.cleanup();
  h.target.dispatchEvent({
    type: 'keydown',
    key: 'k',
    ctrlKey: true,
    preventDefault() {},
  });
  assert.equal(h.store.getState().isOpen, false);
});
