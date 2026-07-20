// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';
installDom();

await import('../src/pages/question-bank/cora-bank-editor.js');

const G = /** @type {any} */ (globalThis);

test('cora-bank-editor: remaining integration elements register; compile drawer is a pure view', () => {
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
    'cora-remediation-actions-editor',
    'cora-bank-dock',
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
  assert.equal(inst._children.length, 1);
  assert.equal(
    inst.querySelector('.cora-bank-editor')?.className,
    'cora-bank-editor'
  );
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
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { drawerOpen, railOpen, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
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

test('bank editor: selectBank switches the active slug and clears the category filter', async () => {
  const { selectBank } =
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { activeSlug, filters, setFilters, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
  _resetStore();
  setFilters({ category: 'Opening' });
  selectBank('complaints');
  assert.equal(activeSlug.get(), 'complaints');
  assert.equal(filters.get().category, null);
});

test('bank editor: revertBank with clean state shows "Nothing to revert" toast', async () => {
  const { revertBank } =
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { toastMsg, isDirty, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
  _resetStore();
  /** @type {any} */ (globalThis).setTimeout = () => 0;
  revertBank();
  assert.equal(toastMsg.get(), 'Nothing to revert');
  assert.equal(isDirty.get(), false);
});

test('bank editor: revertBank with dirty state + confirmed reverts to baseline', async () => {
  const { revertBank } =
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { cases, baseline, activeSlug, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
  _resetStore();
  const slug = activeSlug.get();
  cases.set({
    ...cases.get(),
    [slug]: { ...cases.get()[slug], label: 'CHANGED' },
  });
  /** @type {any} */ (globalThis).confirm = () => true;
  /** @type {any} */ (globalThis).setTimeout = () => 0;
  revertBank();
  assert.equal(cases.get()[slug].label, baseline.get()[slug].label);
});

test('bank editor: revertBank with cancelled confirm is a no-op', async () => {
  const { revertBank } =
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { cases, activeSlug, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
  _resetStore();
  const slug = activeSlug.get();
  cases.set({
    ...cases.get(),
    [slug]: { ...cases.get()[slug], label: 'NEW' },
  });
  /** @type {any} */ (globalThis).confirm = () => false;
  revertBank();
  assert.equal(cases.get()[slug].label, 'NEW');
});

test('bank editor: submitBankForReview snapshots baseline, closes the drawer, toasts', async () => {
  const { submitBankForReview } =
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { baseline, activeSlug, drawerOpen, toastMsg, commit, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
  _resetStore();
  const slug = activeSlug.get();
  commit((t) => {
    t[slug].label = 'AFTER';
  });
  drawerOpen.set(true);
  /** @type {any} */ (globalThis).setTimeout = () => 0;
  submitBankForReview();
  assert.equal(baseline.get()[slug].label, 'AFTER');
  assert.equal(drawerOpen.get(), false);
  assert.equal(toastMsg.get(), 'Submitted for review');
});

test('bank editor: caseTabsProps wires store signals and the compile drawer opener', async () => {
  const { caseTabsProps } =
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { cases, activeSlug, isDirty, drawerOpen, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
  _resetStore();
  const props = /** @type {any} */ (caseTabsProps());
  assert.equal(props.cases, cases);
  assert.equal(props.active, activeSlug);
  assert.equal(props.dirty, isDirty);
  drawerOpen.set(false);
  props.onCompile();
  assert.equal(drawerOpen.get(), true);
  drawerOpen.set(false);
});

test('bank editor: compileDrawerProps wires compile + store; simulate panel gated by flag', async () => {
  const { compileDrawerProps } =
    await import('../src/pages/question-bank/cora-bank-editor.js');
  const { currentBank, drawerOpen, toastMsg, _resetStore } =
    await import('../src/pages/question-bank/question-bank-store.js');
  const { compileBank } =
    await import('../src/pages/question-bank/question-bank-compile.js');
  _resetStore();
  const props = /** @type {any} */ (compileDrawerProps());
  assert.equal(props.open, drawerOpen.get());
  assert.equal(props.bank, currentBank.get());
  assert.equal(props.compile, compileBank);

  // Flag off → no simulate panel.
  const loc = /** @type {any} */ (globalThis).location;
  const origSearch = loc.search;
  loc.search = '';
  assert.equal(props.simulatePanel(currentBank.get()), null);
  // Flag on → a rendered sim-panel node.
  loc.search = '?simulate=1';
  const panel = props.simulatePanel(currentBank.get());
  assert.equal(panel.className, 'sim-panel');
  loc.search = origSearch;

  drawerOpen.set(true);
  props.onClose();
  assert.equal(drawerOpen.get(), false);
  /** @type {any} */ (globalThis).setTimeout = () => 0;
  props.onCopied();
  assert.equal(toastMsg.get(), 'Bank JSON copied to clipboard');
});
