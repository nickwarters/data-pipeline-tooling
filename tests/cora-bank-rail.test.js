// @ts-check
import { resetStoreWithExampleReview } from './_bank-store-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORABankRail } =
  await import('../src/pages/question-bank/cora-bank-rail.js');
const { _resetStore, filters, cases, isDirty, railOpen } =
  await import('../src/pages/question-bank/question-bank-store.js');

test('CORABankRail: renders 4 sections: stat, categories, view, legend', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  assert.equal(aside._children.length, 4);
  e.disconnectedCallback();
});

test('CORABankRail: clicking the "All" chip resets category', () => {
  resetStoreWithExampleReview();
  filters.set({
    category: null,
    questionGroup: 'Opening',
    showDeprecated: true,
    conditionalOnly: false,
  });
  const e = new CORABankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catSection = aside._children[1];
  const catList = catSection._children[1];
  const allChip = catList._children[0];
  allChip._listeners.click[0]();
  assert.equal(filters.get().category, null);
  e.disconnectedCallback();
});

test('CORABankRail: clicking a group chip sets the questionGroup filter', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catSection = aside._children[1];
  const catList = catSection._children[1];
  // The example bank has Question Groups but no categories, so the first
  // non-"All" chip is the first Question Group.
  const firstGroup = catList._children[1];
  firstGroup._listeners.click[0]();
  assert.ok(filters.get().questionGroup);
  assert.equal(filters.get().category, null);
  e.disconnectedCallback();
});

test('CORABankRail: uncategorised questions get an "Uncategorised" chip', () => {
  resetStoreWithExampleReview();
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
  const e = new CORABankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catList = aside._children[1]._children[1];
  // All + Uncategorised
  assert.equal(catList._children.length, 2);
  e.disconnectedCallback();
});

test('CORABankRail: toggles flip filter state', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
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

test('CORABankRail: category chips expose move controls but All does not', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const aside = /** @type {any} */ (e)._children[0];
  const catList = aside._children[1]._children[1];
  const allChip = catList._children[0];
  const firstCat = catList._children[1];

  assert.equal(allChip.querySelectorAll('button').length, 0);
  assert.equal(firstCat.querySelectorAll('button').length, 2);
  e.disconnectedCallback();
});

test('CORABankRail: category move buttons reorder category blocks and mark dirty', () => {
  resetStoreWithExampleReview();
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
  const e = new CORABankRail();
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

test('CORABankRail: category move-down reorders category blocks and marks dirty', () => {
  resetStoreWithExampleReview();
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
          id: 'b1',
          text: 'B1',
          category: 'B',
          responseType: 'yes-no-na',
          deprecated: false,
        },
      ],
    },
  });
  const e = new CORABankRail();
  e.connectedCallback();
  const catList = /** @type {any} */ (e)._children[0]._children[1]._children[1];
  const aMeta = catList._children[1]._children[1];
  const moveDown = aMeta._children[2];
  assert.equal(moveDown.disabled, false);

  moveDown._listeners.click[0]({ stopPropagation() {} });
  assert.deepEqual(
    cases.get()['example-review'].questions.map((q) => q.id),
    ['b1', 'a1']
  );
  assert.equal(isDirty.get(), true);
  e.disconnectedCallback();
});

test('CORABankRail: first and last category move controls are disabled', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
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

test('CORABankRail: renders a pop-over toggle button and backdrop', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const toggle = /** @type {any} */ (e)._children[1];
  const backdrop = /** @type {any} */ (e)._children[2];
  assert.equal(toggle.className, 'rail-toggle');
  assert.equal(toggle.getAttribute('aria-controls'), 'bank-rail-panel');
  assert.equal(backdrop.className, 'rail-backdrop');
  e.disconnectedCallback();
});

test('CORABankRail: toggle button opens the pop-over and reflects aria-expanded', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  let toggle = /** @type {any} */ (e)._children[1];
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(/** @type {any} */ (e)._children[0].className, 'rail');

  toggle._listeners.click[0]();
  assert.equal(railOpen.get(), true);
  // Re-rendered: aside now carries the open class, aria-expanded flips.
  toggle = /** @type {any} */ (e)._children[1];
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(/** @type {any} */ (e)._children[0].className, 'rail open');

  // Toggling again closes it.
  toggle._listeners.click[0]();
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: backdrop click closes the pop-over', () => {
  resetStoreWithExampleReview();
  railOpen.set(true);
  const e = new CORABankRail();
  e.connectedCallback();
  const backdrop = /** @type {any} */ (e)._children[2];
  assert.equal(backdrop.className, 'rail-backdrop open');
  backdrop._listeners.click[0]();
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: backdrop click is a no-op when already closed', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const backdrop = /** @type {any} */ (e)._children[2];
  backdrop._listeners.click[0]();
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: selecting a group chip closes the pop-over', () => {
  resetStoreWithExampleReview();
  railOpen.set(true);
  const e = new CORABankRail();
  e.connectedCallback();
  const catList = /** @type {any} */ (e)._children[0]._children[1]._children[1];
  const firstGroup = catList._children[1];
  firstGroup._listeners.click[0]();
  assert.ok(filters.get().questionGroup);
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: the "All" chip also closes the pop-over', () => {
  resetStoreWithExampleReview();
  filters.set({
    category: null,
    questionGroup: 'Opening',
    showDeprecated: true,
    conditionalOnly: false,
  });
  railOpen.set(true);
  const e = new CORABankRail();
  e.connectedCallback();
  const catList = /** @type {any} */ (e)._children[0]._children[1]._children[1];
  catList._children[0]._listeners.click[0]();
  assert.equal(filters.get().category, null);
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: group move buttons reorder groups within their category and mark dirty', () => {
  resetStoreWithExampleReview();
  // The example bank has Question Groups only (no categories): Opening,
  // Discovery, Resolution. Move Discovery up within the implicit category.
  const e = new CORABankRail();
  e.connectedCallback();
  const catList = /** @type {any} */ (e)._children[0]._children[1]._children[1];
  const discoveryMeta = catList._children[2]._children[1];
  const moveUp = discoveryMeta._children[1];
  assert.equal(moveUp.disabled, false);

  moveUp._listeners.click[0]({ stopPropagation() {} });
  const groups = cases
    .get()
    ['example-review'].questions.map((/** @type {any} */ q) => q.questionGroup);
  assert.equal(groups[0], 'Discovery');
  assert.equal(isDirty.get(), true);
  e.disconnectedCallback();
});

test('CORABankRail: with categories only, no redundant Uncategorised group chips render', () => {
  resetStoreWithExampleReview();
  cases.set({
    'example-review': {
      label: 'L',
      slug: 'example-review',
      eligibleGroups: [],
      questions: [
        /** @type {any} */ ({
          id: 'a1',
          text: 'A1',
          category: 'A',
          responseType: 'yes-no-na',
          deprecated: false,
        }),
        /** @type {any} */ ({
          id: 'b1',
          text: 'B1',
          category: 'B',
          responseType: 'yes-no-na',
          deprecated: false,
        }),
      ],
    },
  });
  const e = new CORABankRail();
  e.connectedCallback();
  const catList = /** @type {any} */ (e)._children[0]._children[1]._children[1];
  // All + category A + category B, no group chips
  assert.equal(catList._children.length, 3);
  e.disconnectedCallback();
});

test('CORABankRail: nested category and group chips filter by the pair', () => {
  resetStoreWithExampleReview();
  cases.set({
    'example-review': {
      label: 'L',
      slug: 'example-review',
      eligibleGroups: [],
      questions: [
        /** @type {any} */ ({
          id: 'a1',
          text: 'A1',
          category: 'Cat1',
          questionGroup: 'G1',
          responseType: 'yes-no-na',
          deprecated: false,
        }),
        /** @type {any} */ ({
          id: 'b1',
          text: 'B1',
          category: 'Cat2',
          questionGroup: 'G2',
          responseType: 'yes-no-na',
          deprecated: false,
        }),
      ],
    },
  });
  const e = new CORABankRail();
  e.connectedCallback();
  const catList = /** @type {any} */ (e)._children[0]._children[1]._children[1];
  // [All, Cat1, G1, Cat2, G2]
  assert.equal(catList._children.length, 5);
  // Clicking the Cat1 heading filters by category only.
  catList._children[1]._listeners.click[0]();
  assert.equal(filters.get().category, 'Cat1');
  assert.equal(filters.get().questionGroup, null);
  // Clicking G2 filters by its category + group pair.
  catList._children[4]._listeners.click[0]();
  assert.equal(filters.get().category, 'Cat2');
  assert.equal(filters.get().questionGroup, 'G2');
  e.disconnectedCallback();
});
