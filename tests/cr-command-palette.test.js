// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

// Extend the stub document with a keydown-listener store so the component can
// attach global keyboard handlers.
const G = /** @type {any} */ (globalThis);
G.document._keydownListeners = [];
const _origAdd = G.document.addEventListener.bind(G.document);
const _origRemove = G.document.removeEventListener.bind(G.document);
G.document.addEventListener = (/** @type {string} */ type, /** @type {Function} */ handler) => {
  if (type === 'keydown') G.document._keydownListeners.push(handler);
  else _origAdd(type, handler);
};
G.document.removeEventListener = (/** @type {string} */ type, /** @type {Function} */ handler) => {
  if (type === 'keydown') {
    const i = G.document._keydownListeners.indexOf(handler);
    if (i >= 0) G.document._keydownListeners.splice(i, 1);
  } else _origRemove(type, handler);
};
/** @param {Partial<KeyboardEvent>} ev */
function fireKeydown(ev) {
  for (const h of [...G.document._keydownListeners]) h(ev);
}

const { CRCommandPalette } = await import('../src/components/cr-command-palette.js');
const {
  register, actions, isOpen, query, openPalette, closePalette,
} = await import('../src/services/command-palette-store.js');

function resetStore() {
  actions.set([]);
  query.set('');
  closePalette();
}

/** @returns {import('../src/services/command-palette-store.js').PaletteAction} */
function makeAction(/** @type {string} */ id, /** @type {Partial<import('../src/services/command-palette-store.js').PaletteAction>} */ overrides = {}) {
  return { id, label: `Action ${id}`, keywords: [], handler: () => {}, ...overrides };
}

/** Collect all descendant text from a StubEl (text nodes have no _children). */
function text(/** @type {any} */ node) {
  if (!node) return '';
  if (!node._children || node._children.length === 0) return node.textContent || '';
  return node._children.map(text).join('');
}

/** @returns {any} */
function makeEl() {
  const c = new CRCommandPalette();
  c.connectedCallback();
  return c;
}

/** Always returns the CURRENT overlay (fresh after each re-render). */
function overlay(/** @type {any} */ c) { return c._children[0]; }

/** Fire a keydown on the current main search input (re-queries each call). */
function pressMain(/** @type {any} */ c, /** @type {string} */ key) {
  const input = overlay(c).querySelector('.palette-input');
  for (const h of (input._listeners['keydown'] ?? [])) h({ key, preventDefault: () => {} });
}

// ─── Behavior 8 ─────────────────────────────────────────────────────────────
test('cr-command-palette: renders no overlay when closed', () => {
  resetStore();
  const c = makeEl();
  assert.equal(c._children.length, 0);
  c.disconnectedCallback();
});

// ─── Behavior 9 ─────────────────────────────────────────────────────────────
test('cr-command-palette: renders overlay and input when isOpen is true', () => {
  resetStore();
  const c = makeEl();
  openPalette();
  assert.ok(overlay(c), 'overlay present');
  assert.ok(overlay(c).querySelector('.palette-input'), 'input present');
  c.disconnectedCallback();
});

// ─── Behavior 10 ────────────────────────────────────────────────────────────
test('cr-command-palette: query signal update re-renders filtered list', () => {
  resetStore();
  register(makeAction('q1', { label: 'Go to Case' }));
  register(makeAction('q2', { label: 'Dashboard' }));
  const c = makeEl();
  openPalette();

  let items = overlay(c).querySelectorAll('.palette-item');
  assert.equal(items.length, 2, 'all items shown with empty query');

  query.set('dashboard');
  items = overlay(c).querySelectorAll('.palette-item');
  assert.equal(items.length, 1);
  assert.ok(text(items[0]).toLowerCase().includes('dashboard'));

  c.disconnectedCallback();
});

// ─── Behavior 11 ────────────────────────────────────────────────────────────
test('cr-command-palette: ArrowDown/Up move the selected item', () => {
  resetStore();
  register(makeAction('nav1', { label: 'Alpha' }));
  register(makeAction('nav2', { label: 'Beta' }));
  const c = makeEl();
  openPalette();

  pressMain(c, 'ArrowDown');
  let items = overlay(c).querySelectorAll('.palette-item');
  assert.equal(items.findIndex((/** @type {any} */ i) => i.className.includes('selected')), 0, 'first item selected');

  pressMain(c, 'ArrowDown');
  items = overlay(c).querySelectorAll('.palette-item');
  assert.equal(items.findIndex((/** @type {any} */ i) => i.className.includes('selected')), 1, 'second item selected');

  pressMain(c, 'ArrowUp');
  items = overlay(c).querySelectorAll('.palette-item');
  assert.equal(items.findIndex((/** @type {any} */ i) => i.className.includes('selected')), 0, 'back to first');

  c.disconnectedCallback();
});

// ─── Behavior 12 ────────────────────────────────────────────────────────────
test('cr-command-palette: Enter executes selected simple action and closes', () => {
  resetStore();
  let called = false;
  register(makeAction('exec1', { label: 'Execute Me', handler: () => { called = true; } }));
  const c = makeEl();
  openPalette();

  pressMain(c, 'ArrowDown');
  pressMain(c, 'Enter');

  assert.ok(called, 'handler was called');
  assert.equal(isOpen.get(), false, 'palette closed');

  c.disconnectedCallback();
});

// ─── Behavior 13 ────────────────────────────────────────────────────────────
test('cr-command-palette: Escape closes palette and resets query', () => {
  resetStore();
  query.set('something');
  openPalette();
  const c = makeEl();

  pressMain(c, 'Escape');

  assert.equal(isOpen.get(), false);
  assert.equal(query.get(), '');

  c.disconnectedCallback();
});

// ─── Behavior 14 ────────────────────────────────────────────────────────────
test('cr-command-palette: Enter on input-type action shows inline arg input', () => {
  resetStore();
  register(makeAction('inp1', {
    label: 'Go to Case',
    kind: 'input',
    input: { placeholder: 'Enter case ref…' },
    handler: () => {},
  }));
  const c = makeEl();
  openPalette();

  pressMain(c, 'ArrowDown');
  pressMain(c, 'Enter');

  assert.equal(isOpen.get(), true, 'palette stays open waiting for arg');
  assert.ok(overlay(c).querySelector('.palette-arg-input'), 'arg input rendered');

  c.disconnectedCallback();
});

// ─── Behavior 15 ────────────────────────────────────────────────────────────
test('cr-command-palette: submitting arg input calls handler with value and closes', () => {
  resetStore();
  /** @type {string|undefined} */
  let received;
  register(makeAction('inp2', {
    label: 'Go to Case',
    kind: 'input',
    input: { placeholder: 'Enter case ref…' },
    handler: (/** @type {string|undefined} */ v) => { received = v; },
  }));
  const c = makeEl();
  openPalette();

  pressMain(c, 'ArrowDown');
  pressMain(c, 'Enter');

  const argInput = overlay(c).querySelector('.palette-arg-input');
  assert.ok(argInput, 'arg input present');
  argInput.value = 'CASE-42';
  // Pass target so the handler can read ev.target.value
  for (const h of (argInput._listeners['keydown'] ?? [])) {
    h({ key: 'Enter', preventDefault: () => {}, target: argInput });
  }

  assert.equal(received, 'CASE-42');
  assert.equal(isOpen.get(), false, 'palette closed after arg submit');

  c.disconnectedCallback();
});

// ─── Behavior 16 ────────────────────────────────────────────────────────────
test('cr-command-palette: Enter on options-type action renders sub-list', () => {
  resetStore();
  register(makeAction('opt1', {
    label: 'Set Response',
    kind: 'options',
    options: [{ label: 'Pass', value: 'pass' }, { label: 'Fail', value: 'fail' }],
    handler: () => {},
  }));
  const c = makeEl();
  openPalette();

  pressMain(c, 'ArrowDown');
  pressMain(c, 'Enter');

  assert.equal(isOpen.get(), true, 'palette stays open in options mode');
  const optItems = overlay(c).querySelectorAll('.palette-option');
  assert.equal(optItems.length, 2);
  assert.ok(text(optItems[0]).includes('Pass'));

  c.disconnectedCallback();
});

// ─── Behavior 17 ────────────────────────────────────────────────────────────
test('cr-command-palette: selecting options item calls handler with value and closes', () => {
  resetStore();
  /** @type {string|undefined} */
  let received;
  register(makeAction('opt2', {
    label: 'Set Response',
    kind: 'options',
    options: [{ label: 'Pass', value: 'pass' }, { label: 'Fail', value: 'fail' }],
    handler: (/** @type {string|undefined} */ v) => { received = v; },
  }));
  const c = makeEl();
  openPalette();

  // Enter options mode
  pressMain(c, 'ArrowDown');
  pressMain(c, 'Enter');

  // Move to first option and select it
  pressMain(c, 'ArrowDown');
  pressMain(c, 'Enter');

  assert.equal(received, 'pass');
  assert.equal(isOpen.get(), false);

  c.disconnectedCallback();
});

// ─── Behavior 18 ────────────────────────────────────────────────────────────
test('cr-command-palette: Ctrl+K opens palette via document keydown', () => {
  resetStore();
  const c = makeEl();

  fireKeydown({ key: 'k', ctrlKey: true, metaKey: false, preventDefault: () => {} });
  assert.equal(isOpen.get(), true);

  c.disconnectedCallback();
});

test('cr-command-palette: disconnectedCallback removes document keydown listener', () => {
  resetStore();
  const before = G.document._keydownListeners.length;
  const c = makeEl();
  assert.equal(G.document._keydownListeners.length, before + 1);
  c.disconnectedCallback();
  assert.equal(G.document._keydownListeners.length, before);
});
