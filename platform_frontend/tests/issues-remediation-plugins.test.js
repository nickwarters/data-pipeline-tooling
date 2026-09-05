// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { IssuesPlugin } from '../src/sections/issues/issues-plugin.js';
import { RemediationPlugin } from '../src/sections/remediation/remediation-plugin.js';
import {
  getSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';

installDom();

test('IssuesPlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('issues'), IssuesPlugin);
  assert.equal(IssuesPlugin.id, 'issues');
  assert.equal(IssuesPlugin.tab, true);
  assert.equal(IssuesPlugin.tabOrder, 3);
  assert.equal(IssuesPlugin.summaryBlock, true);
  assert.equal(IssuesPlugin.summaryOrder, 3);
  assert.equal(IssuesPlugin.showInSummaryDefault, true);
  assert.deepEqual(IssuesPlugin.defaultLabels, {
    tab: 'Issues',
    heading: 'Issues & Remediation Required',
  });
});

test('IssuesPlugin evaluateAccess gates assigned reviewer, observers, and frontline roles', () => {
  // Unfrozen reviewer gets edit
  assert.equal(
    IssuesPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.IN_PROGRESS }),
      roles: ['assignedReviewer'],
    }),
    'edit'
  );

  // Frozen reviewer gets read-only
  assert.equal(
    IssuesPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.COMPLETED }),
      roles: ['assignedReviewer'],
    }),
    'read-only'
  );

  // Observers get read-only
  for (const role of [
    'otherReviewer',
    'reviewerManager',
    'caseTypeOwner',
    'journeyOwner',
    'controls',
  ]) {
    assert.equal(
      IssuesPlugin.evaluateAccess({
        caseRow: /** @type {any} */ ({ status: CASE_STATUS.IN_PROGRESS }),
        roles: [/** @type {any} */ (role)],
      }),
      'read-only'
    );
  }

  // Non-reviewers get hidden
  for (const role of ['responsibleParty', 'responsiblePartyManager', 'none']) {
    assert.equal(
      IssuesPlugin.evaluateAccess({
        caseRow: /** @type {any} */ ({ status: CASE_STATUS.IN_PROGRESS }),
        roles: [/** @type {any} */ (role)],
      }),
      'hidden'
    );
  }
});

test('IssuesPlugin evaluateAccess handles multi-role viewers with allow-list precedence', () => {
  const inProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.IN_PROGRESS,
  });

  // Assigned reviewer + observer role: assigned reviewer wins (edit)
  assert.equal(
    IssuesPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['assignedReviewer', 'controls'],
    }),
    'edit'
  );

  // Observer role + RP-side role: observer wins (read-only)
  assert.equal(
    IssuesPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'controls'],
    }),
    'read-only'
  );
  assert.equal(
    IssuesPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsiblePartyManager', 'reviewerManager'],
    }),
    'read-only'
  );

  // RP-side only: hidden
  assert.equal(
    IssuesPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'responsiblePartyManager'],
    }),
    'hidden'
  );
});

test('IssuesPlugin view renders remediation section and handles dispatch callbacks', () => {
  const panelContext = /** @type {any} */ ({
    snapshot: {
      machine: { canEditIssues: true },
      catalogue: [
        {
          id: 'q1',
          type: 'singleChoice',
          wording: 'Q1',
          failureValues: ['fail'],
          options: [{ id: 'fail', wording: 'Fail' }],
        },
      ],
      answers: {
        q1: {
          value: 'fail',
          remediationRequired: 'yes',
        },
      },
      sectionLabels: { issues: { heading: 'Issues Heading' } },
    },
    caseRow: {
      id: 'case-1',
      status: CASE_STATUS.IN_PROGRESS,
      responsibleParty: 'alice',
      responsiblePartyDisplayName: 'Alice Smith',
    },
    config: {
      captureGroups: [],
    },
    route: {
      captureCollapsed: {},
      captureSearch: {},
      responsiblePartySearch: { query: '', people: [], status: 'idle' },
    },
    dispatch: () => {},
    actions: {
      selectResponsibleParty: () => {},
      requestResponsiblePartySearch: () => {},
      captureEdited: () => {},
      requestCaptureSearch: () => {},
      currentAnswers: () => ({}),
      editAnswers: () => {},
    },
  });

  const rendered = IssuesPlugin.view(panelContext);
  assert.ok(rendered);
});

test('RemediationPlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('remediation'), RemediationPlugin);
  assert.equal(RemediationPlugin.id, 'remediation');
  assert.equal(RemediationPlugin.tab, true);
  assert.equal(RemediationPlugin.tabOrder, 5);
  assert.equal(RemediationPlugin.summaryBlock, true);
  assert.equal(RemediationPlugin.summaryOrder, 4);
  assert.equal(RemediationPlugin.showInSummaryDefault, true);
  assert.deepEqual(RemediationPlugin.defaultLabels, {
    tab: 'Remediation',
    heading: 'Remediation Actions',
  });
});

test('RemediationPlugin evaluateAccess checks reportable state and remediation requirement', () => {
  const catalogue = /** @type {any} */ ([
    {
      id: 'q1',
      type: 'singleChoice',
      wording: 'Q1',
      failureValues: ['fail'],
      options: [{ id: 'fail', wording: 'Fail' }],
    },
  ]);

  const inProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.IN_PROGRESS,
    answers: {
      q1: {
        value: 'fail',
        remediationRequired: 'yes',
        freeFormRemediation: 'Fix this',
      },
    },
  });

  const actionsInProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.ACTIONS_IN_PROGRESS,
    answers: {
      q1: {
        value: 'fail',
        remediationRequired: 'yes',
        freeFormRemediation: 'Fix this',
      },
    },
  });

  const completedCase = /** @type {any} */ ({
    status: CASE_STATUS.COMPLETED,
    answers: {
      q1: {
        value: 'fail',
        remediationRequired: 'yes',
        freeFormRemediation: 'Fix this',
      },
    },
  });

  // Not reportable yet -> hidden
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['assignedReviewer'],
      catalogue,
    }),
    'hidden'
  );

  // Actions In Progress with remediation -> edit for assignedReviewer
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: actionsInProgressCase,
      roles: ['assignedReviewer'],
      catalogue,
    }),
    'edit'
  );

  // Completed with remediation -> read-only for assignedReviewer
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['assignedReviewer'],
      catalogue,
    }),
    'read-only'
  );

  // Observers get read-only when live
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: actionsInProgressCase,
      roles: ['responsibleParty'],
      catalogue,
    }),
    'read-only'
  );
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: actionsInProgressCase,
      roles: ['controls'],
      catalogue,
    }),
    'read-only'
  );

  // Role 'none' gets hidden
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: actionsInProgressCase,
      roles: ['none'],
      catalogue,
    }),
    'hidden'
  );
});

test('RemediationPlugin evaluateAccess handles multi-role viewers with allow-list precedence', () => {
  const catalogue = /** @type {any} */ ([
    {
      id: 'q1',
      type: 'singleChoice',
      wording: 'Q1',
      failureValues: ['fail'],
      options: [{ id: 'fail', wording: 'Fail' }],
    },
  ]);

  const actionsInProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.ACTIONS_IN_PROGRESS,
    answers: {
      q1: {
        value: 'fail',
        remediationRequired: 'yes',
        freeFormRemediation: 'Fix this',
      },
    },
  });

  // Assigned reviewer + controls: assignedReviewer wins (edit on actions-in-progress)
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: actionsInProgressCase,
      roles: ['assignedReviewer', 'controls'],
      catalogue,
    }),
    'edit'
  );

  // Observer role + RP-side role: read-only
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: actionsInProgressCase,
      roles: ['responsibleParty', 'controls'],
      catalogue,
    }),
    'read-only'
  );
  assert.equal(
    RemediationPlugin.evaluateAccess({
      caseRow: actionsInProgressCase,
      roles: ['responsiblePartyManager', 'reviewerManager'],
      catalogue,
    }),
    'read-only'
  );
});

test('RemediationPlugin view renders tracking component and wires callbacks', () => {
  const panelContext = /** @type {any} */ ({
    snapshot: {
      catalogue: [],
      answers: {},
      machine: { roles: ['assignedReviewer'] },
      access: { remediation: 'edit', conversation: 'read-only' },
      sectionLabels: { remediation: { heading: 'Remediation Heading' } },
    },
    caseRow: { id: 'c-1', status: CASE_STATUS.ACTIONS_IN_PROGRESS },
    config: { remediationStatuses: [] },
    route: { conversationHidden: true },
    dispatch: () => {},
    actions: {
      currentAnswers: () => ({}),
      editAnswers: () => {},
    },
  });

  const rendered = RemediationPlugin.view(panelContext);
  assert.ok(rendered);
});
