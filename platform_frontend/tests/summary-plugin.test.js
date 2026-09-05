// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { SummaryPlugin } from '../src/sections/summary/summary-plugin.js';
import {
  getSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';

installDom();

test('SummaryPlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('summary'), SummaryPlugin);
  assert.equal(SummaryPlugin.id, 'summary');
  assert.equal(SummaryPlugin.tab, true);
  assert.equal(SummaryPlugin.tabOrder, 4);
  assert.equal(SummaryPlugin.summaryBlock, false);
  assert.equal(SummaryPlugin.summaryOrder, 0);
  assert.equal(SummaryPlugin.showInSummaryDefault, true);
  assert.deepEqual(SummaryPlugin.defaultLabels, {
    tab: 'Summary',
    heading: 'Case Summary',
  });
});

test('SummaryPlugin evaluateAccess checks reportable and completed gates for RP roles', () => {
  const inProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.IN_PROGRESS,
  });
  const actionsCase = /** @type {any} */ ({
    status: CASE_STATUS.ACTIONS_IN_PROGRESS,
  });
  const completedCase = /** @type {any} */ ({ status: CASE_STATUS.COMPLETED });

  // Standard reviewer and observer roles get read-only on any status
  for (const role of [
    'assignedReviewer',
    'otherReviewer',
    'reviewerManager',
    'caseTypeOwner',
    'journeyOwner',
    'controls',
  ]) {
    assert.equal(
      SummaryPlugin.evaluateAccess({
        caseRow: inProgressCase,
        roles: [/** @type {any} */ (role)],
      }),
      'read-only'
    );
  }

  // Responsible party: hidden while in progress, read-only once reportable
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty'],
    }),
    'hidden'
  );
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: actionsCase,
      roles: ['responsibleParty'],
    }),
    'read-only'
  );
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['responsibleParty'],
    }),
    'read-only'
  );

  // Responsible party manager: hidden until Completed
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsiblePartyManager'],
    }),
    'hidden'
  );
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: actionsCase,
      roles: ['responsiblePartyManager'],
    }),
    'hidden'
  );
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['responsiblePartyManager'],
    }),
    'read-only'
  );

  // None role is hidden
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['none'],
    }),
    'hidden'
  );
});

test('SummaryPlugin evaluateAccess: most permissive mode wins across overlapping roles', () => {
  const inProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.IN_PROGRESS,
  });

  // Reviewer-side observer + RP: reviewer-side wins (read-only)
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'controls'],
    }),
    'read-only'
  );

  // Reviewer-side observer + RP manager: reviewer-side wins (read-only)
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsiblePartyManager', 'otherReviewer'],
    }),
    'read-only'
  );
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsiblePartyManager', 'reviewerManager'],
    }),
    'read-only'
  );
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'caseTypeOwner'],
    }),
    'read-only'
  );
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'journeyOwner'],
    }),
    'read-only'
  );

  // Pure RP-side roles remain hidden while in progress
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'responsiblePartyManager'],
    }),
    'hidden'
  );

  // None + observer role: read-only
  assert.equal(
    SummaryPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['none', 'controls'],
    }),
    'read-only'
  );
});

test('SummaryPlugin view renders summaryView and completion control', () => {
  const panelContext = /** @type {any} */ ({
    snapshot: {
      machine: { roles: ['assignedReviewer'] },
      catalogue: [],
      answers: {},
      allAnswered: true,
      summarySections: [],
      sectionLabels: { summary: { heading: 'Case Summary' } },
    },
    caseRow: {
      id: 'case-1',
      status: CASE_STATUS.IN_PROGRESS,
    },
    config: {
      captureGroups: [],
      detailFields: [],
      outcomeOptions: [],
      generalQuestions: [],
      computeOutcome: () => null,
    },
    route: {
      completionPending: false,
    },
    actions: {
      onComplete: () => {},
    },
  });

  const rendered = SummaryPlugin.view(panelContext);
  assert.ok(Array.isArray(rendered));
  assert.ok(rendered.length >= 1);
});

test('SummaryPlugin view renders summary without completion control when not applicable', () => {
  const panelContext = /** @type {any} */ ({
    snapshot: {},
    caseRow: { id: 'case-2', status: CASE_STATUS.COMPLETED },
  });

  const rendered = SummaryPlugin.view(panelContext);
  assert.ok(Array.isArray(rendered));
  assert.equal(rendered.length, 1);
});
