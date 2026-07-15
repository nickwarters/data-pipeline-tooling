// @ts-check
import { resetStoreWithExampleReview } from './_bank-store-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORABankDock } = await import('../src/question-bank/cora-bank-dock.js');
const { _resetStore, drawerOpen, commit } =
  await import('../src/question-bank/question-bank-store.js');

test('CORABankDock: shows active / deprecated / conditional / pending stats', () => {
  resetStoreWithExampleReview();
  const e = new CORABankDock();
  e.connectedCallback();
  const dock = /** @type {any} */ (e)._children[0];
  const status = dock._children[0];
  assert.equal(status._children.length, 4);
  e.disconnectedCallback();
});

test('CORABankDock: 0 changes → "0 changes"; >1 → plural', () => {
  resetStoreWithExampleReview();
  const e = new CORABankDock();
  e.connectedCallback();
  let dock = /** @type {any} */ (e)._children[0];
  let pendingStat = dock._children[0]._children[3];
  assert.equal(pendingStat._children[1].textContent, '0 changes');

  commit((t) => {
    const b = t['example-review'];
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
  assert.equal(pendingStat._children[1].textContent, '2 changes');
  e.disconnectedCallback();
});

test('CORABankDock: Preview + Submit buttons open the drawer', () => {
  resetStoreWithExampleReview();
  const e = new CORABankDock();
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

test('CORABankDock: pluralises "change" with singular form on 1', () => {
  resetStoreWithExampleReview();
  commit((t) => {
    t['example-review'].questions[0].text = 'edited just once';
  });
  const e = new CORABankDock();
  e.connectedCallback();
  const dock = /** @type {any} */ (e)._children[0];
  const pendingStat = dock._children[0]._children[3];
  assert.equal(pendingStat._children[1].textContent, '1 change');
  e.disconnectedCallback();
});
