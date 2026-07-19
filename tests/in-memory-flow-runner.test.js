// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFlowFixture } from '../src/testing/in-memory-flow-runner.js';
import exampleReviewConfig from './_example-review-case-type.js';

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
  // example-review declares an explicit listName (Cases-ExampleReview), so it
  // exercises the list-scoped routing this test guards.
  const snapshot = await runFlowFixture({
    state: {
      lists: {
        'Cases-ExampleReview': [
          {
            ...CASE_ROW,
            id: 'scoped-case-1',
            title: 'List-scoped case',
            etag: 'etag-scoped-1',
          },
        ],
      },
    },
    scenario: {
      persona: 'reviewer',
      actions: [
        {
          type: 'loadCasePage',
          caseId: 'scoped-case-1',
          caseType: 'example-review',
        },
        { type: 'answer', questionId: 'q-welcome', value: 'Yes' },
      ],
    },
  });

  assert.equal(
    snapshot.lists['Cases-ExampleReview'][0].answers['q-welcome'].value,
    'Yes'
  );
  assert.notEqual(
    snapshot.lists['Cases-ExampleReview'][0].etag,
    'etag-scoped-1'
  );
});

test('in-memory flow runner completes the remediation loop through Send Actions and final completion', async () => {
  const originalCaptureGroups = exampleReviewConfig.captureGroups;
  exampleReviewConfig.captureGroups = [
    ...(originalCaptureGroups ?? []),
    {
      key: 'actions',
      label: 'Actions',
      collapsed: false,
      fields: [{ key: 'sentActions', label: 'Actions', type: 'actions' }],
    },
  ];
  try {
    const snapshot = await runFlowFixture({
      state: {
        lists: {
          'Cases-ExampleReview': [
            {
              ...CASE_ROW,
              answers: {
                'q-needs': {
                  value: 'No',
                  capture: {
                    sentActions: [
                      { id: 'sent-1', text: 'Coach agent', status: 'pending' },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      scenario: {
        persona: 'reviewer',
        actions: [
          {
            type: 'loadCasePage',
            caseId: 'case-flow-1',
            caseType: 'example-review',
          },
          { type: 'answer', questionId: 'q-welcome', value: 'Yes' },
          { type: 'answer', questionId: 'q-channel', value: 'Phone' },
          { type: 'answer', questionId: 'q-products', value: ['Account'] },
          {
            type: 'selectRemediationAction',
            questionId: 'q-needs',
            action: {
              id: 'q-needs-ra-0',
              text: 'Retrain agent on needs-identification protocol.',
            },
          },
          { type: 'clickCompleteCase' },
          {
            type: 'loadCasePage',
            caseId: 'case-flow-1',
            caseType: 'example-review',
          },
          {
            type: 'setActionStatus',
            questionId: 'q-needs',
            fieldKey: 'sentActions',
            actionId: 'sent-1',
            status: 'complete',
          },
          {
            type: 'loadCasePage',
            caseId: 'case-flow-1',
            caseType: 'example-review',
          },
          { type: 'clickCompleteCase' },
        ],
      },
    });

    const row = snapshot.lists['Cases-ExampleReview'].find(
      (candidate) => candidate.id === 'case-flow-1'
    );
    assert.ok(row);
    assert.equal(row.status, 'Completed');
    assert.equal(row.outcomeAtCompletion, 'fail');
    assert.equal(row.hadRemediation, true);
    assert.ok(
      row.remediationDueDate,
      'Send Actions stores the working-day SLA'
    );
    assert.ok(
      row.completedAt,
      'the second lifecycle transition closes the Case'
    );
  } finally {
    exampleReviewConfig.captureGroups = originalCaptureGroups;
  }
});
