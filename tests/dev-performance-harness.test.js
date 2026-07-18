// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findAllByClass } from './_dom-stub.js';

installDom();

const {
  PERFORMANCE_BANK,
  createPerformanceState,
  createRouteSlice,
  reducePerformanceState,
} = await import('../src/pages/dev-performance-harness.js');
const { createStoreRoute } = await import('../src/core/store-route.js');

const G = /** @type {any} */ (globalThis);

test('performance harness: a text Answer dirties only its own Question Group', () => {
  const state = createPerformanceState(PERFORMANCE_BANK);
  assert.equal(PERFORMANCE_BANK.questions.length, 500);
  assert.equal(state.dirtyGroupIds.length, 20);

  const next = reducePerformanceState(state, {
    type: 'answer/changed',
    questionId: PERFORMANCE_BANK.performanceProfile.textAnswerQuestionId,
    value: 'a',
    scenario: 'steady-state-keystroke',
    startedAt: 10,
  });

  assert.deepEqual(next.dirtyGroupIds, ['Question Group 01']);
  assert.equal(
    next.answers[PERFORMANCE_BANK.performanceProfile.textAnswerQuestionId]
      .value,
    'a'
  );
});

test('performance harness: the gate Answer invalidates 125 downstream cards across five groups', () => {
  const state = createPerformanceState(PERFORMANCE_BANK);
  const next = reducePerformanceState(state, {
    type: 'answer/changed',
    questionId: PERFORMANCE_BANK.performanceProfile.fanOutGateQuestionId,
    value: 'Yes',
    scenario: 'fan-out-dispatch',
    startedAt: 20,
  });

  assert.deepEqual(next.dirtyGroupIds, [
    'Question Group 01',
    'Question Group 16',
    'Question Group 17',
    'Question Group 18',
    'Question Group 19',
    'Question Group 20',
  ]);
  assert.equal(next.pendingMeasurement?.changedQuestionCount, 126);
  assert.equal(next.applicable.size, 500);
});

test('performance harness route: typing morphs its Question Group without touching an unrelated group', async () => {
  const container = G.document.createElement('div');
  const handler = createStoreRoute({
    load: async () => ({ createRouteSlice }),
    context: {},
  });
  await handler.mount(container, {});

  assert.equal(findAllByClass(container, 'cora-performance-group').length, 20);
  const unrelatedGroup = container.querySelector(
    '[data-group-id="Question Group 02"]'
  );
  const unrelatedTree = unrelatedGroup.childNodes[0];
  const textInput = container.querySelector(
    `[data-question-id="${PERFORMANCE_BANK.performanceProfile.textAnswerQuestionId}"]`
  );
  assert.ok(textInput);

  textInput.dispatchEvent(new G.CustomEvent('keydown'));
  textInput.value = 'a';
  textInput.dispatchEvent(new G.CustomEvent('input'));
  await Promise.resolve();

  assert.equal(
    unrelatedGroup.childNodes[0],
    unrelatedTree,
    'an unrelated Question Group is never passed to morph()'
  );
  assert.equal(
    container.querySelector(
      `[data-question-id="${PERFORMANCE_BANK.performanceProfile.textAnswerQuestionId}"]`
    ),
    textInput,
    'memo + morph preserve the live text input'
  );
  handler.unmount();
});

test('performance harness route: the runner captures all three ticket scenarios with raw samples', async () => {
  const container = G.document.createElement('div');
  const handler = createStoreRoute({
    load: async () => ({ createRouteSlice }),
    context: {},
  });
  await handler.mount(container, {});

  const runner = G.__coraPerformanceGate;
  assert.ok(runner, 'dev route exposes its reproducible benchmark runner');
  const results = await runner.run({
    steadyStateIterations: 3,
    fanOutIterations: 2,
  });

  assert.equal(results.scenarios.initialRouteMount.sampleCount, 1);
  assert.equal(results.scenarios.steadyStateKeystroke.sampleCount, 3);
  assert.equal(results.scenarios.fanOutDispatch.sampleCount, 2);
  assert.equal(
    results.scenarios.fanOutDispatch.samples[0].changedQuestionCount,
    126
  );
  assert.equal(
    container
      .querySelector('.cora-performance-harness__results')
      .getAttribute('data-status'),
    'complete'
  );

  handler.unmount();
  assert.equal(G.__coraPerformanceGate, undefined);
});
