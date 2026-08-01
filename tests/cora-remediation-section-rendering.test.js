// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
import {
  CORARemediationSection,
  CATALOGUE,
  FAIL_CAT,
  DETAIL_FIELDS,
  findByClass,
  findAllByClass,
} from './helpers/cora-remediation-section.js';

// Capability: failure selection and read-only rendering.

// ===== TESTS =====

test('CORARemediationSection: empty answers renders "No issues"', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {};
  el.connectedCallback();

  const empty = findByClass(el, 'cora-empty cora-remediation-empty');
  assert.ok(empty);
  assert.equal(empty.textContent, 'No issues.');
});

test('CORARemediationSection: only passing answers renders empty state', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'Yes' } };
  el.connectedCallback();

  assert.ok(findByClass(el, 'cora-empty cora-remediation-empty'));
});

test('CORARemediationSection: lists a failed answer that has no remediationActions', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'No actions defined?',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.catalogue = cat;
  el.answers = { q1: { value: 'No' } };
  el.connectedCallback();

  const items = findAllByClass(el, 'cora-remediation-item');
  assert.equal(
    items.length,
    1,
    'a failure with zero remediation actions is still listed'
  );
  const qText = findByClass(items[0], 'cora-remediation-question');
  assert.equal(qText.textContent, 'No actions defined?');
});

test('CORARemediationSection: renders one item per failed answer with remediationActions', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {
    'q-welcome': { value: 'No' },
    'q-needs': { value: 'No' },
  };
  el.connectedCallback();

  const items = findAllByClass(el, 'cora-remediation-item');
  assert.equal(items.length, 2);
});

test('CORARemediationSection: renders question text and answer for a failed item', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const qText = findByClass(el, 'cora-remediation-question');
  assert.equal(qText.textContent, 'Needs identified?');

  const ansText = findByClass(el, 'cora-remediation-answer');
  assert.equal(ansText.textContent, 'Answer: No');
});

test('CORARemediationSection: renders the Question Group when defined on QuestionDefinition', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const cat = findByClass(el, 'cora-remediation-group');
  assert.ok(cat);
  assert.equal(cat.textContent, 'Discovery');
});

test('CORARemediationSection: skips non-applicable failed questions', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  // q-resolve fails but is not applicable (q-needs !== Yes)
  el.answers = { 'q-needs': { value: 'No' }, 'q-resolve': { value: 'No' } };
  el.connectedCallback();

  const items = findAllByClass(el, 'cora-remediation-item');
  assert.equal(items.length, 1);
  // The single item should be q-needs, not q-resolve
  const qText = findByClass(items[0], 'cora-remediation-question');
  assert.equal(qText.textContent, 'Needs identified?');
});

test('CORARemediationSection: update() re-renders with new state', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 1);

  el.update(CATALOGUE, { 'q-needs': { value: 'Yes' } });
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 0);
  assert.ok(findByClass(el, 'cora-empty cora-remediation-empty'));
});

test('CORARemediationSection: multi-choice answer renders array as comma-joined', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-products',
      text: 'Products?',
      responseType: 'multi-choice',
      options: ['Account', 'Billing', 'Support'],
      failureValues: ['Billing'],
      remediationActions: ['Refer to billing.'],
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.catalogue = cat;
  el.answers = { 'q-products': { value: ['Account', 'Billing'] } };
  el.connectedCallback();

  const ansText = findByClass(el, 'cora-remediation-answer');
  assert.equal(ansText.textContent, 'Answer: Account, Billing');
});

test('CORARemediationSection: _renderItem with no answer shows empty string via ?? fallback', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-missing',
    text: 'Missing answer?',
    responseType: 'yes-no-na',
    remediationActions: ['Do something'],
    deprecated: false,
  };
  const el = new CORARemediationSection();
  el.answers = {};
  const item = /** @type {any} */ (el)._renderItem(q);
  const answerEl = findByClass(item, 'cora-remediation-answer');
  assert.equal(answerEl.textContent, 'Answer: ');
});

test('CORARemediationSection: select control offers an option per declared option plus a blank', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  const select = findAllByClass(el, 'cora-remediation-detail-input')[1];
  const optionValues = select._children.map((/** @type {any} */ o) => o.value);
  assert.deepEqual(optionValues, ['', 'Low', 'Med', 'High']);
});

test('CORARemediationSection: editable input pre-fills the captured value', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(
    FAIL_CAT,
    {
      q1: {
        value: 'No',
        remediationDetails: { rootCause: 'Rushed', severity: 'High' },
      },
    },
    false
  );

  const inputs = findAllByClass(el, 'cora-remediation-detail-input');
  assert.equal(inputs[0].value, 'Rushed');
  assert.equal(inputs[1].value, 'High');
});

test('CORARemediationSection: read-only viewer sees captured values as text with no inputs', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = false;
  el.update(
    FAIL_CAT,
    {
      q1: {
        value: 'No',
        remediationDetails: { rootCause: 'Rushed', severity: 'High' },
      },
    },
    false
  );

  assert.equal(
    findByClass(el, 'cora-remediation-detail-input'),
    null,
    'no editable inputs when frozen'
  );
  const values = findAllByClass(el, 'cora-remediation-detail-value').map(
    (v) => v.textContent
  );
  assert.deepEqual(values, ['Root cause: Rushed', 'Severity: High']);
});

test('CORARemediationSection: read-only viewer omits fields with no captured value', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = false;
  el.update(
    FAIL_CAT,
    { q1: { value: 'No', remediationDetails: { rootCause: 'Rushed' } } },
    false
  );

  const values = findAllByClass(el, 'cora-remediation-detail-value').map(
    (v) => v.textContent
  );
  assert.deepEqual(
    values,
    ['Root cause: Rushed'],
    'only captured fields are shown read-only'
  );
});
