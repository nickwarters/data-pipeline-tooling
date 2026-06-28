// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRBankRail } = await import('../src/question-bank/cr-bank-rail.js');
const { _resetStore, filters, cases, isDirty } =
  await import('../src/question-bank/question-bank-store.js');

test('CRBankRail: renders 4 sections: stat, categories, view, legend', () => {
  _resetStore();
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  assert.equal(aside._children.length, 4);
  e.disconnectedCallback();
});

test('CRBankRail: clicking the "All" chip resets category', () => {
  _resetStore();
  filters.set({
    category: 'Opening',
    showDeprecated: true,
    conditionalOnly: false,
  });
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catSection = aside._children[1];
  const catList = catSection._children[1];
  const allChip = catList._children[0];
  allChip._listeners.click[0]();
  assert.equal(filters.get().category, null);
  e.disconnectedCallback();
});

test('CRBankRail: clicking a category chip sets category', () => {
  _resetStore();
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catSection = aside._children[1];
  const catList = catSection._children[1];
  // The first non-"All" chip is the first category
  const firstCat = catList._children[1];
  firstCat._listeners.click[0]();
  assert.ok(filters.get().category);
  e.disconnectedCallback();
});

test('CRBankRail: uncategorised questions get an "Uncategorised" chip', () => {
  _resetStore();
  cases.set({
    'example-review': {
      label: 'L',
      slug: 'example-review',
      eligibleGroups: [],
      questions: [
        /** @type {any} */ ({
          id: 'q',
          text: '',
          responseType: 'yes-no-na',
          deprecated: false,
        }),
      ],
    },
  });
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catList = aside._children[1]._children[1];
  // All + Uncategorised
  assert.equal(catList._children.length, 2);
  e.disconnectedCallback();
});

test('CRBankRail: toggles flip filter state', () => {
  _resetStore();
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const view = aside._children[2];
  const depToggleRow = view._children[1];
  const condToggleRow = view._children[2];
  depToggleRow._children[1]._listeners.click[0]();
  assert.equal(filters.get().showDeprecated, false);
  condToggleRow._children[1]._listeners.click[0]();
  assert.equal(filters.get().conditionalOnly, true);
  e.disconnectedCallback();
});

test('CRBankRail: category chips expose move controls but All does not', () => {
  _resetStore();
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catList = aside._children[1]._children[1];
  const allChip = catList._children[0];
  const firstCat = catList._children[1];

  assert.equal(allChip.querySelectorAll('button').length, 0);
  assert.equal(firstCat.querySelectorAll('button').length, 2);
  e.disconnectedCallback();
});

test('CRBankRail: category move buttons reorder category blocks and mark dirty', () => {
  _resetStore();
  cases.set({
    'example-review': {
      label: 'L',
      slug: 'example-review',
      eligibleGroups: [],
      questions: [
        {
          id: 'a1',
          text: 'A1',
          category: 'A',
          responseType: 'yes-no-na',
          deprecated: false,
        },
        {
          id: 'a2',
          text: 'A2',
          category: 'A',
          responseType: 'yes-no-na',
          deprecated: false,
        },
        {
          id: 'b1',
          text: 'B1',
          category: 'B',
          responseType: 'yes-no-na',
          deprecated: false,
        },
        {
          id: 'c1',
          text: 'C1',
          category: 'C',
          responseType: 'yes-no-na',
          deprecated: false,
        },
      ],
    },
  });
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catList = aside._children[1]._children[1];
  const cChip = catList._children[3];
  const cMeta = cChip._children[1];
  const moveUp = cMeta._children[1];
  assert.equal(moveUp.disabled, false);

  moveUp._listeners.click[0]({ stopPropagation() {} });
  assert.deepEqual(
    cases.get()['example-review'].questions.map((q) => q.id),
    ['a1', 'a2', 'c1', 'b1']
  );
  assert.equal(isDirty.get(), true);
  e.disconnectedCallback();
});

test('CRBankRail: first and last category move controls are disabled', () => {
  _resetStore();
  const e = new CRBankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catList = aside._children[1]._children[1];
  const firstCatMeta = catList._children[1]._children[1];
  const lastCatMeta =
    catList._children[catList._children.length - 1]._children[1];

  assert.equal(firstCatMeta._children[1].disabled, true);
  assert.equal(lastCatMeta._children[2].disabled, true);
  e.disconnectedCallback();
});
