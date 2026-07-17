// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORARemediationSection,
  CATALOGUE,
  findByTag,
  CAPTURE_GROUPS,
} from './helpers/cora-remediation-section.js';

// Capability: issue capture group integration.

test('CORARemediationSection: renders a cora-capture-groups per failed answer when captureGroups declared', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.connectedCallback();
  const cg = findByTag(el, 'cora-capture-groups');
  assert.ok(cg);
  assert.equal(cg.groups, CAPTURE_GROUPS);
  assert.deepEqual(cg.capture, {});
  assert.equal(cg.canCapture, true);
});

test('CORARemediationSection: no cora-capture-groups when no captureGroups declared', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.captureGroups = [];
  el.connectedCallback();
  assert.equal(findByTag(el, 'cora-capture-groups'), null);
});

test('CORARemediationSection: passes the failed Answer capture into cora-capture-groups', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {
    'q-welcome': { value: 'No', capture: { rootCause: 'Rushed' } },
  };
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.connectedCallback();
  const cg = findByTag(el, 'cora-capture-groups');
  assert.deepEqual(cg.capture, { rootCause: 'Rushed' });
});

test('CORARemediationSection: re-dispatches child cora-capture enriched with the question id', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.connectedCallback();
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-capture', (/** @type {any} */ e) => events.push(e));
  const cg = findByTag(el, 'cora-capture-groups');
  cg._fire('cora-capture', {
    type: 'cora-capture',
    detail: { fieldKey: 'rootCause', value: 'Rushed' },
    stopPropagation() {},
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-welcome',
    fieldKey: 'rootCause',
    value: 'Rushed',
  });
  assert.equal(events[0].bubbles, true);
});

test('CORARemediationSection: reuses the cora-capture-groups instance across re-renders', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.connectedCallback();
  const first = findByTag(el, 'cora-capture-groups');
  el.update(
    CATALOGUE,
    { 'q-welcome': { value: 'No', capture: { rootCause: 'x' } } },
    false
  );
  const second = findByTag(el, 'cora-capture-groups');
  assert.equal(
    first,
    second,
    'same instance reused so ephemeral collapse survives'
  );
});
