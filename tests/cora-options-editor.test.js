// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { commitSpy } from './_example-review-fixture.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
  queryAllByText,
} from './helpers/semantic-dom.js';
installDom();

const {
  CORAOptionsEditor,
  OptionsEditor,
  effectiveOptions,
  MAX_OPTION_LENGTH,
} = await import('../src/components/base/cora-options-editor.js');
const OUTCOMES = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

/**
 * Mount a CORAOptionsEditor with the outcome vocabulary and an onCommit spy
 * passed as props (no store involved).
 * @param {any} q
 */
function mount(q) {
  const e = new CORAOptionsEditor();
  e.question = q;
  e.outcomeOptions = OUTCOMES.map((o) => ({ ...o }));
  e.onCommit = commitSpy();
  e.connectedCallback();
  return e;
}

test('OptionsEditor: renders nothing when no question set', () => {
  assert.equal(
    OptionsEditor({
      question: null,
      outcomeOptions: OUTCOMES,
      onRemoveOption: () => {},
      onAddOption: () => {},
      onSetOptionOutcome: () => {},
    }),
    undefined
  );
});

test('OptionsEditor: single-choice renders a row per option + add button', () => {
  const node = OptionsEditor({
    question: { responseType: 'single-choice', options: ['A', 'B'] },
    outcomeOptions: OUTCOMES,
    onRemoveOption: () => {},
    onAddOption: () => {},
    onSetOptionOutcome: () => {},
  });
  assert.equal(queryAllByRole(node, 'combobox').length, 2);
  assert.equal(queryAllByText(node, '×').length, 2);
  assert.equal(
    getByRole(node, 'button', { name: '+ option' }).tagName,
    'BUTTON'
  );
});

test('effectiveOptions: yes-no-na has fixed options and no add/remove', () => {
  const eff = effectiveOptions(
    { responseType: 'yes-no-na', optionOutcomes: { No: 'fail' } },
    OUTCOMES
  );
  // N/A is universal, not part of the fixed yes-no-na options (#390 Part 2).
  assert.deepEqual(eff.options, ['Yes', 'No']);
  assert.equal(eff.editable, false);
  assert.equal(eff.outcomeReadOnly, false);
  assert.equal(eff.mapping.No, 'fail');
});

test('effectiveOptions: outcome-type derives read-only options mapped to themselves', () => {
  const eff = effectiveOptions({ responseType: 'outcome' }, OUTCOMES);
  assert.deepEqual(eff.options, ['Pass', 'Fail']);
  assert.equal(eff.editable, false);
  assert.equal(eff.outcomeReadOnly, true);
  assert.deepEqual(eff.mapping, { Pass: 'pass', Fail: 'fail' });
});

test('OptionsEditor: yes-no-na shows no add button but editable outcome selects', () => {
  const node = OptionsEditor({
    question: { responseType: 'yes-no-na' },
    outcomeOptions: OUTCOMES,
    onRemoveOption: () => {},
    onAddOption: () => {},
    onSetOptionOutcome: () => {},
  });
  const selects = queryAllByRole(node, 'combobox');
  assert.equal(selects.length, 2);
  assert.equal(queryAllByText(node, '×').length, 0);
  assert.equal(queryAllByRole(node, 'button').length, 0);
  assert.equal(selects[0].disabled, false);
});

test('OptionsEditor: outcome-type outcome selects are disabled (read-only)', () => {
  const node = OptionsEditor({
    question: { responseType: 'outcome' },
    outcomeOptions: OUTCOMES,
    onRemoveOption: () => {},
    onAddOption: () => {},
    onSetOptionOutcome: () => {},
  });
  assert.equal(queryAllByRole(node, 'combobox')[0].disabled, true);
});

test('CORAOptionsEditor: renders nothing when no question set', () => {
  const e = new CORAOptionsEditor();
  e.connectedCallback();
  assert.equal(e.childElementCount, 0);
});

test('CORAOptionsEditor: clicking tag-x removes the option and its outcome mapping', () => {
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A', 'B'],
    optionOutcomes: { A: 'fail' },
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(queryAllByText(e, '×')[0], 'click');
  assert.deepEqual(q.options, ['B']);
  assert.equal('optionOutcomes' in q, false);
});

test('CORAOptionsEditor: selecting an option outcome writes optionOutcomes', () => {
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A', 'B'],
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(queryAllByRole(e, 'combobox')[0], 'change', {
    target: { value: 'fail' },
  });
  assert.deepEqual(q.optionOutcomes, { A: 'fail' });
});

test('CORAOptionsEditor: clearing an option outcome deletes the mapping', () => {
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    optionOutcomes: { A: 'fail' },
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(queryAllByRole(e, 'combobox')[0], 'change', {
    target: { value: '' },
  });
  assert.equal('optionOutcomes' in q, false);
});

test('CORAOptionsEditor: add button calls prompt and appends', () => {
  /** @type {any} */ (globalThis).prompt = () => 'Maybe';
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(getByRole(e, 'button', { name: '+ option' }), 'click');
  assert.deepEqual(q.options, ['A', 'Maybe']);
});

test('CORAOptionsEditor: add button ignores empty prompt value', () => {
  /** @type {any} */ (globalThis).prompt = () => '   ';
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(getByRole(e, 'button', { name: '+ option' }), 'click');
  assert.deepEqual(q.options, ['A']);
});

test('CORAOptionsEditor: add button initialises options array if missing', () => {
  /** @type {any} */ (globalThis).prompt = () => 'X';
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(getByRole(e, 'button', { name: '+ option' }), 'click');
  assert.deepEqual(q.options, ['X']);
});

test('MAX_OPTION_LENGTH is exported as 250', () => {
  assert.equal(MAX_OPTION_LENGTH, 250);
});

test('CORAOptionsEditor: add button rejects an option longer than 250 characters and alerts', () => {
  const tooLong = 'x'.repeat(MAX_OPTION_LENGTH + 1);
  /** @type {any} */ (globalThis).prompt = () => tooLong;
  /** @type {any[]} */
  const alerts = [];
  /** @type {any} */ (globalThis).alert = (/** @type {any} */ msg) =>
    alerts.push(msg);
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(getByRole(e, 'button', { name: '+ option' }), 'click');
  assert.deepEqual(q.options, ['A']);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /250/);
});

test('CORAOptionsEditor: add button accepts an option of exactly 250 characters', () => {
  const exactly250 = 'y'.repeat(MAX_OPTION_LENGTH);
  /** @type {any} */ (globalThis).prompt = () => exactly250;
  /** @type {any} */ (globalThis).alert = () => {
    throw new Error('alert should not be called for a 250-char option');
  };
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(getByRole(e, 'button', { name: '+ option' }), 'click');
  assert.deepEqual(q.options, ['A', exactly250]);
});

test('CORAOptionsEditor: tolerates missing global prompt', () => {
  /** @type {any} */ (globalThis).prompt = undefined;
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: [],
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(getByRole(e, 'button', { name: '+ option' }), 'click');
  assert.deepEqual(q.options, []);
});

test('CORAOptionsEditor: mutations flow through the onCommit prop', () => {
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    deprecated: false,
  };
  const e = mount(q);
  fireEvent(queryAllByRole(e, 'combobox')[0], 'change', {
    target: { value: 'fail' },
  });
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  assert.deepEqual(q.optionOutcomes, { A: 'fail' });
});
