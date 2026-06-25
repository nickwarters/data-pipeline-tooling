// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_bank-dom-stub.js';
installDom();

await import('../src/question-bank/cr-bank-editor.js');

const G = /** @type {any} */ (globalThis);

test('cr-bank-editor: all 15 custom elements register', () => {
  const names = [
    'cr-bank-editor',
    'cr-case-tabs',
    'cr-bank-rail',
    'cr-bank-list',
    'cr-question-card',
    'cr-question-labels',
    'cr-wording-editor',
    'cr-options-editor',
    'cr-showwhen-editor',
    'cr-showwhen-group',
    'cr-showwhen-leaf',
    'cr-remediation-editor',
    'cr-bank-dock',
    'cr-compile-drawer',
    'cr-toast',
  ];
  for (const n of names) {
    assert.ok(G.customElements._registry[n], `${n} should be registered`);
  }
});

test('cr-bank-editor: mounts shell and registers keydown handler', () => {
  const Cls = G.customElements._registry['cr-bank-editor'];
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

test('cr-bank-editor: disconnectedCallback with no key handler is safe', () => {
  const Cls = G.customElements._registry['cr-bank-editor'];
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
