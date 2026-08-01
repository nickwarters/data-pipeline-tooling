// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';
import { SECTION_REGISTRY, tabEntries } from '../src/lib/section-registry.js';

installDom();

const { SECTION_PANELS } =
  await import('../src/pages/cora-case-review/section-panels.js');
const { createQuestionPanelView } =
  await import('../src/pages/cora-case-review/question-panel-view.js');

/**
 * The point of the panel map: the Case Review render loop no longer
 * branches on Section id, so a Section added to the registry with no panel used
 * to be invisible — it got a tab and an empty panel. These two assertions are
 * the replacement for that branch chain's implicit exhaustiveness.
 */

test('every tab Section has a panel renderer', () => {
  assert.deepEqual(
    tabEntries()
      .map((entry) => entry.id)
      .sort(),
    Object.keys(SECTION_PANELS).sort()
  );
});

test('adding a tab Section without a panel breaks the correspondence', () => {
  const withNewSection = [
    ...SECTION_REGISTRY,
    {
      id: /** @type {any} */ ('reworkedThing'),
      tab: true,
      tabOrder: 10,
      summaryBlock: false,
      summaryOrder: 0,
      showInSummaryDefault: true,
    },
  ];
  const ids = tabEntries(withNewSection)
    .map((entry) => entry.id)
    .sort();
  assert.notDeepEqual(ids, Object.keys(SECTION_PANELS).sort());
  assert.equal(
    ids.filter((id) => !(id in SECTION_PANELS)).join(),
    'reworkedThing'
  );
});

test('conversation is not a panel — it is a floating overlay', () => {
  assert.equal('conversation' in SECTION_PANELS, false);
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
        machine: { canSelectRemediation: false },
      },
      caseRow,
      config: {},
      route: {
        captureCollapsed: {},
        attributionSearch: {},
        responsiblePartySearch: { query: '', people: [] },
      },
      dispatch: () => {},
      actions: { currentAnswers: () => ({}), editAnswers: () => {} },
    };
    const nodes = /** @type {any} */ (SECTION_PANELS.issues)(ctx);
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

  const panel = /** @type {any} */ (SECTION_PANELS.remediation);
  const nodes = panel(ctx);
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

  const nodes = /** @type {any} */ (SECTION_PANELS.questions)(ctx);
  const select = findByClass({ _children: nodes }, 'cora-group-outcome');
  select.value = 'Poor';
  fireEvent(select, 'change');

  assert.equal(written.length, 1);
  assert.deepEqual(written[0], {
    o1: { value: 'Poor' },
    o2: { value: 'Poor' },
  });
});
