// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { QuestionsPlugin } from '../src/sections/questions/questions-plugin.js';
import {
  getSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';

installDom();

test('QuestionsPlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('questions'), QuestionsPlugin);
  assert.equal(QuestionsPlugin.id, 'questions');
  assert.equal(QuestionsPlugin.tab, true);
  assert.equal(QuestionsPlugin.tabOrder, 2);
  assert.equal(QuestionsPlugin.summaryBlock, true);
  assert.equal(QuestionsPlugin.summaryOrder, 2);
  assert.equal(QuestionsPlugin.showInSummaryDefault, true);
  assert.deepEqual(QuestionsPlugin.defaultLabels, {
    tab: 'Questions',
    heading: 'Question Bank Review',
  });
});

test('QuestionsPlugin evaluateAccess handles assigned reviewer and observer permissions', () => {
  // Assigned reviewer before freeze gets edit
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.IN_PROGRESS }),
      roles: ['assignedReviewer'],
    }),
    'edit'
  );

  // Assigned reviewer after freeze gets read-only
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.COMPLETED }),
      roles: ['assignedReviewer'],
    }),
    'read-only'
  );
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.ACTIONS_IN_PROGRESS }),
      roles: ['assignedReviewer'],
    }),
    'read-only'
  );
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: CASE_STATUS.VOID }),
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
      QuestionsPlugin.evaluateAccess({
        caseRow: /** @type {any} */ ({ status: CASE_STATUS.IN_PROGRESS }),
        roles: [/** @type {any} */ (role)],
      }),
      'read-only'
    );
  }

  // RP side and none get hidden
  for (const role of ['responsibleParty', 'responsiblePartyManager', 'none']) {
    assert.equal(
      QuestionsPlugin.evaluateAccess({
        caseRow: /** @type {any} */ ({ status: CASE_STATUS.IN_PROGRESS }),
        roles: [/** @type {any} */ (role)],
      }),
      'hidden'
    );
  }
});

test('QuestionsPlugin evaluateAccess handles multi-role viewers with allow-list precedence', () => {
  const inProgressCase = /** @type {any} */ ({
    status: CASE_STATUS.IN_PROGRESS,
  });

  // Assigned reviewer + observer role: assigned reviewer wins (edit)
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['assignedReviewer', 'controls'],
    }),
    'edit'
  );

  // Observer role + RP-side role: observer wins (read-only)
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'controls'],
    }),
    'read-only'
  );
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsiblePartyManager', 'reviewerManager'],
    }),
    'read-only'
  );

  // RP-side only: hidden
  assert.equal(
    QuestionsPlugin.evaluateAccess({
      caseRow: inProgressCase,
      roles: ['responsibleParty', 'responsiblePartyManager'],
    }),
    'hidden'
  );
});

test('QuestionsPlugin view delegates to questionsView.view and renders panels', () => {
  let viewCalled = false;
  let answerUpdated = false;
  const mockContext = /** @type {any} */ ({
    snapshot: {
      catalogue: [],
      applicableQuestions: [],
      answers: {},
      access: { questions: 'edit' },
      sectionLabels: { questions: { heading: 'Question Bank' } },
      config: { generalQuestions: [] },
    },
    actions: {
      questionsView: {
        view: (/** @type {any} */ args) => {
          viewCalled = true;
          if (args.onGroupOutcome) {
            args.onGroupOutcome('General', 'pass');
          }
          return document.createElement('div');
        },
      },
      currentAnswers: () => ({}),
      editAnswers: () => {
        answerUpdated = true;
      },
      onAnswer: () => {},
    },
  });

  const result = QuestionsPlugin.view(mockContext);
  assert.ok(result);
  assert.equal(viewCalled, true);
  assert.equal(answerUpdated, true);
});

test('QuestionsPlugin view throws when actions.questionsView is missing or invalid', () => {
  assert.throws(
    () => QuestionsPlugin.view(/** @type {any} */ ({ actions: {} })),
    /QuestionsPlugin requires actions\.questionsView with a view method/
  );
  assert.throws(
    () =>
      QuestionsPlugin.view(
        /** @type {any} */ ({ actions: { questionsView: () => {} } })
      ),
    /QuestionsPlugin requires actions\.questionsView with a view method/
  );
});
