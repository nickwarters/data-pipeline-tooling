// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';

installDom();

const { SECTION_PANELS } =
  await import('../src/pages/cora-case-review/section-panels.js');
const { default: complaintsConfig } =
  await import('../case-types/complaints.js');
const { resolveSectionLabels } = await import('../src/lib/section-labels.js');

const PERSON = { loginName: 'corp\\jsmith', displayName: 'Jane Smith' };

/** @type {any} */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Was the complaint acknowledged?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

/**
 * Mount the shipped Issues panel over one failed Answer, with the Case Type
 * config a live Complaints Case is reviewed against — including its `person`
 * Issue Capture Field.
 *
 * @param {{ capture?: any, captureSearch?: any, actions?: any }} [options]
 */
function issuesPanel(options = {}) {
  /** @type {any[]} */
  const calls = [];
  const nodes = /** @type {any} */ (SECTION_PANELS.issues)({
    snapshot: {
      catalogue: CATALOGUE,
      answers: { q1: { value: 'No', capture: options.capture ?? {} } },
      machine: { canEditIssues: true },
      access: {},
      sectionLabels: resolveSectionLabels(complaintsConfig),
    },
    caseRow: { responsibleParty: '', responsiblePartyDisplayName: '' },
    config: complaintsConfig,
    route: {
      captureCollapsed: {},
      captureSearch: options.captureSearch ?? {},
      responsiblePartySearch: { query: '', people: [] },
    },
    dispatch: () => {},
    actions: {
      currentAnswers: () => ({ q1: { value: 'No' } }),
      editAnswers: (/** @type {any} */ next) => calls.push(['edit', next]),
      requestCaptureSearch: (/** @type {any[]} */ ...args) =>
        calls.push(['search', ...args]),
      captureEdited: (/** @type {any[]} */ ...args) =>
        calls.push(['capture', ...args]),
      ...options.actions,
    },
  });
  const root = document.createElement('div');
  root.append(...nodes);
  return { root, calls };
}

test('Issues tab: a failed Answer offers one person control, not two', () => {
  // The capture field is now the only person control on a failed Answer.
  const { root } = issuesPanel();
  // Scoped to the failure itself: the Responsible Party picker at the foot of
  // the tab is Case-level and is a different question.
  const item = root.querySelector('.cora-remediation-item');

  assert.deepEqual(
    queryAllByRole(item, 'combobox', { name: /Search people/ }).map((el) =>
      el.getAttribute('aria-label')
    ),
    ['Search people for Attributed to']
  );
});

test('Issues tab: a Complaints person capture field is a people picker', () => {
  const { root, calls } = issuesPanel({
    captureSearch: { q1: { attributedTo: { query: 'Ja', people: [PERSON] } } },
  });

  const input = getByRole(root, 'combobox', {
    name: 'Search people for Attributed to',
  });
  assert.equal(input.value, 'Ja');

  input.value = 'Jan';
  fireEvent(input, 'input');
  assert.deepEqual(calls, [['search', 'q1', 'attributedTo', 'Jan']]);

  fireEvent(getByRole(root, 'option', { name: /Jane Smith/ }), 'click');
  assert.deepEqual(calls[1], ['capture', 'q1', 'attributedTo', PERSON]);
});

test('Issues tab: every capture edit travels one action, whatever its type', () => {
  const cleared = issuesPanel({ capture: { attributedTo: PERSON } });
  fireEvent(
    getByRole(cleared.root, 'button', { name: 'Clear Attributed to' }),
    'click'
  );
  assert.deepEqual(cleared.calls, [['capture', 'q1', 'attributedTo', null]]);

  const typed = issuesPanel();
  const summary = getByRole(typed.root, 'textbox', {
    name: 'Root cause summary',
  });
  summary.value = 'Handoff missed';
  fireEvent(summary, 'change');
  assert.deepEqual(typed.calls, [
    ['capture', 'q1', 'rootCauseSummary', 'Handoff missed'],
  ]);
});
