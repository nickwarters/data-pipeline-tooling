// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';
import { resolveSectionLabels } from '../src/lib/section-labels.js';
import { makeCaseRow, makeChrome } from './helpers/fixtures.js';
import {
  getSectionPlugin,
  getSectionPlugins,
} from '../src/sections/registry.js';

installDom();

const { createQuestionPanelView } =
  await import('../src/pages/cora-case-review/question-panel-view.js');

test('every tab Section plugin provides a view renderer', () => {
  const tabIds = getSectionPlugins()
    .filter((p) => p.tab)
    .map((p) => p.id);
  for (const id of tabIds) {
    const plugin = getSectionPlugin(id);
    assert.ok(plugin, `plugin ${id} must exist`);
    assert.equal(typeof plugin.view, 'function', `plugin ${id} must have view`);
  }
});

test('conversation plugin is registered and has view, but is not a tab', () => {
  const plugin = getSectionPlugin('conversation');
  assert.ok(plugin);
  assert.equal(plugin.tab, false);
  assert.equal(typeof plugin.view, 'function');
});

test('plugins own completion on Summary and Void on Case Details', () => {
  const chrome = makeChrome({ currentUser: { id: 'u1' } });
  const caseRow = makeCaseRow({
    id: 'c1',
    title: 'Case',
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
  });
  /** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
  const config = {
    questions: [],
    computeOutcome: () => ({ outcome: 'pass' }),
    outcomeOptions: [],
    defaultOutcomeId: 'pass',
    captureGroups: [],
    detailFields: [],
  };
  /** @type {import('../src/pages/cora-case-review.js').CaseReviewSnapshot} */
  const snapshot = {
    loaded: true,
    error: null,
    accessDenied: false,
    caseRow,
    currentUser: chrome.currentUser,
    catalogue: [],
    answers: {},
    applicableQuestions: [],
    allAnswered: true,
    summarySections: [],
    sectionLabels: resolveSectionLabels(null),
    bankVersion: null,
    versionWarning: null,
    access: {
      details: 'read-only',
      questions: 'edit',
      issues: 'edit',
      remediation: 'hidden',
      summary: 'read-only',
      notes: 'edit',
      conversation: 'edit',
      appealRequest: 'hidden',
      appealReview: 'hidden',
      amendOutcome: 'hidden',
    },
    machine: /** @type {any} */ ({
      canComplete: true,
      canVoid: true,
      mayResolveRemediation: false,
      catalogue: [],
    }),
    config,
    caseListOptions: {},
  };
  /** @type {import('../src/pages/cora-case-review.js').CaseReviewRouteState} */
  const route = {
    activeTab: 'summary',
    saveStatus: 'saved',
    conversationHidden: true,
    voidPanelOpen: false,
    voidPending: false,
    voidReason: '',
    voidReasonNote: '',
    completionPending: false,
    captureCollapsed: {},
    captureSearch: {},
    responsiblePartySearch: { query: '', people: [], status: 'idle' },
    snapshot: null,
  };
  /** @type {import('../src/pages/cora-case-review/section-panels.js').PanelActions} */
  const actions = {
    questionsView: createQuestionPanelView(),
    currentAnswers: () => ({}),
    editAnswers: () => {},
    onAnswer: () => {},
    captureEdited: () => {},
    requestCaptureSearch: () => {},
    selectResponsibleParty: () => {},
    requestResponsiblePartySearch: () => {},
    save: { fieldEdited: () => {} },
    editDetailField: () => {},
    editCaseField: () => {},
    appeals: /** @type {any} */ ({}),
    onComplete: () => {},
    onVoid: () => {},
  };
  /** @type {import('../src/pages/cora-case-review/section-panels.js').PanelContext} */
  const context = {
    snapshot,
    caseRow,
    config,
    route,
    dispatch: () => {},
    actions,
  };

  const summaryPlugin = getSectionPlugin('summary');
  const detailsPlugin = getSectionPlugin('details');
  assert.ok(summaryPlugin);
  assert.ok(detailsPlugin);
  const summary = summaryPlugin.view(context);
  const details = detailsPlugin.view(context);
  assert.ok(findByClass({ _children: summary }, 'cora-completion'));
  assert.equal(findByClass({ _children: summary }, 'cora-void'), null);
  assert.ok(findByClass({ _children: details }, 'cora-void'));
  assert.equal(findByClass({ _children: details }, 'cora-completion'), null);
});

test('the issues panel names the Responsible Party rather than showing their account', () => {
  /** @param {any} caseRow */
  const issuesPanel = (caseRow) => {
    /** @type {any} */
    const ctx = {
      snapshot: {
        catalogue: [],
        answers: {},
        access: {},
        sectionLabels: { issues: { heading: 'Issues' } },
        machine: { canEditIssues: false },
      },
      caseRow,
      config: {},
      route: {
        captureCollapsed: {},
        responsiblePartySearch: { query: '', people: [] },
      },
      dispatch: () => {},
      actions: { currentAnswers: () => ({}), editAnswers: () => {} },
    };
    const plugin = getSectionPlugin('issues');
    assert.ok(plugin);
    const nodes = plugin.view(ctx);
    return findByClass({ _children: nodes }, 'cora-responsible-party-value');
  };

  assert.equal(
    issuesPanel({
      responsibleParty: 'jsmith',
      responsiblePartyDisplayName: 'John Smith',
    }).textContent,
    'Responsible Party: John Smith'
  );
  assert.equal(
    issuesPanel({ responsibleParty: 'jsmith' }).textContent,
    'Responsible Party: jsmith',
    'a row read before the person column was expanded still names someone'
  );
});

test('the remediation panel offers only the resolutions the Case Type declares', () => {
  /** @type {any} */
  const ctx = {
    snapshot: {
      catalogue: [
        {
          id: 'q1',
          text: 'Greeted the customer?',
          responseType: 'yes-no-na',
          failureValues: ['No'],
          deprecated: false,
        },
      ],
      answers: {
        q1: { value: 'No', freeFormRemediation: 'Write to the customer' },
      },
      access: { remediation: 'edit', conversation: 'edit' },
      sectionLabels: { remediation: { heading: 'Remediation' } },
      machine: { roles: ['assignedReviewer'] },
    },
    caseRow: { id: 1, status: 'Actions In Progress' },
    config: { remediationStatuses: ['complete', 'cancelled'] },
    route: { conversationHidden: true },
    dispatch: () => {},
    actions: { currentAnswers: () => ({}), editAnswers: () => {} },
  };

  const plugin = getSectionPlugin('remediation');
  assert.ok(plugin);
  const nodes = plugin.view(ctx);
  const select = findByClass(
    { _children: nodes },
    'cora-tracking-status-select'
  );
  assert.deepEqual(
    select._children.map((/** @type {any} */ option) => option.value),
    ['', 'complete', 'cancelled']
  );
});

test('a Group Outcome on the questions panel answers the whole group at once', () => {
  /** @type {any[]} */
  const questions = ['o1', 'o2'].map((id) => ({
    id,
    text: `Question ${id}`,
    questionGroup: 'Alpha',
    responseType: 'outcome',
    options: ['Good', 'Poor'],
    deprecated: false,
  }));
  /** @type {any[]} */
  const written = [];
  /** @type {any} */
  const ctx = {
    snapshot: {
      catalogue: questions,
      applicableQuestions: questions,
      answers: {},
      access: { questions: 'edit' },
      sectionLabels: { questions: { heading: 'Questions' } },
      config: { questionGroups: { Alpha: { allowBulkOutcome: true } } },
    },
    caseRow: { id: 1 },
    config: { questionGroups: { Alpha: { allowBulkOutcome: true } } },
    route: {},
    dispatch: () => {},
    actions: {
      questionsView: createQuestionPanelView(),
      currentAnswers: () => ({}),
      editAnswers: (/** @type {any} */ next) => written.push(next),
      onAnswer: () => {},
    },
  };

  const plugin = getSectionPlugin('questions');
  assert.ok(plugin);
  const nodes = plugin.view(ctx);
  const select = findByClass({ _children: nodes }, 'cora-group-outcome');
  select.value = 'Poor';
  fireEvent(select, 'change');

  assert.equal(written.length, 1);
  assert.deepEqual(written[0], {
    o1: { value: 'Poor' },
    o2: { value: 'Poor' },
  });
});

/**
 * @param {any} config
 * @returns {any}
 */
function amendReasonSelect(config) {
  /** @type {any} */
  const ctx = {
    snapshot: {
      access: { amendOutcome: 'edit' },
      sectionLabels: { amendOutcome: { heading: 'Amend Outcome' } },
    },
    caseRow: { id: 1, status: 'Completed', outcomeAtCompletion: 'fail' },
    config,
    route: {},
    dispatch: () => {},
    actions: { appeals: { amend: () => {} } },
  };
  const plugin = getSectionPlugin('amendOutcome');
  assert.ok(plugin);
  const panel = plugin.view(ctx);
  return findByClass(panel, 'cora-amend-outcome-reason');
}

test('the amend panel offers the shared Amendment Reasons plus whatever the Case Type declares', () => {
  const select = amendReasonSelect({
    extraAmendmentReasons: [
      { key: 'data-correction', label: 'Data correction' },
    ],
  });
  assert.deepEqual(
    select._children.map((/** @type {any} */ o) => o.value),
    ['', 'qa-check', 'tm-check', 'appeal', 'data-correction']
  );
});
