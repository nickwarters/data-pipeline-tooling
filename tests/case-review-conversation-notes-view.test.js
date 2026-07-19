// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { notesView } =
  await import('../src/pages/cora-case-review/notes-view.js');

test('CASE-3 Notes view dispatches notes and justification edits at the public input seam', () => {
  /** @type {Array<[string, string]>} */
  const edits = [];
  const node = notesView({
    notes: 'Existing note',
    caseJustification: 'Existing justification',
    access: 'edit',
    heading: 'Notes',
    placeholders: {
      notes: 'Add a note',
      caseJustification: 'Explain the case',
    },
    onFieldInput: (field, value) => edits.push([field, value]),
  });
  const fields = node.querySelectorAll('textarea');
  fields[0].value = 'Updated note';
  fireEvent(fields[0], 'input');
  fields[1].value = 'Updated justification';
  fireEvent(fields[1], 'input');

  assert.equal(fields[0].getAttribute('aria-label'), 'Case notes');
  assert.equal(fields[1].getAttribute('aria-label'), 'Case Justification');
  assert.deepEqual(edits, [
    ['notes', 'Updated note'],
    ['caseJustification', 'Updated justification'],
  ]);
});

test('CASE-3 Notes view preserves configured placeholders and read-only access', () => {
  /** @type {Array<[string, string]>} */
  const edits = [];
  const node = notesView({
    notes: '',
    caseJustification: '',
    access: 'read-only',
    heading: 'Private Notes',
    placeholders: {
      notes: 'Configured note placeholder',
      caseJustification: 'Configured justification placeholder',
    },
    onFieldInput: (field, value) => edits.push([field, value]),
  });
  const fields = node.querySelectorAll('textarea');
  fields[0].value = 'Ignored';
  fireEvent(fields[0], 'input');

  assert.match(node.textContent, /Private Notes/);
  assert.equal(fields[0].readOnly, true);
  assert.equal(fields[1].readOnly, true);
  assert.equal(fields[0].placeholder, 'Configured note placeholder');
  assert.equal(fields[1].placeholder, 'Configured justification placeholder');
  assert.deepEqual(edits, []);
});
