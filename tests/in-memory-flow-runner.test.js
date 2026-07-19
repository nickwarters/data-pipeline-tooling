// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInMemoryFlowRunner,
  runFlowFixture,
} from '../src/testing/in-memory-flow-runner.js';
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

test('in-memory flow runner rejects actions that cannot run without a loaded Case', async () => {
  const runner = createInMemoryFlowRunner(
    {
      personas: {
        reviewer: {
          userId: 'user-reviewer',
          displayName: 'Reviewer',
          groups: [],
        },
      },
      lists: { 'Cases-ExampleReview': [CASE_ROW] },
    },
    { persona: 'missing-persona' }
  );

  assert.equal(runner.viewModel, null);
  assert.ok(runner.snapshot().lists['Cases-ExampleReview']);
  await runner.run([{ type: 'flush' }]);
  await assert.rejects(
    runner.run([{ type: 'answer', questionId: 'q-welcome', value: 'Yes' }]),
    /before a loadCasePage action/
  );
  await assert.rejects(
    runner.run([/** @type {any} */ ({ type: 'unsupported' })]),
    /Unsupported flow action/
  );
});

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
            type: 'captureIssue',
            questionId: 'q-needs',
            fieldKey: 'rootCause',
            value: 'Reviewer missed the evidence.',
          },
          {
            type: 'freeFormRemediation',
            questionId: 'q-needs',
            value: 'Coach the reviewer.',
          },
          {
            type: 'selectRemediationAction',
            questionId: 'q-needs',
            action: {
              id: 'q-needs-ra-0',
              text: 'Retrain agent on needs-identification protocol.',
            },
            selected: false,
          },
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

test('in-memory flow runner completes allocate, review, remediate, appeal, and amend lifecycle', async () => {
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
  const noCapabilities = {
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
  };
  try {
    const snapshot = await runFlowFixture({
      state: {
        lists: {
          'Cases-ExampleReview': [
            {
              ...CASE_ROW,
              assignedReviewer: '',
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
            type: 'allocateCase',
            caseId: 'case-flow-1',
            caseType: 'example-review',
            reviewerId: 'user-reviewer',
          },
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
          {
            type: 'loadCasePage',
            caseId: 'case-flow-1',
            caseType: 'example-review',
            currentUserId: 'user-owner',
            capabilities: {
              ...noCapabilities,
              ownedJourneyCaseTypes: ['example-review'],
            },
          },
          {
            type: 'raiseAppeal',
            actorId: 'user-owner',
            rationale: 'The completed outcome is too severe.',
            citedAnswerKeys: ['q-needs'],
          },
          {
            type: 'loadCasePage',
            caseId: 'case-flow-1',
            caseType: 'example-review',
            currentUserId: 'user-controls',
            capabilities: { ...noCapabilities, isControls: true },
          },
          {
            type: 'resolveAppeal',
            actorId: 'user-controls',
            verdict: 'agreed',
            rationale: 'The evidence supports the appeal.',
            outcome: 'pass',
            justification: 'Corrected after Controls review.',
          },
        ],
      },
    });

    const row = snapshot.lists['Cases-ExampleReview'].find(
      (candidate) => candidate.id === 'case-flow-1'
    );
    assert.ok(row);
    assert.equal(row.assignedReviewer, 'user-reviewer');
    assert.equal(row.status, 'Completed');
    assert.equal(row.appeals?.[0].state, 'resolved');
    assert.deepEqual(row.appeals?.[0].citedAnswerKeys, ['q-needs']);
    assert.equal(row.appeals?.[0].resolution?.verdict, 'agreed');
    assert.equal(row.amendedOutcome?.outcome, 'pass');
    assert.equal(row.amendedOutcome?.fromAppealId, row.appeals?.[0].id);
    assert.equal(row.outcomeAtCompletion, 'fail');
    assert.equal(row.effectiveOutcome, 'pass');
    assert.equal(row.outcomeOverridden, true);
  } finally {
    exampleReviewConfig.captureGroups = originalCaptureGroups;
  }
});

test('in-memory flow runner reports allocation failures', async () => {
  const missing = createInMemoryFlowRunner({
    lists: { 'Cases-ExampleReview': [] },
  });
  await assert.rejects(
    missing.run([
      {
        type: 'allocateCase',
        caseId: 'missing',
        caseType: 'example-review',
        reviewerId: 'user-reviewer',
      },
    ]),
    /Cannot allocate missing Case/
  );

  const conflicted = createInMemoryFlowRunner({
    lists: { 'Cases-ExampleReview': [{ ...CASE_ROW, assignedReviewer: '' }] },
  });
  conflicted.client.inject412();
  await assert.rejects(
    conflicted.run([
      {
        type: 'allocateCase',
        caseId: 'case-flow-1',
        caseType: 'example-review',
        reviewerId: 'user-reviewer',
      },
    ]),
    /allocation failed with status 412/
  );
});

test('in-memory flow runner enforces Appeal permissions', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow} */
  const completed = {
    ...CASE_ROW,
    status: 'Completed',
    completedAt: '2026-07-19T10:00:00Z',
    outcomeAtCompletion: 'fail',
  };
  const runner = createInMemoryFlowRunner({
    lists: { 'Cases-ExampleReview': [completed] },
  });
  await runner.run([
    {
      type: 'loadCasePage',
      caseId: 'case-flow-1',
      caseType: 'example-review',
    },
  ]);
  await assert.rejects(
    runner.run([
      {
        type: 'raiseAppeal',
        actorId: 'user-reviewer',
        rationale: 'Not permitted.',
      },
    ]),
    /cannot raise an Appeal/
  );
  await assert.rejects(
    runner.run([
      {
        type: 'resolveAppeal',
        actorId: 'user-reviewer',
        verdict: 'rejected',
        rationale: 'Not permitted.',
      },
    ]),
    /cannot resolve an Appeal/
  );
});

test('in-memory flow runner can reject an Appeal without amending the Outcome', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow} */
  const row = {
    ...CASE_ROW,
    status: 'Completed',
    completedAt: '2026-07-19T10:00:00Z',
    outcomeAtCompletion: 'fail',
    appeals: [
      {
        id: 'appeal-1',
        appellant: 'user-owner',
        at: '2026-07-19T10:00:00Z',
        rationale: 'Please reconsider.',
        state: /** @type {'raised'} */ ('raised'),
      },
    ],
  };
  const runner = createInMemoryFlowRunner({
    lists: { 'Cases-ExampleReview': [row] },
  });
  await runner.run([
    {
      type: 'loadCasePage',
      caseId: 'case-flow-1',
      caseType: 'example-review',
      currentUserId: 'user-controls',
      capabilities: {
        isReviewer: false,
        listAccessCaseTypes: [],
        isAdviser: false,
        ownedCaseTypes: [],
        ownedJourneyCaseTypes: [],
        isControls: true,
        isReviewerManager: false,
        isResponsiblePartyManager: false,
        isMaintainer: false,
        isVisitor: false,
      },
    },
    {
      type: 'resolveAppeal',
      actorId: 'user-controls',
      verdict: 'rejected',
      rationale: 'The original outcome stands.',
    },
  ]);

  const saved = runner.snapshot().lists['Cases-ExampleReview'][0];
  assert.equal(saved.appeals?.[0].resolution?.verdict, 'rejected');
  assert.equal(saved.amendedOutcome, undefined);
});
