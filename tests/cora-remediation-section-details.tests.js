// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORARemediationSection,
  FAIL_CAT,
  DETAIL_FIELDS,
  findByClass,
  findAllByClass,
} from './helpers/cora-remediation-section.js';

// Capability: typed remediation detail fields.

test('CORARemediationSection: no Remediation Details surface when the Case Type declares no fields', () => {
  const el = new CORARemediationSection();
  el.remediationFields = [];
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  assert.equal(findByClass(el, 'cora-remediation-detail-field'), null);
});

test('CORARemediationSection: editable failure renders a labelled input per Remediation Detail field', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  const fields = findAllByClass(el, 'cora-remediation-detail-field');
  assert.equal(fields.length, 2, 'one row per declared field');
  const labels = findAllByClass(el, 'cora-remediation-detail-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(labels, ['Root cause', 'Severity']);

  const inputs = findAllByClass(el, 'cora-remediation-detail-input');
  assert.equal(inputs[0]._tagName, 'input', 'text field renders an input');
  assert.equal(inputs[1]._tagName, 'select', 'select field renders a select');
});

test('CORARemediationSection: changing a Remediation Detail dispatches a bubbling cora-remediation-detail', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-detail', (/** @type {any} */ e) =>
    events.push(e)
  );

  const input = findAllByClass(el, 'cora-remediation-detail-input')[0];
  input.value = 'Agent rushed the call';
  input._fire('change', { target: input });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q1',
    key: 'rootCause',
    value: 'Agent rushed the call',
  });
});
