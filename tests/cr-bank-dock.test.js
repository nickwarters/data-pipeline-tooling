// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRBankDock } = await import('../src/question-bank/cr-bank-dock.js');
const { _resetStore, drawerOpen, commit } =
  await import('../src/question-bank/question-bank-store.js');

test('CRBankDock: shows active / deprecated / conditional / pending stats', () => {
  _resetStore();
  const e = new CRBankDock();
  e.connectedCallback();
  const dock = /** @type {any} */ (e)._children[0];
  const status = dock._children[0];
  assert.equal(status._children.length, 4);
  e.disconnectedCallback();
});

test('CRBankDock: 0 changes → "0 changes"; >1 → plural', () => {
  _resetStore();
  const e = new CRBankDock();
  e.connectedCallback();
  let dock = /** @type {any} */ (e)._children[0];
  let pendingStat = dock._children[0]._children[3];
  assert.ok(pendingStat.innerHTML.includes('0 changes'));

  commit((t) => {
    const b = t['hello-review'];
    b.questions.push({
      id: 'a',
      text: '',
      responseType: 'yes-no-na',
      deprecated: false,
    });
    b.questions.push({
      id: 'b',
      text: '',
      responseType: 'yes-no-na',
      deprecated: false,
    });
  });
  dock = /** @type {any} */ (e)._children[0];
  pendingStat = dock._children[0]._children[3];
  assert.ok(pendingStat.innerHTML.includes('2 changes'));
  e.disconnectedCallback();
});

test('CRBankDock: Preview + Submit buttons open the drawer', () => {
  _resetStore();
  const e = new CRBankDock();
  e.connectedCallback();
  const dock = /** @type {any} */ (e)._children[0];
  const actions = dock._children[1];
  drawerOpen.set(false);
  actions._children[0]._listeners.click[0]();
  assert.equal(drawerOpen.get(), true);
  drawerOpen.set(false);
  actions._children[1]._listeners.click[0]();
  assert.equal(drawerOpen.get(), true);
  e.disconnectedCallback();
});

test('CRBankDock: pluralises "change" with singular form on 1', () => {
  _resetStore();
  commit((t) => {
    t['hello-review'].questions[0].text = 'edited just once';
  });
  const e = new CRBankDock();
  e.connectedCallback();
  const dock = /** @type {any} */ (e)._children[0];
  const pendingStat = dock._children[0]._children[3];
  assert.ok(pendingStat.innerHTML.includes('1 change'));
  assert.ok(!pendingStat.innerHTML.includes('1 changes'));
  e.disconnectedCallback();
});
