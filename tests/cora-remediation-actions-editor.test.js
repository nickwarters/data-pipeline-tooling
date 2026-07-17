// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { commitSpy } from './_example-review-fixture.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';

installDom();

const { CORARemediationActionsEditor } =
  await import('../src/pages/question-bank/cora-remediation-actions-editor.js');

/** @param {any} question @param {(fn: () => void) => void} [onCommit] */
function renderEditor(question, onCommit) {
  const editor = new CORARemediationActionsEditor();
  editor.question = question;
  if (onCommit) editor.onCommit = onCommit;
  editor.connectedCallback();
  return editor;
}

test('CORARemediationActionsEditor: mutations flow through the onCommit prop', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const onCommit = commitSpy();
  const editor = renderEditor(q, onCommit);

  fireEvent(
    getByRole(editor, 'switch', { name: 'Allow free-form remediation' }),
    'click'
  );
  assert.equal(onCommit.calls, 1);
  assert.equal(q.allowFreeFormRemediation, true);

  fireEvent(getByRole(editor, 'button', { name: '+ canned action' }), 'click');
  assert.equal(onCommit.calls, 2);
  assert.equal(q.remediationActions.length, 1);
});

test('CORARemediationActionsEditor: no question → renders nothing', () => {
  const editor = renderEditor(null);

  assert.equal(editor.querySelector('.rem-block'), null);
});

test('CORARemediationActionsEditor: empty actions + no free-form → empty hint', () => {
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const editor = renderEditor(q);

  assert.ok(editor.querySelector('.cora-empty'));
  assert.ok(getByRole(editor, 'button', { name: '+ canned action' }));
});

test('CORARemediationActionsEditor: actions + free-form preview show when toggle is on', () => {
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    allowFreeFormRemediation: true,
    remediationActions: ['A', 'B'],
  };
  const editor = renderEditor(q);

  assert.ok(editor.querySelector('.rem-free-preview'));
  assert.equal(queryAllByRole(editor, 'textbox').length, 2);
  assert.equal(
    getByRole(editor, 'switch', {
      name: 'Allow free-form remediation',
    }).getAttribute('aria-checked'),
    'true'
  );
});

test('CORARemediationActionsEditor: free-form toggle flips state', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const editor = renderEditor(q);

  fireEvent(
    getByRole(editor, 'switch', { name: 'Allow free-form remediation' }),
    'click'
  );

  assert.equal(q.allowFreeFormRemediation, true);
});

test('CORARemediationActionsEditor: edit a remediation action via change event', () => {
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['Old action'],
  };
  const editor = renderEditor(q);
  const input = getByRole(editor, 'textbox', { name: 'Remediation action 1' });
  input.value = 'New action';

  fireEvent(input, 'change');

  assert.deepEqual(q.remediationActions, [
    { id: 'q-ra-0', text: 'New action' },
  ]);
});

test('CORARemediationActionsEditor: remove action deletes field when empty', () => {
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['only'],
  };
  const editor = renderEditor(q);

  fireEvent(
    getByRole(editor, 'button', { name: 'Remove remediation action 1' }),
    'click'
  );

  assert.equal('remediationActions' in q, false);
});

test('CORARemediationActionsEditor: + canned action initialises array if missing', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const editor = renderEditor(q);

  fireEvent(getByRole(editor, 'button', { name: '+ canned action' }), 'click');

  assert.deepEqual(q.remediationActions, [
    { id: 'q-ra-0', text: 'New action' },
  ]);
});

test('CORARemediationActionsEditor: failed questions get no Outcome selector (response drives outcome)', () => {
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  };
  const editor = renderEditor(q);

  assert.ok(editor.querySelector('.rem-empty'));
  assert.equal(queryAllByRole(editor, 'combobox').length, 0);
  assert.equal('outcome' in q, false);
});

test('CORARemediationActionsEditor: an action row exposes its text input and remove control', () => {
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['Legacy action'],
  };
  const editor = renderEditor(q);
  const item = editor.querySelector('.rem-item');

  assert.ok(item);
  assert.ok(getByRole(item, 'textbox', { name: 'Remediation action 1' }));
  assert.ok(getByRole(item, 'button', { name: 'Remove remediation action 1' }));
  assert.equal(queryAllByRole(item, 'textbox').length, 1);
  assert.equal(queryAllByRole(item, 'button').length, 1);
});
