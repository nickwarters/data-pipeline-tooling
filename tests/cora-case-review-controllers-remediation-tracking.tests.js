// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONS,
  bindRemediationTracking,
  makeTrackingContext,
  updateRemediationTracking,
} from './helpers/cora-case-review-controllers.js';

// Capability: remediation tracking state and actions.

test('bindRemediationTracking: forwards cora-action-status to the view model', () => {
  const { context, tracking, statusCalls } = makeTrackingContext();
  bindRemediationTracking(/** @type {any} */ (context));
  tracking._listeners['cora-action-status'][0]({
    detail: {
      questionId: 'q-a',
      fieldKey: 'acts',
      actionId: 'a1',
      status: 'cancelled',
      cancelReason: 'dup',
    },
  });
  assert.deepEqual(statusCalls, [
    {
      questionId: 'q-a',
      fieldKey: 'acts',
      actionId: 'a1',
      status: 'cancelled',
      cancelReason: 'dup',
    },
  ]);
});

test('bindRemediationTracking: no-ops when the tracking node is absent', () => {
  const { context } = makeTrackingContext();
  context.nodes.remediation = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    bindRemediationTracking(/** @type {any} */ (context))
  );
});

test('updateRemediationTracking: assigns captureGroups, canResolve, and updates', () => {
  const { context, tracking } = makeTrackingContext({ access: 'edit' });
  updateRemediationTracking(/** @type {any} */ (context));
  assert.equal(/** @type {any} */ (tracking).canResolve, true);
  assert.deepEqual(/** @type {any} */ (tracking).captureGroups, [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'acts', label: 'Acts', type: 'actions' }],
    },
  ]);
  assert.equal(tracking._updateArgs[0], QUESTIONS);
});

test('updateRemediationTracking: read-only viewer cannot resolve; no-ops without a node', () => {
  const { context, tracking } = makeTrackingContext({ access: 'read-only' });
  updateRemediationTracking(/** @type {any} */ (context));
  assert.equal(/** @type {any} */ (tracking).canResolve, false);

  const bare = makeTrackingContext();
  bare.context.nodes.remediation = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    updateRemediationTracking(/** @type {any} */ (bare.context))
  );
});

test('updateRemediationTracking: threads the resolved Remediation heading', () => {
  const { context, tracking } = makeTrackingContext();
  /** @type {any} */ (context.viewModel).config.sectionLabels = {
    remediation: 'Fix-up',
  };

  updateRemediationTracking(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (tracking).heading, 'Fix-up');
});
