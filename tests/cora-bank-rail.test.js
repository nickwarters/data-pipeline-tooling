// @ts-check
import { resetStoreWithExampleReview } from './_bank-store-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  getByText,
  queryAllByRole,
  queryAllByTag,
} from './helpers/semantic-dom.js';
installDom();

const { CORABankRail } =
  await import('../src/pages/question-bank/cora-bank-rail.js');
const { _resetStore, filters, cases, isDirty, railOpen } =
  await import('../src/pages/question-bank/question-bank-store.js');

test('CORABankRail: renders 4 sections: stat, categories, view, legend', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const aside = getByTag(e, 'aside');
  assert.deepEqual(
    queryAllByTag(aside, 'h3').map((heading) => heading.textContent),
    ['At a Glance', 'Filter by Grouping', 'View', 'Legend']
  );
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
  fireEvent(getByText(e, 'All'), 'click');
  assert.equal(filters.get().category, null);
  e.disconnectedCallback();
});

test('CORABankRail: clicking a group chip sets the questionGroup filter', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const firstGroupName =
    cases.get()['example-review'].questions[0].questionGroup;
  assert.ok(firstGroupName);
  fireEvent(getByText(e, firstGroupName), 'click');
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
  assert.equal(getByText(e, 'All').textContent, 'All');
  assert.equal(getByText(e, 'Uncategorised').textContent, 'Uncategorised');
  e.disconnectedCallback();
});

test('CORABankRail: toggles flip filter state', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const deprecatedToggle = getByText(
    e,
    'Show deprecated'
  ).parentNode.querySelector('.toggle');
  fireEvent(deprecatedToggle, 'click');
  assert.equal(filters.get().showDeprecated, false);
  const conditionalToggle = getByText(
    e,
    'Show conditional only'
  ).parentNode.querySelector('.toggle');
  fireEvent(conditionalToggle, 'click');
  assert.equal(filters.get().conditionalOnly, true);
  e.disconnectedCallback();
});

test('CORABankRail: group chips expose move controls but All does not', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const allChip = getByText(e, 'All').parentNode;
  assert.equal(allChip.querySelectorAll('button').length, 0);
  assert.ok(
    queryAllByRole(e, 'button', { name: /question group (?:up|down)$/ })
      .length >= 2
  );
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
  const moveUp = getByRole(e, 'button', { name: 'Move C category up' });
  assert.equal(moveUp.disabled, false);

  fireEvent(moveUp, 'click', { stopPropagation() {} });
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
  const moveDown = getByRole(e, 'button', { name: 'Move A category down' });
  assert.equal(moveDown.disabled, false);

  fireEvent(moveDown, 'click', { stopPropagation() {} });
  assert.deepEqual(
    cases.get()['example-review'].questions.map((q) => q.id),
    ['b1', 'a1']
  );
  assert.equal(isDirty.get(), true);
  e.disconnectedCallback();
});

test('CORABankRail: first and last group move controls are disabled', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const moveUp = queryAllByRole(e, 'button', {
    name: /question group up$/,
  });
  const moveDown = queryAllByRole(e, 'button', {
    name: /question group down$/,
  });
  assert.equal(moveUp[0].disabled, true);
  assert.equal(moveDown.at(-1).disabled, true);
  e.disconnectedCallback();
});

test('CORABankRail: renders a pop-over toggle button and backdrop', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  const toggle = getByRole(e, 'button', { name: '☰ Filters' });
  const backdrop = e.querySelector('.rail-backdrop');
  assert.ok(backdrop);
  assert.equal(toggle.className, 'rail-toggle');
  assert.equal(toggle.getAttribute('aria-controls'), 'bank-rail-panel');
  assert.equal(backdrop.className, 'rail-backdrop');
  e.disconnectedCallback();
});

test('CORABankRail: toggle button opens the pop-over and reflects aria-expanded', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  let toggle = getByRole(e, 'button', { name: '☰ Filters' });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(getByTag(e, 'aside').className, 'rail');

  fireEvent(toggle, 'click');
  assert.equal(railOpen.get(), true);
  // Re-rendered: aside now carries the open class, aria-expanded flips.
  toggle = getByRole(e, 'button', { name: '✕ Filters' });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(getByTag(e, 'aside').className, 'rail open');

  // Toggling again closes it.
  fireEvent(toggle, 'click');
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: backdrop click closes the pop-over', () => {
  resetStoreWithExampleReview();
  railOpen.set(true);
  const e = new CORABankRail();
  e.connectedCallback();
  const backdrop = e.querySelector('.rail-backdrop');
  assert.ok(backdrop);
  assert.equal(backdrop.className, 'rail-backdrop open');
  fireEvent(backdrop, 'click');
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: backdrop click is a no-op when already closed', () => {
  resetStoreWithExampleReview();
  const e = new CORABankRail();
  e.connectedCallback();
  fireEvent(e.querySelector('.rail-backdrop'), 'click');
  assert.equal(railOpen.get(), false);
  e.disconnectedCallback();
});

test('CORABankRail: selecting a group chip closes the pop-over', () => {
  resetStoreWithExampleReview();
  railOpen.set(true);
  const e = new CORABankRail();
  e.connectedCallback();
  const firstGroupName =
    cases.get()['example-review'].questions[0].questionGroup;
  assert.ok(firstGroupName);
  fireEvent(getByText(e, firstGroupName), 'click');
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
  fireEvent(getByText(e, 'All'), 'click');
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
  const moveUp = getByRole(e, 'button', {
    name: 'Move Discovery question group up',
  });
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
  assert.equal(getByText(e, 'A').textContent, 'A');
  assert.equal(getByText(e, 'B').textContent, 'B');
  assert.equal(
    queryAllByRole(e, 'button', { name: /question group (?:up|down)$/ })
      .length,
    0
  );
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
  // Clicking the Cat1 heading filters by category only.
  fireEvent(getByText(e, 'Cat1'), 'click');
  assert.equal(filters.get().category, 'Cat1');
  assert.equal(filters.get().questionGroup, null);
  // Clicking G2 filters by its category + group pair.
  fireEvent(getByText(e, 'G2'), 'click');
  assert.equal(filters.get().category, 'Cat2');
  assert.equal(filters.get().questionGroup, 'G2');
  e.disconnectedCallback();
});
