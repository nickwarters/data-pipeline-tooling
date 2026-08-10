// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInMemoryFlowRunner,
  runFlowFixture,
} from './_in-memory-flow-runner.js';
import exampleReviewConfig from './_example-review-case-type.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';
import {
  ACTION_CENTRE_REASONS,
  activeFilter,
} from '../src/services/action-centre-model.js';

const CASE_ROW = makeCaseRow({
  id: 'case-flow-1',
  caseType: 'example-review',
  title: 'Flow fixture case',
  responsibleParty: 'user-agent-a',
  etag: 'etag-flow-1',
});

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

  assert.equal(runner.caseLoader, null);
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
          type: 'setRemediationRequired',
          questionId: 'q-needs',
          required: 'yes',
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
          type: 'setRemediationStatus',
          questionId: 'q-needs',
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
  assert.ok(row.remediationDueDate, 'Send Actions stores the working-day SLA');
  assert.ok(row.completedAt, 'the second lifecycle transition closes the Case');
  // The persisted Answer shape is the contract: moving
  // the write path to the store must be invisible to a stored Case.
  assert.deepEqual(row.answers['q-needs'], {
    value: 'No',
    remediationRequired: 'yes',
    capture: {
      sentActions: [{ id: 'sent-1', text: 'Coach agent', status: 'pending' }],
      rootCause: 'Reviewer missed the evidence.',
    },
    freeFormRemediation: 'Coach the reviewer.',
    remediationActions: [
      {
        id: 'q-needs-ra-0',
        text: 'Retrain agent on needs-identification protocol.',
      },
    ],
    remediationStatus: { status: 'complete' },
  });
});

test('a failed Question with no Remediation Required decision cannot leave In-progress', async () => {
  const runner = createInMemoryFlowRunner(
    { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    { persona: 'reviewer' }
  );
  const stored = () =>
    /** @type {import('../src/sharepoint-client.js').CaseRow} */ (
      runner
        .snapshot()
        .lists['Cases-ExampleReview'].find((c) => c.id === 'case-flow-1')
    );

  await runner.run([
    { type: 'loadCasePage', caseId: 'case-flow-1', caseType: 'example-review' },
    { type: 'answer', questionId: 'q-welcome', value: 'Yes' },
    { type: 'answer', questionId: 'q-needs', value: 'No' },
    { type: 'answer', questionId: 'q-channel', value: 'Phone' },
    { type: 'answer', questionId: 'q-products', value: ['Account'] },
    { type: 'clickCompleteCase' },
  ]);
  assert.equal(stored().status, 'In-progress');
  assert.deepEqual(runner.navigations, []);

  await runner.run([
    {
      type: 'setRemediationRequired',
      questionId: 'q-needs',
      required: 'yes',
    },
    { type: 'clickCompleteCase' },
  ]);
  assert.equal(
    stored().status,
    'In-progress',
    'Yes with nothing recorded is not a decision the Case can be sent on'
  );
});

test('a failure the Reviewer marks as needing no remediation completes the Case directly', async () => {
  const runner = createInMemoryFlowRunner(
    { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    { persona: 'reviewer' }
  );
  await runner.run([
    { type: 'loadCasePage', caseId: 'case-flow-1', caseType: 'example-review' },
    { type: 'answer', questionId: 'q-welcome', value: 'Yes' },
    { type: 'answer', questionId: 'q-needs', value: 'No' },
    { type: 'answer', questionId: 'q-channel', value: 'Phone' },
    { type: 'answer', questionId: 'q-products', value: ['Account'] },
    { type: 'setRemediationRequired', questionId: 'q-needs', required: 'no' },
    {
      type: 'captureIssue',
      questionId: 'q-needs',
      fieldKey: 'rootCause',
      value: 'Agent skipped the needs check.',
    },
    { type: 'clickCompleteCase' },
  ]);

  const row = /** @type {import('../src/sharepoint-client.js').CaseRow} */ (
    runner
      .snapshot()
      .lists['Cases-ExampleReview'].find((c) => c.id === 'case-flow-1')
  );
  assert.equal(row.status, 'Completed');
  assert.equal(row.outcomeAtCompletion, 'fail');
  assert.equal(row.hadRemediation, false);
  assert.equal('remediationDueDate' in row, false);
  assert.deepEqual(row.answers['q-needs'], {
    value: 'No',
    remediationRequired: 'no',
    capture: { rootCause: 'Agent skipped the needs check.' },
  });
});

test('a required Issue Capture Field holds the Case until the Reviewer fills it', async () => {
  const runner = createInMemoryFlowRunner(
    { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    { persona: 'reviewer' }
  );
  const stored = () =>
    /** @type {import('../src/sharepoint-client.js').CaseRow} */ (
      runner
        .snapshot()
        .lists['Cases-ExampleReview'].find((c) => c.id === 'case-flow-1')
    );

  await runner.run([
    { type: 'loadCasePage', caseId: 'case-flow-1', caseType: 'example-review' },
    { type: 'answer', questionId: 'q-welcome', value: 'Yes' },
    { type: 'answer', questionId: 'q-needs', value: 'No' },
    { type: 'answer', questionId: 'q-channel', value: 'Phone' },
    { type: 'answer', questionId: 'q-products', value: ['Account'] },
    { type: 'setRemediationRequired', questionId: 'q-needs', required: 'no' },
    { type: 'clickCompleteCase' },
  ]);
  assert.equal(
    stored().status,
    'In-progress',
    'the Case Type asks for a Root cause on every failure, and it is empty'
  );
  assert.deepEqual(runner.navigations, []);

  await runner.run([
    {
      type: 'captureIssue',
      questionId: 'q-needs',
      fieldKey: 'rootCause',
      value: 'Agent skipped the needs check.',
    },
    { type: 'clickCompleteCase' },
  ]);
  assert.equal(
    stored().status,
    'Completed',
    'filling the last required field releases the same gate'
  );
});

test('switching a failure from Yes to No drops the actions from the stored Answer', async () => {
  const runner = createInMemoryFlowRunner(
    { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    { persona: 'reviewer' }
  );
  const storedAnswer = () =>
    /** @type {any} */ (
      runner
        .snapshot()
        .lists['Cases-ExampleReview'].find((c) => c.id === 'case-flow-1')
    ).answers['q-needs'];

  await runner.run([
    { type: 'loadCasePage', caseId: 'case-flow-1', caseType: 'example-review' },
    { type: 'answer', questionId: 'q-needs', value: 'No' },
    { type: 'setRemediationRequired', questionId: 'q-needs', required: 'yes' },
    {
      type: 'selectRemediationAction',
      questionId: 'q-needs',
      action: {
        id: 'q-needs-ra-0',
        text: 'Retrain agent on needs-identification protocol.',
      },
    },
    {
      type: 'freeFormRemediation',
      questionId: 'q-needs',
      value: 'Coach the reviewer.',
    },
  ]);
  assert.equal(storedAnswer().remediationActions.length, 1);

  await runner.run([
    { type: 'setRemediationRequired', questionId: 'q-needs', required: 'no' },
  ]);
  assert.deepEqual(storedAnswer(), {
    value: 'No',
    remediationRequired: 'no',
  });
});

test('in-memory flow runner completes allocate, review, remediate, appeal, and amend lifecycle', async () => {
  const noCapabilities = makePermissions({ isReviewer: false });
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
          type: 'captureIssue',
          questionId: 'q-needs',
          fieldKey: 'rootCause',
          value: 'Reviewer missed the evidence.',
        },
        {
          type: 'setRemediationRequired',
          questionId: 'q-needs',
          required: 'yes',
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
          type: 'setRemediationStatus',
          questionId: 'q-needs',
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
});

test('an Actions In Progress Case cannot close while a sent Remediation Action is unresolved', async () => {
  // The safety claim, at the seam that actually writes the lifecycle. The
  // Case Type declares **no** `actions`-typed Issue Capture Field — the
  // production shape — so the gate can only come from the canonical
  // Answer-level store (`remediationActions` + `remediationStatus`).
  /** @type {import('../src/sharepoint-client.js').CaseRow} */
  const sent = {
    ...CASE_ROW,
    status: 'Actions In Progress',
    reportableAt: '2026-07-20T09:00:00.000Z',
    remediationDueDate: '2026-08-03',
    outcomeAtCompletion: 'fail',
    hadRemediation: true,
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-channel': { value: 'Phone' },
      'q-products': { value: ['Account'] },
      'q-needs': {
        value: 'No',
        remediationRequired: 'yes',
        remediationActions: [
          {
            id: 'q-needs-ra-0',
            text: 'Retrain agent on needs-identification protocol.',
          },
        ],
      },
    },
  };
  const runner = createInMemoryFlowRunner({
    lists: { 'Cases-ExampleReview': [sent] },
  });
  const stored = () =>
    /** @type {import('../src/sharepoint-client.js').CaseRow} */ (
      runner
        .snapshot()
        .lists['Cases-ExampleReview'].find((c) => c.id === 'case-flow-1')
    );

  await runner.run([
    { type: 'loadCasePage', caseId: 'case-flow-1', caseType: 'example-review' },
    { type: 'clickCompleteCase' },
  ]);
  assert.equal(stored().status, 'Actions In Progress');
  assert.equal(stored().completedAt, null);

  // Picking a status is not resolving it: `partial` without its details leaves
  // the row unresolved, so the gate still refuses.
  await runner.run([
    { type: 'setRemediationStatus', questionId: 'q-needs', status: 'partial' },
    { type: 'clickCompleteCase' },
  ]);
  assert.deepEqual(stored().answers['q-needs'].remediationStatus, {
    status: 'partial',
    details: '',
  });
  assert.equal(stored().status, 'Actions In Progress');
  assert.equal(stored().completedAt, null);

  // Only once every row carries the text its status requires does it close.
  await runner.run([
    {
      type: 'setRemediationStatus',
      questionId: 'q-needs',
      status: 'partial',
      details: 'Coaching booked; refresher outstanding.',
    },
    { type: 'clickCompleteCase' },
  ]);
  assert.equal(stored().status, 'Completed');
  assert.ok(stored().completedAt);
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
      capabilities: makePermissions({ isReviewer: false, isControls: true }),
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

test('in-memory flow runner owns the Case Row; the loader hands it over once', async () => {
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
      currentUserId: 'user-owner',
      capabilities: makePermissions({
        isReviewer: false,
        ownedJourneyCaseTypes: ['example-review'],
      }),
    },
  ]);
  // Captured at the handover, so the assertions below can name the row the
  // loader produced rather than a field it happens to lack.
  const loadedRow = runner.caseLoader?.caseRow;
  assert.ok(loadedRow, 'the load produced a Case Row');
  assert.equal(runner.caseRow, loadedRow, 'the runner takes it at handover');

  await runner.run([
    {
      type: 'raiseAppeal',
      actorId: 'user-owner',
      rationale: 'The completed outcome is too severe.',
    },
  ]);

  // The runner is the single owner, exactly as the store is in the browser: the
  // transition's Case Row lands here and nowhere else.
  assert.equal(runner.caseRow?.appeals?.[0].state, 'raised');
  assert.notEqual(
    runner.caseRow,
    loadedRow,
    'the transition replaced the runner’s row rather than mutating it'
  );
  // Identity, not the absence of a field: the loader still holds the very row
  // `load()` produced, whatever the fixture happens to define on it.
  assert.equal(
    runner.caseLoader?.caseRow,
    loadedRow,
    'the loader keeps the row it loaded; the Appeal is the store owner’s'
  );
  assert.equal(
    runner.snapshot().lists['Cases-ExampleReview'][0].appeals?.[0].state,
    'raised'
  );
});

test('completing a Case updates the runner-owned Case Row, so later actions see the transition', async () => {
  const runner = createInMemoryFlowRunner(
    { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    { persona: 'reviewer' }
  );
  await runner.run([
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
  ]);
  assert.equal(runner.caseRow?.status, CASE_ROW.status);

  await runner.run([{ type: 'clickCompleteCase' }]);

  // The browser never needs this: `completeCase` navigates to the dashboard on
  // success, so the mount ends before anything can read a stale row. The runner
  // does not navigate, so a flow may keep acting on the Case — its row has to
  // carry the transition or the next action reads pre-completion state.
  const persisted = runner
    .snapshot()
    .lists['Cases-ExampleReview'].find((c) => c.id === 'case-flow-1');
  assert.equal(persisted?.status, 'Completed');
  assert.equal(
    runner.caseRow?.status,
    persisted?.status,
    'the runner-owned row matches what was persisted'
  );
  assert.equal(
    runner.caseRow?.outcomeAtCompletion,
    persisted?.outcomeAtCompletion
  );
  // The navigation the browser would have performed, asserted rather than
  // tolerated: the runner has no `location`, so it passes a recorder in place of
  // the seam.
  assert.deepEqual(runner.navigations, ['#/dashboard']);
  // The getter copies, so a caller reading the record cannot rewrite it.
  runner.navigations.push('#/junk');
  assert.deepEqual(
    runner.navigations,
    ['#/dashboard'],
    'the navigation record is copy-on-read'
  );
});

test('a refused completion navigates nowhere', async () => {
  const runner = createInMemoryFlowRunner(
    { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    { persona: 'reviewer' }
  );
  await runner.run([
    {
      type: 'loadCasePage',
      caseId: 'case-flow-1',
      caseType: 'example-review',
    },
    // No Answers, so `completionPatch` returns null and nothing is written.
    { type: 'clickCompleteCase' },
  ]);

  assert.deepEqual(runner.navigations, []);
});

test('a refused completion leaves the runner-owned Case Row untouched', async () => {
  const runner = createInMemoryFlowRunner(
    { lists: { 'Cases-ExampleReview': [CASE_ROW] } },
    { persona: 'reviewer' }
  );
  await runner.run([
    {
      type: 'loadCasePage',
      caseId: 'case-flow-1',
      caseType: 'example-review',
    },
    // No Answers, so `completionPatch` returns null and nothing is written.
    { type: 'clickCompleteCase' },
  ]);

  assert.equal(runner.caseRow?.status, CASE_ROW.status);
  assert.equal(
    runner.snapshot().lists['Cases-ExampleReview'][0].status,
    CASE_ROW.status
  );
});

// Both Awaiting Frontline tests below ask the same question of the same group:
// how many Cases the reason filter finds for this Reviewer.
const awaitingReason = ACTION_CENTRE_REASONS.find(
  (reason) => reason.id === 'awaitingFrontline'
);
assert.ok(awaitingReason);
/** @param {ReturnType<typeof createInMemoryFlowRunner>} runner */
const countAwaiting = (runner) =>
  runner.client.countCases(activeFilter(awaitingReason, 'user-reviewer'), {
    listName: 'Cases-ExampleReview',
  });

// Send Actions is itself a hand-off to the Responsible Party, so it must put
// the Case in the Awaiting Frontline group without waiting for anyone to post a
// Message. Driven end to end — the real completion action, the real client and
// the real reason filter — because the flag only matters if the query finds it.
test('Send Actions puts the Case in the Awaiting Frontline group until it is closed', async () => {
  const runner = createInMemoryFlowRunner({
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
  });
  assert.equal(await countAwaiting(runner), 0);

  await runner.run([
    { type: 'loadCasePage', caseId: 'case-flow-1', caseType: 'example-review' },
    { type: 'answer', questionId: 'q-welcome', value: 'Yes' },
    { type: 'answer', questionId: 'q-channel', value: 'Phone' },
    { type: 'answer', questionId: 'q-products', value: ['Account'] },
    {
      type: 'captureIssue',
      questionId: 'q-needs',
      fieldKey: 'rootCause',
      value: 'Reviewer missed the evidence.',
    },
    { type: 'setRemediationRequired', questionId: 'q-needs', required: 'yes' },
    {
      type: 'freeFormRemediation',
      questionId: 'q-needs',
      value: 'Coach the reviewer.',
    },
    { type: 'clickCompleteCase' },
  ]);

  assert.equal(await countAwaiting(runner), 1);
  const sent = runner.snapshot().lists['Cases-ExampleReview'][0];
  assert.equal(sent.status, 'Actions In Progress');
  assert.equal(sent.awaitingSince, sent.reportableAt);

  await runner.run([
    { type: 'loadCasePage', caseId: 'case-flow-1', caseType: 'example-review' },
    { type: 'setRemediationStatus', questionId: 'q-needs', status: 'complete' },
    { type: 'clickCompleteCase' },
  ]);

  assert.equal(await countAwaiting(runner), 0);
  const closed = runner.snapshot().lists['Cases-ExampleReview'][0];
  assert.equal(closed.status, 'Completed');
  assert.equal(closed.awaitingResponsibleParty, false);
});

// The Awaiting Frontline group is a query, not a rendering: a Case only
// reaches it if the transition wrote the flag the query reads. This drives the
// real store's posting effect, the real client and the real reason filter, so
// nothing between the Send button and the reason count is stubbed.
test('a Reviewer’s Message puts the Case in the Awaiting Frontline group, and a reply takes it out', async () => {
  // This Case Type only opens the thread once the Remediation Actions have
  // been sent, which is exactly when a Reviewer is waiting on the frontline.
  const runner = createInMemoryFlowRunner({
    lists: {
      'Cases-ExampleReview': [
        {
          ...CASE_ROW,
          status: /** @type {const} */ ('Actions In Progress'),
          reportableAt: '2026-07-19T10:00:00Z',
          outcomeAtCompletion: 'fail',
        },
      ],
    },
  });
  assert.equal(await countAwaiting(runner), 0);

  await runner.run([
    {
      type: 'loadCasePage',
      caseId: 'case-flow-1',
      caseType: 'example-review',
    },
    { type: 'postMessage', body: 'Please send the call recording.' },
  ]);

  assert.equal(await countAwaiting(runner), 1);
  const asked = runner.snapshot().lists['Cases-ExampleReview'][0];
  // The clock is the message's own authored time, not the moment the write
  // reached the list.
  assert.equal(asked.awaitingSince, asked.conversation.at(-1)?.timestamp);

  await runner.run([
    {
      type: 'loadCasePage',
      caseId: 'case-flow-1',
      caseType: 'example-review',
      currentUserId: 'user-agent-a',
      capabilities: makePermissions({ isReviewer: false, isAdviser: true }),
    },
    { type: 'postMessage', body: 'Recording attached.' },
  ]);

  assert.equal(await countAwaiting(runner), 0);
  const replied = runner.snapshot().lists['Cases-ExampleReview'][0];
  assert.equal(replied.awaitingResponsibleParty, false);
  assert.equal(replied.awaitingSince, null);
});
