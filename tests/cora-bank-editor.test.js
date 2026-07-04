// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';
installDom();

await import('../src/question-bank/cora-bank-editor.js');

const G = /** @type {any} */ (globalThis);

test('cora-bank-editor: all 16 custom elements register', () => {
  const names = [
    'cora-bank-editor',
    'cora-case-tabs',
    'cora-bank-rail',
    'cora-bank-list',
    'cora-outcome-options-editor',
    'cora-question-card',
    'cora-question-labels',
    'cora-wording-editor',
    'cora-options-editor',
    'cora-showwhen-editor',
    'cora-showwhen-group',
    'cora-showwhen-leaf',
    'cora-remediation-editor',
    'cora-bank-dock',
    'cora-compile-drawer',
    'cora-toast',
  ];
  for (const n of names) {
    assert.ok(G.customElements._registry[n], `${n} should be registered`);
  }
});

test('cora-bank-editor: mounts shell and registers keydown handler', () => {
  const Cls = G.customElements._registry['cora-bank-editor'];
  const inst = new Cls();
  /** @type {any[]} */
  const keydownHandlers = [];
  /** @type {any} */ (G.document).addEventListener = (
    /** @type {string} */ t,
    /** @type {Function} */ h
  ) => {
    if (t === 'keydown') keydownHandlers.push(h);
  };
  /** @type {any} */ (G.document).removeEventListener = () => {};
  inst.connectedCallback();
  assert.ok(inst._children.length >= 4); // masthead + tabs + main + dock + drawer + toast
  assert.equal(keydownHandlers.length, 1);

  // Simulate ⌘↵ — should open the drawer signal
  const { drawerOpen } = G.__store ?? {}; // not exported globally; just exercise the handler
  keydownHandlers[0]({ metaKey: true, key: 'Enter', preventDefault() {} });
  // Then Esc closes it
  keydownHandlers[0]({ key: 'Escape' });
  // No throw is the assertion.

  inst.disconnectedCallback();
});

test('cora-bank-editor: Escape closes both the drawer and the rail pop-over', async () => {
  const { bindBankEditorKeys } =
    await import('../src/question-bank/cora-bank-editor.js');
  const { drawerOpen, railOpen, _resetStore } =
    await import('../src/question-bank/question-bank-store.js');
  _resetStore();
  drawerOpen.set(true);
  railOpen.set(true);
  /** @type {any[]} */
  const handlers = [];
  const target = {
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ h) => {
      if (t === 'keydown') handlers.push(h);
    },
    removeEventListener: () => {},
  };
  const off = bindBankEditorKeys(target);
  handlers[0]({ key: 'Escape' });
  assert.equal(drawerOpen.get(), false);
  assert.equal(railOpen.get(), false);
  off();
});

test('cora-bank-editor: disconnectedCallback with no key handler is safe', () => {
  const Cls = G.customElements._registry['cora-bank-editor'];
  const inst = new Cls();
  // Don't call connectedCallback; _key is null
  inst.disconnectedCallback();
});

test('StubEl: basic DOM shape sanity', () => {
  const a = new StubEl('div');
  const b = new StubEl('span');
  a.appendChild(b);
  a.replaceChildren(b);
  a.append(new StubEl('em'));
  a.setAttribute('title', 'x');
  assert.equal(a.getAttribute('title'), 'x');
  assert.equal(a.getAttribute('missing'), null);
  a.removeEventListener('click', () => {});
  a.addEventListener('click', () => {});
  a.removeEventListener('click', () => {});
  a.dispatchEvent({});
  a.setSelectionRange(1, 2);
  assert.equal(a.selectionStart, 1);
  const found = a.querySelector('span');
  assert.equal(found, b);
  const all = a.querySelectorAll('span');
  assert.ok(all.length >= 1);
  b.id = 'hit';
  assert.equal(a.querySelector('#hit'), b);
  b.className = 'thing';
  assert.equal(a.querySelector('.thing'), b);
  assert.equal(b.closest('div'), a);
  a.scrollIntoView();
  a.cloneNode();
  a.focus();
});
