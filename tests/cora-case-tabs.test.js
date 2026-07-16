// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORACaseTabs, CaseTabs } =
  await import('../src/components/collections/cora-case-tabs.js');
const { signal } = await import('../src/lib/signal.js');

const TYPES = {
  alpha: { label: 'Alpha', questions: [{ id: 'a' }] },
  beta: { label: 'Beta', questions: [{ id: 'b' }, { id: 'c' }] },
};

/** Mount a CORACaseTabs with signal props + callback spies (no store). */
function mount() {
  const e = new CORACaseTabs();
  e.cases = signal(structuredClone(TYPES));
  e.active = signal('beta');
  e.dirty = signal(false);
  /** @type {string[]} */
  const selected = [];
  let reverted = 0;
  let compiled = 0;
  e.onSelect = (slug) => selected.push(slug);
  e.onRevert = () => {
    reverted += 1;
  };
  e.onCompile = () => {
    compiled += 1;
  };
  e.connectedCallback();
  return {
    e,
    selected,
    reverted: () => reverted,
    compiled: () => compiled,
  };
}

test('CaseTabs: plain function renders one tab per case type', () => {
  const nav = CaseTabs({
    types: TYPES,
    active: 'beta',
    dirty: false,
    onSelect: () => {},
    onRevert: () => {},
    onCompile: () => {},
  });

  const tabsContainer = /** @type {any} */ (nav)._children[1];
  assert.equal(tabsContainer._children.length, 2);
  assert.equal(tabsContainer._children[1].className, 'case-tab active');
});

test('CORACaseTabs: renders from signal props; clicking a tab reports the slug', () => {
  const { e, selected } = mount();
  const nav = /** @type {any} */ (e)._children[0];
  const tabsContainer = nav._children[1];
  assert.equal(tabsContainer._children.length, 2);
  assert.equal(tabsContainer._children[1].className, 'case-tab active');
  tabsContainer._children[0]._listeners.click[0]();
  assert.deepEqual(selected, ['alpha']);
  e.disconnectedCallback();
});

test('CORACaseTabs: re-renders when a passed signal changes', () => {
  const { e } = mount();
  /** @type {any} */ (e.active).set('alpha');
  const nav = /** @type {any} */ (e)._children[0];
  const tabsContainer = nav._children[1];
  assert.equal(tabsContainer._children[0].className, 'case-tab active');
  e.disconnectedCallback();
});

test('CORACaseTabs: Revert and Compile buttons call the supplied callbacks', () => {
  const { e, reverted, compiled } = mount();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  right._children[0]._listeners.click[0]();
  assert.equal(reverted(), 1);
  right._children[1]._listeners.click[0]();
  assert.equal(compiled(), 1);
  e.disconnectedCallback();
});

test('CORACaseTabs: renders empty without props (no store fallback)', () => {
  const e = new CORACaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const tabsContainer = nav._children[1];
  assert.equal(tabsContainer._children.length, 0);
  e.disconnectedCallback();
});
