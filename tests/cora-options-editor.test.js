// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAOptionsEditor, OptionsEditor } =
  await import('../src/components/base/cora-options-editor.js');

test('OptionsEditor: plain function renders nothing when no question set', () => {
  assert.equal(
    OptionsEditor({
      question: null,
      onRemoveOption: () => {},
      onAddOption: () => {},
    }),
    undefined
  );
});

test('OptionsEditor: plain function renders option tags and add button', () => {
  const node = OptionsEditor({
    question: { options: ['A', 'B'] },
    onRemoveOption: () => {},
    onAddOption: () => {},
  });
  const row = /** @type {any} */ (node)._children[1];

  assert.equal(row._children.length, 3);
});

test('CORAOptionsEditor: renders nothing when no question set', () => {
  const e = new CORAOptionsEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAOptionsEditor: renders one tag per option + add button', () => {
  const e = new CORAOptionsEditor();
  e.question = {
    id: 'q1',
    text: 'T',
    responseType: 'single-choice',
    options: ['A', 'B'],
    deprecated: false,
  };
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const row = wrap._children[1];
  // 2 tags + 1 add button
  assert.equal(row._children.length, 3);
});

test('CORAOptionsEditor: clicking tag-x removes the option', () => {
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
  const row = /** @type {any} */ (e)._children[0]._children[1];
  const firstTag = row._children[0];
  const xSpan = firstTag._children[1];
  xSpan._listeners.click[0]();
  assert.deepEqual(q.options, ['B']);
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
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const row = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = row._children[row._children.length - 1];
  addBtn._listeners.click[0]();
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
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const row = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = row._children[row._children.length - 1];
  addBtn._listeners.click[0]();
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
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const row = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = row._children[row._children.length - 1];
  addBtn._listeners.click[0]();
  assert.deepEqual(q.options, ['X']);
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
  const e = new CORAOptionsEditor();
  e.question = q;
  e.connectedCallback();
  const row = /** @type {any} */ (e)._children[0]._children[1];
  const addBtn = row._children[row._children.length - 1];
  addBtn._listeners.click[0](); // does not throw
  assert.deepEqual(q.options, []);
});
