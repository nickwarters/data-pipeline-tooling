// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
import {
  CORARemediationSection,
  CATALOGUE,
  FREEFORM_CAT,
  NO_FREEFORM_CAT,
  findByClass,
  findAllByClass,
} from './helpers/cora-remediation-section.js';

// Capability: configured and free-form remediation actions.

test('CORARemediationSection: read-only viewer shows only the selected remediation actions as text', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = false;
  // Only the second configured action (q-needs-ra-1) is selected on the Answer.
  el.answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'q-needs-ra-1', text: 'Update script.' }],
    },
  };
  el.connectedCallback();

  const actions = findByClass(el, 'cora-remediation-actions');
  assert.equal(
    actions._children.length,
    1,
    'only the selected action is shown'
  );
  assert.equal(actions._children[0].textContent, 'Update script.');
  assert.equal(
    findByClass(el, 'cora-remediation-action-checkbox'),
    null,
    'read-only viewer sees no checkboxes'
  );
});

test('CORARemediationSection: read-only viewer with no selected actions shows no actions list', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = false;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-actions'), null);
});

test('CORARemediationSection: a "Remediation Actions" heading precedes the visible actions', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const heading = findByClass(el, 'cora-remediation-actions-heading');
  assert.ok(heading, 'a heading is rendered above the actions');
  assert.equal(heading.textContent, 'Remediation Actions');
});

test('CORARemediationSection: no actions heading when there are no visible actions', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = false;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-actions-heading'), null);
});

test('CORARemediationSection: editable viewer renders an unticked checkbox per configured action', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const boxes = findAllByClass(el, 'cora-remediation-action-checkbox');
  assert.equal(boxes.length, 2, 'one checkbox per configured action');
  assert.deepEqual(
    boxes.map((/** @type {any} */ b) => b.checked),
    [false, false],
    'actions default to unticked (not pre-applied)'
  );
});

test('CORARemediationSection: editable viewer pre-ticks actions already selected on the Answer', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'q-needs-ra-1', text: 'Update script.' }],
    },
  };
  el.connectedCallback();

  const boxes = findAllByClass(el, 'cora-remediation-action-checkbox');
  assert.deepEqual(
    boxes.map((/** @type {any} */ b) => b.checked),
    [false, true],
    'the selected action (q-needs-ra-1) is ticked'
  );
});

test('CORARemediationSection: ticking an action dispatches a bubbling cora-remediation-action', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-action', (/** @type {any} */ e) =>
    events.push(e)
  );

  const box = findAllByClass(el, 'cora-remediation-action-checkbox')[0];
  box.checked = true;
  box._fire('change', { target: box });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-needs',
    action: { id: 'q-needs-ra-0', text: 'Retrain agent.' },
    selected: true,
  });
});

test('CORARemediationSection: unticking a selected action dispatches selected:false', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'q-needs-ra-0', text: 'Retrain agent.' }],
    },
  };
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-action', (/** @type {any} */ e) =>
    events.push(e)
  );

  const box = findAllByClass(el, 'cora-remediation-action-checkbox')[0];
  box.checked = false;
  box._fire('change', { target: box });

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-needs',
    action: { id: 'q-needs-ra-0', text: 'Retrain agent.' },
    selected: false,
  });
});

test('CORARemediationSection: every failed Question gets a free-form input by default', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  assert.ok(findByClass(el, 'cora-remediation-freeform-input'));
});

test('CORARemediationSection: no free-form input when the Question Definition disallows it', () => {
  const el = new CORARemediationSection();
  el.catalogue = NO_FREEFORM_CAT;
  el.canSelectRemediation = true;
  el.answers = { 'q-free': { value: 'No' } };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-freeform-input'), null);
});

test('CORARemediationSection: editable viewer renders a free-form input when the question allows it', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = true;
  el.answers = {
    'q-free': { value: 'No', freeFormRemediation: 'Escalate to legal' },
  };
  el.connectedCallback();

  const input = findByClass(el, 'cora-remediation-freeform-input');
  assert.ok(input, 'free-form input rendered');
  assert.equal(
    input.tagName,
    'TEXTAREA',
    'free-form remediation is prose, so it renders as a textarea'
  );
  assert.equal(
    input.getAttribute('type'),
    null,
    'a textarea has no type; setting one throws in a real browser'
  );
  assert.equal(
    input.value,
    'Escalate to legal',
    'pre-filled with the stored value'
  );
});

test('CORARemediationSection: editing free-form dispatches a bubbling cora-remediation-freeform', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = true;
  el.answers = { 'q-free': { value: 'No' } };
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-freeform', (/** @type {any} */ e) =>
    events.push(e)
  );

  const input = findByClass(el, 'cora-remediation-freeform-input');
  input.value = 'Refer to compliance';
  input._fire('change', { target: input });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-free',
    value: 'Refer to compliance',
  });
});

test('CORARemediationSection: read-only viewer shows captured free-form as text, no input', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = false;
  el.answers = {
    'q-free': { value: 'No', freeFormRemediation: 'Escalate to legal' },
  };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-freeform-input'), null);
  const value = findByClass(el, 'cora-remediation-freeform-value');
  assert.ok(value);
  assert.equal(value.textContent, 'Escalate to legal');
});

test('CORARemediationSection: read-only viewer with no free-form value renders nothing', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = false;
  el.answers = { 'q-free': { value: 'No' } };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-freeform-value'), null);
});

test('CORARemediationSection: failed question without remediationActions renders no actions list', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'Q1',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.catalogue = cat;
  el.answers = { q1: { value: 'No' } };
  el.connectedCallback();

  // The failure is listed (failures view), but with no remediation actions list.
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 1);
  assert.equal(findByClass(el, 'cora-remediation-actions'), null);
});

test('CORARemediationSection: _renderItem with null remediationActions renders no actions list', () => {
  // Exercises the `q.remediationActions?.length` guard when remediationActions is null
  const q = /** @type {any} */ ({
    id: 'q-null-actions',
    text: 'No actions?',
    responseType: 'yes-no-na',
    remediationActions: null,
    deprecated: false,
  });
  const el = new CORARemediationSection();
  el.answers = { 'q-null-actions': { value: 'No' } };
  const item = /** @type {any} */ (el)._renderItem(q);
  const actionsList = findByClass(item, 'cora-remediation-actions');
  assert.equal(
    actionsList,
    null,
    'null remediationActions → no actions list rendered'
  );
});
