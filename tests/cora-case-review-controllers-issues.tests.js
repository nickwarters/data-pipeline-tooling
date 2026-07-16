// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONS,
  bindRemediationPanel,
  makeRemediationContext,
  updateRemediationPanel,
} from './helpers/cora-case-review-controllers.js';

// Capability: issue capture and remediation selection.

test('bindRemediationPanel: forwards capture and attribution events', () => {
  const { context, remediation, captureCalls, attributeCalls } =
    makeRemediationContext();

  bindRemediationPanel(/** @type {any} */ (context));
  remediation._listeners['cora-capture'][0]({
    detail: { questionId: 'q-a', fieldKey: 'detail', value: 'Needs work' },
  });
  const attributedParty = {
    loginName: 'person@example.com',
    displayName: 'Person Example',
  };
  remediation._listeners['cora-attribute'][0]({
    detail: { questionId: 'q-b', attributedParty },
  });

  assert.deepEqual(captureCalls, [
    { questionId: 'q-a', fieldKey: 'detail', value: 'Needs work' },
  ]);
  assert.deepEqual(attributeCalls, [{ questionId: 'q-b', attributedParty }]);
});

test('bindRemediationPanel: forwards remediation action selection and free-form events (issue #250)', () => {
  const {
    context,
    remediation,
    remediationActionCalls,
    remediationFreeFormCalls,
  } = makeRemediationContext();

  bindRemediationPanel(/** @type {any} */ (context));
  remediation._listeners['cora-remediation-action'][0]({
    detail: {
      questionId: 'q-a',
      action: { id: 'q-a-ra-0', text: 'Retrain' },
      selected: true,
    },
  });
  remediation._listeners['cora-remediation-freeform'][0]({
    detail: { questionId: 'q-a', value: 'Escalate to legal' },
  });

  assert.deepEqual(remediationActionCalls, [
    {
      questionId: 'q-a',
      action: { id: 'q-a-ra-0', text: 'Retrain' },
      selected: true,
    },
  ]);
  assert.deepEqual(remediationFreeFormCalls, [
    { questionId: 'q-a', value: 'Escalate to legal' },
  ]);
});

test('updateRemediationPanel: assigns Issues tab properties without changing capture behavior', () => {
  const { context, remediation, client, answers, captureGroups } =
    makeRemediationContext({
      responsibleParty: 'owner@example.com',
      canAttribute: false,
      canCapture: true,
      attributeFailures: false,
    });

  updateRemediationPanel(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (remediation).client, client);
  assert.equal(/** @type {any} */ (remediation).canAttribute, false);
  assert.deepEqual(/** @type {any} */ (remediation).responsibleParty, {
    loginName: 'owner@example.com',
    displayName: 'owner@example.com',
  });
  assert.equal(/** @type {any} */ (remediation).captureGroups, captureGroups);
  assert.equal(/** @type {any} */ (remediation).canCapture, true);
  assert.equal(
    /** @type {any} */ (remediation).canSelectRemediation,
    true,
    'the Issues section receives the action-selection gate'
  );
  assert.equal(/** @type {any} */ (remediation).catalogue, QUESTIONS);
  assert.equal(/** @type {any} */ (remediation).answers, answers);
  assert.equal(/** @type {any} */ (remediation).attributeFailures, false);
  assert.deepEqual(remediation._updateArgs, [QUESTIONS, answers, false]);
});

test('updateRemediationPanel: forwards null Responsible Party as null quick-pick', () => {
  const { context, remediation } = makeRemediationContext({
    responsibleParty: null,
  });

  updateRemediationPanel(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (remediation).responsibleParty, null);
});
