// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';
import { AmendOutcomePlugin } from '../src/sections/amend-outcome/amend-outcome-plugin.js';
import {
  getSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';

installDom();

test('AmendOutcomePlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('amendOutcome'), AmendOutcomePlugin);
  assert.equal(AmendOutcomePlugin.id, 'amendOutcome');
  assert.equal(AmendOutcomePlugin.tab, true);
  assert.equal(AmendOutcomePlugin.tabOrder, 9);
  assert.equal(AmendOutcomePlugin.summaryBlock, false);
  assert.equal(AmendOutcomePlugin.summaryOrder, 0);
  assert.equal(AmendOutcomePlugin.showInSummaryDefault, false);
  assert.deepEqual(AmendOutcomePlugin.defaultLabels, {
    tab: 'Amend Outcome',
    heading: 'Amend Case Outcome',
  });
});

test('AmendOutcomePlugin evaluateAccess gates strictly to controls role and reportable statuses', () => {
  // Non-controls role is hidden even on completed cases
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.COMPLETED }),
      roles: ['assignedReviewer'],
    }),
    'hidden'
  );
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.COMPLETED }),
      roles: ['none'],
    }),
    'hidden'
  );

  // Controls role on unreportable/pre-freeze case is hidden
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.TO_ALLOCATE }),
      roles: ['controls'],
    }),
    'hidden'
  );
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.IN_PROGRESS }),
      roles: ['controls'],
    }),
    'hidden'
  );
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.VOID }),
      roles: ['controls'],
    }),
    'hidden'
  );

  // Controls role on reportable cases gets edit
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.COMPLETED }),
      roles: ['controls'],
    }),
    'edit'
  );
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.ACTIONS_IN_PROGRESS }),
      roles: ['controls'],
    }),
    'edit'
  );

  // Controls role with no caseRow provided defaults to edit
  assert.equal(
    AmendOutcomePlugin.evaluateAccess({
      caseRow: /** @type {any} */ (null),
      roles: ['controls'],
    }),
    'edit'
  );
});

test('AmendOutcomePlugin view renders section and handles amend submission', async () => {
  /** @type {any[]} */
  const amends = [];

  const panelContext = /** @type {any} */ ({
    snapshot: {
      access: { amendOutcome: 'edit' },
      sectionLabels: { amendOutcome: { heading: 'Amend Case Outcome' } },
    },
    caseRow: {
      id: 'case-1',
      status: CASE_STATUS.COMPLETED,
      outcomeAtCompletion: 'fail',
      effectiveOutcome: 'fail',
    },
    config: {
      outcomeOptions: [
        { id: 'pass', wording: 'Pass' },
        { id: 'fail', wording: 'Fail' },
      ],
      extraAmendmentReasons: [
        { key: 'qa-review', label: 'QA Review Correction' },
      ],
    },
    dispatch: () => {},
    actions: {
      appeals: {
        amend: (/** @type {any} */ args) => amends.push(args),
      },
    },
  });

  const node = /** @type {HTMLElement} */ (
    AmendOutcomePlugin.view(panelContext)
  );
  assert.ok(node);
  assert.ok(node.className.includes('cora-amend-outcome'));

  // Fill in form controls
  const selectOutcome = /** @type {HTMLSelectElement} */ (
    getByRole(node, 'combobox', { name: 'Amended outcome' })
  );
  assert.ok(selectOutcome);
  selectOutcome.value = 'pass';
  fireEvent(selectOutcome, 'change');

  const selectReason = /** @type {HTMLSelectElement} */ (
    getByRole(node, 'combobox', { name: 'Amendment reason' })
  );
  assert.ok(selectReason);
  selectReason.value = 'qa-review';
  fireEvent(selectReason, 'change');

  const textarea = /** @type {HTMLTextAreaElement} */ (
    getByRole(node, 'textbox', { name: 'Amendment justification' })
  );
  assert.ok(textarea);
  textarea.value = 'Discovered critical issue.';
  fireEvent(textarea, 'input');

  const submitBtn = getByRole(node, 'button', { name: 'Amend Outcome' });
  assert.ok(submitBtn);
  fireEvent(submitBtn, 'click');

  assert.equal(amends.length, 1);
  assert.equal(amends[0].outcome, 'pass');
  assert.equal(amends[0].reason, 'qa-review');
  assert.equal(amends[0].justification, 'Discovered critical issue.');
});
