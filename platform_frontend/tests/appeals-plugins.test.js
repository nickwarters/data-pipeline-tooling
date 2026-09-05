// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';
import { AppealRequestPlugin } from '../src/sections/appeals/appeal-request-plugin.js';
import { AppealReviewPlugin } from '../src/sections/appeals/appeal-review-plugin.js';
import {
  getSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';

installDom();

test('AppealRequestPlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('appealRequest'), AppealRequestPlugin);
  assert.equal(AppealRequestPlugin.id, 'appealRequest');
  assert.equal(AppealRequestPlugin.tab, true);
  assert.equal(AppealRequestPlugin.tabOrder, 7);
  assert.equal(AppealRequestPlugin.summaryBlock, false);
  assert.equal(AppealRequestPlugin.summaryOrder, 0);
  assert.equal(AppealRequestPlugin.showInSummaryDefault, false);
  assert.deepEqual(AppealRequestPlugin.defaultLabels, {
    tab: 'Appeal',
    heading: 'Request Appeal',
  });
});

test('AppealRequestPlugin evaluateAccess controls raiser and hidden modes', () => {
  const completedCase = /** @type {any} */ ({ status: CASE_STATUS.COMPLETED });
  const inProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.IN_PROGRESS,
  });

  // Fails closed if caseRow is absent
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: /** @type {any} */ (null),
      roles: ['responsiblePartyManager'],
    }),
    'hidden'
  );

  // Hidden when case is not completed
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsiblePartyManager'],
    }),
    'hidden'
  );

  // Default raiser is responsiblePartyManager on completed case
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['responsiblePartyManager'],
    }),
    'edit'
  );

  // When configured with raisedBy: 'journeyOwner'
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['journeyOwner'],
      config: /** @type {any} */ ({ appeal: { raisedBy: 'journeyOwner' } }),
    }),
    'edit'
  );
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['responsiblePartyManager'],
      config: /** @type {any} */ ({ appeal: { raisedBy: 'journeyOwner' } }),
    }),
    'hidden'
  );

  // Non-raiser roles are hidden (it is a form for raising, not observer record)
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['controls'],
    }),
    'hidden'
  );
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['assignedReviewer'],
    }),
    'hidden'
  );
  assert.equal(
    AppealRequestPlugin.evaluateAccess({
      caseRow: completedCase,
      roles: ['none'],
    }),
    'hidden'
  );
});

test('AppealRequestPlugin view renders section and handles raise submission', () => {
  /** @type {any[]} */
  const raised = [];

  const panelContext = /** @type {any} */ ({
    snapshot: {
      access: { appealRequest: 'edit' },
      sectionLabels: { appealRequest: { heading: 'Challenge Outcome' } },
      catalogue: [],
      answers: {},
    },
    caseRow: {
      id: 'case-1',
      status: CASE_STATUS.COMPLETED,
      appeals: [],
    },
    dispatch: () => {},
    actions: {
      appeals: {
        raise: (/** @type {any} */ args) => raised.push(args),
      },
    },
  });

  const node = /** @type {HTMLElement} */ (
    AppealRequestPlugin.view(panelContext)
  );
  assert.ok(node);
  assert.ok(node.className.includes('cora-appeal'));

  const textarea = /** @type {HTMLTextAreaElement} */ (
    getByRole(node, 'textbox', { name: 'Appeal rationale' })
  );
  assert.ok(textarea);
  textarea.value = 'The review missed key context.';
  fireEvent(textarea, 'input');

  const submitBtn = getByRole(node, 'button', { name: 'Raise Appeal' });
  assert.ok(submitBtn);
  fireEvent(submitBtn, 'click');

  assert.equal(raised.length, 1);
  assert.equal(raised[0].rationale, 'The review missed key context.');
});

test('AppealReviewPlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('appealReview'), AppealReviewPlugin);
  assert.equal(AppealReviewPlugin.id, 'appealReview');
  assert.equal(AppealReviewPlugin.tab, true);
  assert.equal(AppealReviewPlugin.tabOrder, 8);
  assert.equal(AppealReviewPlugin.summaryBlock, false);
  assert.equal(AppealReviewPlugin.summaryOrder, 0);
  assert.equal(AppealReviewPlugin.showInSummaryDefault, false);
  assert.deepEqual(AppealReviewPlugin.defaultLabels, {
    tab: 'Appeal Review',
    heading: 'Appeal Review',
  });
});

test('AppealReviewPlugin evaluateAccess strictly gates by controls role and appeal state', () => {
  const openAppeal = {
    id: 'appeal-1',
    appellant: 'u1',
    at: '2026-06-01T00:00:00Z',
    rationale: 'Review incorrect',
    state: 'raised',
  };
  const resolvedAppeal = {
    id: 'appeal-1',
    appellant: 'u1',
    at: '2026-06-01T00:00:00Z',
    rationale: 'Review incorrect',
    state: 'resolved',
    verdict: 'rejected',
  };

  // Non-controls role is always hidden
  assert.equal(
    AppealReviewPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({
        status: CASE_STATUS.COMPLETED,
        appeals: [openAppeal],
      }),
      roles: ['assignedReviewer'],
    }),
    'hidden'
  );

  // Controls with missing caseRow or no appeals is hidden
  assert.equal(
    AppealReviewPlugin.evaluateAccess({
      caseRow: /** @type {any} */ (null),
      roles: ['controls'],
    }),
    'hidden'
  );
  assert.equal(
    AppealReviewPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({
        status: CASE_STATUS.COMPLETED,
        appeals: [],
      }),
      roles: ['controls'],
    }),
    'hidden'
  );

  // Controls with open appeal on completed case gets edit
  assert.equal(
    AppealReviewPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({
        status: CASE_STATUS.COMPLETED,
        appeals: [openAppeal],
      }),
      roles: ['controls'],
    }),
    'edit'
  );

  // Controls with all appeals resolved gets read-only
  assert.equal(
    AppealReviewPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({
        status: CASE_STATUS.COMPLETED,
        appeals: [resolvedAppeal],
      }),
      roles: ['controls'],
    }),
    'read-only'
  );
});

test('AppealReviewPlugin view renders section and handles resolve submission', () => {
  /** @type {any[]} */
  const resolutions = [];

  const panelContext = /** @type {any} */ ({
    snapshot: {
      access: { appealReview: 'edit' },
      sectionLabels: { appealReview: { heading: 'Review Appeal' } },
    },
    caseRow: {
      id: 'case-1',
      status: CASE_STATUS.COMPLETED,
      appeals: [
        {
          id: 'appeal-1',
          appellant: 'u1',
          at: '2026-06-01T00:00:00Z',
          rationale: 'Review incorrect',
          state: 'raised',
        },
      ],
    },
    config: {
      outcomeOptions: [
        { id: 'pass', wording: 'Pass' },
        { id: 'fail', wording: 'Fail' },
      ],
    },
    dispatch: () => {},
    actions: {
      appeals: {
        resolve: (/** @type {any} */ args) => resolutions.push(args),
      },
    },
  });

  const node = /** @type {HTMLElement} */ (
    AppealReviewPlugin.view(panelContext)
  );
  assert.ok(node);
  assert.ok(node.className.includes('cora-appeal-review'));

  const rejectRadio = /** @type {HTMLInputElement} */ (
    getByRole(node, 'radio', { name: 'Reject' })
  );
  assert.ok(rejectRadio);
  rejectRadio.checked = true;
  fireEvent(rejectRadio, 'change');

  const rationaleTextarea = /** @type {HTMLTextAreaElement} */ (
    getByRole(node, 'textbox', { name: 'Resolution rationale' })
  );
  assert.ok(rationaleTextarea);
  rationaleTextarea.value = 'The original outcome stands.';
  fireEvent(rationaleTextarea, 'input');

  const resolveBtn = getByRole(node, 'button', { name: 'Resolve Appeal' });
  assert.ok(resolveBtn);
  fireEvent(resolveBtn, 'click');

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].resolution.verdict, 'rejected');
  assert.equal(
    resolutions[0].resolution.rationale,
    'The original outcome stands.'
  );
});
