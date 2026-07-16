// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { freshExampleReviewBank } from './_example-review-fixture.js';
installDom();

const { SimulatePanel } =
  await import('../src/question-bank/simulate-panel.js');

/** Recursively collect all text in a stub element tree. */
function allText(/** @type {any} */ el) {
  let out = el.textContent || '';
  for (const child of el._children ?? []) out += ' ' + allText(child);
  return out;
}

test('SimulatePanel: shows empty state without sample Cases', () => {
  const published = freshExampleReviewBank();
  const draft = freshExampleReviewBank();
  const panel = /** @type {any} */ (SimulatePanel(published, draft, []));
  assert.equal(panel.className, 'sim-panel');
  assert.ok(allText(panel).includes('Impact simulation'));
  assert.ok(allText(panel).includes('No sample Cases loaded yet'));
});

test('SimulatePanel: reports impact per sample Case', () => {
  const published = freshExampleReviewBank();
  const draft = freshExampleReviewBank();
  const q = /** @type {any} */ (
    draft.questions.find((/** @type {any} */ x) => x.id === 'q-welcome')
  );
  q.failureCriteria = 'NA';
  q.optionOutcomes = { NA: 'fail' };
  const panel = /** @type {any} */ (
    SimulatePanel(published, draft, [
      {
        id: 'case-1',
        title: 'First Case',
        answers: { 'q-welcome': { value: 'NA' } },
      },
      { id: 'case-2', title: 'Second Case', answers: {} },
    ])
  );
  const text = allText(panel);
  assert.ok(text.includes('1 of 2 sample Cases affected'));
  assert.ok(text.includes('First Case'));
  assert.ok(text.includes('New Issue: q-welcome (caused by q-welcome)'));
  assert.ok(!text.includes('Second Case'));
});

test('SimulatePanel: with samples but no changes says so', () => {
  const published = freshExampleReviewBank();
  const draft = freshExampleReviewBank();
  const panel = /** @type {any} */ (
    SimulatePanel(published, draft, [
      { id: 'case-1', title: 'First Case', answers: {} },
    ])
  );
  assert.ok(allText(panel).includes('No sample Case is affected.'));
});

test('SimulatePanel: reports Outcome changes with attribution', () => {
  const published = freshExampleReviewBank();
  const draft = freshExampleReviewBank();
  const q = /** @type {any} */ (
    draft.questions.find((/** @type {any} */ x) => x.id === 'q-welcome')
  );
  q.optionOutcomes = {};
  const panel = /** @type {any} */ (
    SimulatePanel(published, draft, [
      {
        id: 'case-1',
        title: 'First Case',
        answers: { 'q-welcome': { value: 'No' } },
      },
    ])
  );
  const text = allText(panel);
  assert.ok(text.includes('Outcome: fail → pass (caused by q-welcome)'));
});
