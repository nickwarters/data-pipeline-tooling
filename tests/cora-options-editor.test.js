// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAOptionsEditor, OptionsEditor, effectiveOptions } =
  await import('../src/components/base/cora-options-editor.js');
const { _resetStore, currentBank, commit, activeSlug } =
  await import('../src/question-bank/question-bank-store.js');

const OUTCOMES = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

/** Seed the active bank's outcome vocabulary so the editor can offer it. */
function seedOutcomes() {
  _resetStore();
  commit((types) => {
    types[activeSlug.get()].outcomeOptions = OUTCOMES.map((o) => ({ ...o }));
  });
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
  const list = /** @type {any} */ (node)._children[1];
  // 2 option rows + add button
  assert.equal(list._children.length, 3);
  // each row: label, outcome select, remove x
  assert.equal(list._children[0]._children.length, 3);
});

test('effectiveOptions: yes-no-na has fixed options and no add/remove', () => {
  const eff = effectiveOptions(
    { responseType: 'yes-no-na', optionOutcomes: { No: 'fail' } },
    OUTCOMES
  );
  assert.deepEqual(eff.options, ['Yes', 'No', 'NA']);
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
  const list = /** @type {any} */ (node)._children[1];
  // exactly the 3 fixed options, no add button
  assert.equal(list._children.length, 3);
  // row: label + outcome select only (no remove x)
  assert.equal(list._children[0]._children.length, 2);
  const select = list._children[0]._children[1];
  assert.equal(select.disabled, false);
});

test('OptionsEditor: outcome-type outcome selects are disabled (read-only)', () => {
  const node = OptionsEditor({
    question: { responseType: 'outcome' },
    outcomeOptions: OUTCOMES,
    onRemoveOption: () => {},
    onAddOption: () => {},
    onSetOptionOutcome: () => {},
  });
  const list = /** @type {any} */ (node)._children[1];
  const select = list._children[0]._children[1];
  assert.equal(select.disabled, true);
});

test('CORAOptionsEditor: renders nothing when no question set', () => {
  seedOutcomes();
  const e = new CORAOptionsEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAOptionsEditor: clicking tag-x removes the option and its outcome mapping', () => {
  seedOutcomes();
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A', 'B'],
    optionOutcomes: { A: 'fail' },
    deprecated: false,
  };
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const list = /** @type {any} */ (e)._children[0]._children[1];
  const firstRow = list._children[0];
  const xSpan = firstRow._children[2];
  xSpan._listeners.click[0]();
  assert.deepEqual(q.options, ['B']);
  assert.equal('optionOutcomes' in q, false);
});

test('CORAOptionsEditor: selecting an option outcome writes optionOutcomes', () => {
  seedOutcomes();
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A', 'B'],
    deprecated: false,
  };
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const list = /** @type {any} */ (e)._children[0]._children[1];
  const select = list._children[0]._children[1];
  select._listeners.change[0]({ target: { value: 'fail' } });
  assert.deepEqual(q.optionOutcomes, { A: 'fail' });
});

test('CORAOptionsEditor: clearing an option outcome deletes the mapping', () => {
  seedOutcomes();
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    optionOutcomes: { A: 'fail' },
    deprecated: false,
  };
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const list = /** @type {any} */ (e)._children[0]._children[1];
  const select = list._children[0]._children[1];
  select._listeners.change[0]({ target: { value: '' } });
  assert.equal('optionOutcomes' in q, false);
});

test('CORAOptionsEditor: add button calls prompt and appends', () => {
  seedOutcomes();
  /** @type {any} */ (globalThis).prompt = () => 'Maybe';
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    deprecated: false,
  };
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const list = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = list._children[list._children.length - 1];
  addBtn._listeners.click[0]();
  assert.deepEqual(q.options, ['A', 'Maybe']);
});

test('CORAOptionsEditor: add button ignores empty prompt value', () => {
  seedOutcomes();
  /** @type {any} */ (globalThis).prompt = () => '   ';
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A'],
    deprecated: false,
  };
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const list = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = list._children[list._children.length - 1];
  addBtn._listeners.click[0]();
  assert.deepEqual(q.options, ['A']);
});

test('CORAOptionsEditor: add button initialises options array if missing', () => {
  seedOutcomes();
  /** @type {any} */ (globalThis).prompt = () => 'X';
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    deprecated: false,
  };
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const list = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = list._children[list._children.length - 1];
  addBtn._listeners.click[0]();
  assert.deepEqual(q.options, ['X']);
});

test('CORAOptionsEditor: tolerates missing global prompt', () => {
  seedOutcomes();
  /** @type {any} */ (globalThis).prompt = undefined;
  /** @type {any} */
  const q = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: [],
    deprecated: false,
  };
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const list = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = list._children[list._children.length - 1];
  addBtn._listeners.click[0](); // does not throw
  assert.deepEqual(q.options, []);
});
