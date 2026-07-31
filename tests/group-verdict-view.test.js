// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const {
  GroupVerdictControl,
  groupVerdictTargets,
  groupVerdictValue,
  questionGroupOf,
} = await import('../src/pages/cora-case-review/group-verdict-view.js');
const { NA_VALUE } = await import('../src/lib/response-options.js');

const OPTIONS = ['Good', 'Poor', NA_VALUE];

/** @param {any} overrides */
function control(overrides = {}) {
  return GroupVerdictControl({
    questionGroup: 'Alpha',
    options: OPTIONS,
    value: '',
    onGroupVerdict: () => {},
    ...overrides,
  });
}

/** @param {string} id @param {string} [group] @returns {any} */
function target(id, group = 'Alpha') {
  return { id, responseType: 'outcome', questionGroup: group };
}

test('the control labels itself and offers a placeholder before every wording', () => {
  const node = control();

  assert.equal(node.tagName?.toLowerCase(), 'label');
  assert.ok(node.className.includes('cora-group-verdict-label'));
  assert.match(node.textContent, /Group verdict/);

  const select = findByClass(node, 'cora-group-verdict');
  assert.equal(
    select.getAttribute('aria-label'),
    'Group verdict for Alpha',
    'the select names the group it acts on'
  );
  assert.deepEqual(
    select._children.map((/** @type {any} */ option) => option.value),
    ['', 'Good', 'Poor', NA_VALUE]
  );
  assert.match(select._children[0].textContent, /Set group verdict/);
});

test('choosing a wording reports it once for the group', () => {
  /** @type {any[]} */
  const calls = [];
  const node = control({
    onGroupVerdict: (/** @type {any[]} */ ...args) => calls.push(args),
  });
  const select = findByClass(node, 'cora-group-verdict');

  select.value = 'Poor';
  fireEvent(select, 'change');

  assert.deepEqual(calls, [['Alpha', 'Poor']]);
});

test('re-selecting the placeholder reports nothing', () => {
  /** @type {any[]} */
  const calls = [];
  const node = control({
    value: 'Poor',
    onGroupVerdict: (/** @type {any[]} */ ...args) => calls.push(args),
  });
  const select = findByClass(node, 'cora-group-verdict');

  select.value = '';
  fireEvent(select, 'change');

  assert.deepEqual(calls, [], 'the blank option is not a verdict');
});

test('the displayed verdict is the wording the answered Questions agree on', () => {
  assert.equal(
    groupVerdictValue([target('v1'), target('v2')], {
      v1: { value: 'Good' },
      v2: { value: 'Good' },
    }),
    'Good'
  );
});

test('the control blanks when the group disagrees or holds no Answer yet', () => {
  assert.equal(
    groupVerdictValue([target('v1'), target('v2')], {
      v1: { value: 'Good' },
      v2: { value: 'Poor' },
    }),
    ''
  );
  assert.equal(groupVerdictValue([target('v1')], {}), '');
});

test('a verdict that reveals a further Question still shows the chosen wording', () => {
  // The revealed Question is unanswered by design — the verdict never fills it
  // in — so requiring every Question to agree would blank the control the
  // instant a verdict widened its own group.
  assert.equal(
    groupVerdictValue([target('v1'), target('v2'), target('v3')], {
      v1: { value: 'Poor' },
      v2: { value: 'Poor' },
    }),
    'Poor'
  );
});

// --- groupVerdictTargets ----------------------------------------------------

/** @type {any[]} */
const catalogue = [
  { id: 'a1', responseType: 'outcome', questionGroup: 'Alpha' },
  { id: 'a2', responseType: 'outcome', questionGroup: 'Alpha' },
  { id: 'a3', responseType: 'yes-no-na', questionGroup: 'Alpha' },
  {
    id: 'a4',
    responseType: 'outcome',
    questionGroup: 'Alpha',
    deprecated: true,
  },
  { id: 'b1', responseType: 'outcome', questionGroup: 'Beta' },
  { id: 'u1', responseType: 'outcome' },
];

test('groupVerdictTargets selects only the named group', () => {
  assert.deepEqual(
    groupVerdictTargets(catalogue, 'Beta').map((q) => q.id),
    ['b1']
  );
});

test('groupVerdictTargets skips questions whose response type is not an Outcome', () => {
  assert.equal(
    groupVerdictTargets(catalogue, 'Alpha').some((q) => q.id === 'a3'),
    false
  );
});

test('groupVerdictTargets skips deprecated Question Definitions', () => {
  assert.deepEqual(
    groupVerdictTargets(catalogue, 'Alpha').map((q) => q.id),
    ['a1', 'a2']
  );
});

test('an ungrouped Question Definition belongs to General', () => {
  assert.equal(questionGroupOf(/** @type {any} */ ({ id: 'u1' })), 'General');
  assert.deepEqual(
    groupVerdictTargets(catalogue, 'General').map((q) => q.id),
    ['u1']
  );
});
