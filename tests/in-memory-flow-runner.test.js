// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFlowFixture } from '../src/testing/in-memory-flow-runner.js';

/** @type {import('../src/sharepoint-client.js').CaseRow} */
const CASE_ROW = {
  id: 'case-flow-1',
  caseType: 'example-review',
  title: 'Flow fixture case',
  status: 'In-progress',
  assignedReviewer: 'user-reviewer',
  responsibleParty: 'user-agent-a',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'etag-flow-1',
};

test('in-memory flow runner loads a case, answers questions, completes, and snapshots the new list state', async () => {
  const snapshot = await runFlowFixture({
    state: { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    scenario: {
      persona: 'reviewer',
      actions: [
        {
          type: 'loadCasePage',
          caseId: 'case-flow-1',
          caseType: 'example-review',
        },
        { type: 'answer', questionId: 'q-welcome', value: 'Yes' },
        { type: 'answer', questionId: 'q-needs', value: 'Yes' },
        { type: 'answer', questionId: 'q-resolve', value: 'Yes' },
        { type: 'answer', questionId: 'q-channel', value: 'Phone' },
        { type: 'answer', questionId: 'q-products', value: ['Account'] },
        { type: 'clickCompleteCase' },
      ],
    },
  });

  const row = snapshot.lists['Cases-ExampleReview'].find(
    (c) => c.id === 'case-flow-1'
  );
  assert.ok(row);
  assert.equal(row.status, 'Completed');
  assert.equal(row.answers['q-welcome'].value, 'Yes');
  assert.equal(row.outcomeAtCompletion, 'pass');
  assert.notEqual(row.etag, 'etag-flow-1');
});

test('in-memory flow runner preserves list-scoped case state when the route case type has a listName', async () => {
  const snapshot = await runFlowFixture({
    state: {
      lists: {
        'Cases-ProductSaleReview': [
          {
            ...CASE_ROW,
            id: 'product-case-1',
            caseType: 'product-sale-review',
            title: 'Product sale case',
            etag: 'etag-product-1',
          },
        ],
      },
    },
    scenario: {
      persona: 'reviewer',
      actions: [
        {
          type: 'loadCasePage',
          caseId: 'product-case-1',
          caseType: 'product-sale-review',
        },
        { type: 'answer', questionId: 'q-cv-identity', value: 'Yes' },
      ],
    },
  });

  assert.equal(
    snapshot.lists['Cases-ProductSaleReview'][0].answers['q-cv-identity'].value,
    'Yes'
  );
  assert.notEqual(
    snapshot.lists['Cases-ProductSaleReview'][0].etag,
    'etag-product-1'
  );
});
