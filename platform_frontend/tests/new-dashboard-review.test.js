// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByRole,
  textContent,
} from './helpers/semantic-dom.js';
import { sharePointOptions } from '../src/new-dashboard/page-context.js';
import { installRouteBoundaryReload } from '../src/new-dashboard/route-boundary.js';
import {
  VOID_REASONS,
  voidReasonsFor,
} from '../src/new-dashboard/void-reasons.js';
import { createMockClient } from '../src/new-dashboard/browser.js';

installDom();
const { mountNewDashboard } =
  await import('../src/new-dashboard/new-dashboard.js');

const config = /** @type {any} */ ({
  listName: 'Cases-Complaints',
  displayName: 'Complaints',
  sections: {
    details: {},
    questions: {},
    issues: {},
    summary: {},
    notes: {},
    remediation: {},
    conversation: {},
  },
  questions: [
    {
      id: 'q1',
      text: 'Compliant?',
      responseType: 'outcome',
      options: ['Yes', 'No'],
      optionOutcomes: { Yes: 'good', No: 'poor' },
    },
  ],
  outcomeOptions: [
    { id: 'good', wording: 'Good', severity: 0 },
    { id: 'poor', wording: 'Poor', severity: 100 },
  ],
  defaultOutcomeId: 'good',
});

function row(overrides = {}) {
  return /** @type {any} */ ({
    id: '42',
    title: 'Sensitive complaint',
    status: 'In-progress',
    assignedReviewer: 'alex',
    answers: {},
    conversation: [],
    notes: '',
    etag: 'v1',
    ...overrides,
  });
}

test('the page context builds the retained client correctly for prod and UAT', () => {
  assert.deepEqual(
    sharePointOptions({
      CORA_ENV: 'prod',
      _spPageContextInfo: { webServerRelativeUrl: '/sites/cora' },
    }),
    {
      webUrl: '/sites/cora',
      listPrefix: '',
      exportBasePath: '/Style%20Library/case-review/case-types',
    }
  );
  assert.deepEqual(
    sharePointOptions({
      CORA_ENV: 'uat',
      _spPageContextInfo: { webAbsoluteUrl: 'https://example.test/sites/cora' },
    }),
    {
      webUrl: 'https://example.test/sites/cora',
      listPrefix: 'uat_',
      exportBasePath: '/Style%20Library/case-review-uat/case-types',
    }
  );
});

test('the clean browser mock searches the retained people fixture', async () => {
  const client = await createMockClient('reviewer');
  assert.deepEqual(await client.searchPeople('Wei Chen'), [
    {
      loginName: 'contractor1',
      displayName: 'Wei Chen',
      email: 'wei.chen@contractor.example',
    },
  ]);
});

test('Void Reasons use the exact persisted vocabulary and config only narrows it', () => {
  assert.deepEqual(
    VOID_REASONS.map(({ key, label }) => [key, label]),
    [
      ['duplicate', 'Duplicate of another Case'],
      ['raised-in-error', 'Raised in error'],
      ['out-of-scope', 'Out of scope for review'],
      ['no-evidence', 'Evidence unavailable'],
      ['superseded', 'Superseded by another Case'],
      ['withdrawn', 'Withdrawn by the business'],
    ]
  );
  assert.deepEqual(
    voidReasonsFor({
      voidReasons: ['raised-in-error', 'withdrawn', 'created-in-error'],
    }).map(({ key }) => key),
    ['raised-in-error', 'withdrawn']
  );
});

test('hash navigation reloads only when crossing the clean-route boundary', () => {
  /** @type {Function | undefined} */
  let listener;
  let reloads = 0;
  const target = {
    location: {
      hash: '#/dashboard',
      reload: () => reloads++,
    },
    addEventListener: (
      /** @type {string} */ _type,
      /** @type {Function} */ next
    ) => (listener = next),
  };
  installRouteBoundaryReload(target);
  target.location.hash = '#/cases';
  listener?.();
  assert.equal(reloads, 0);
  target.location.hash = '#/new_dashboard/complaints/42';
  listener?.();
  assert.equal(reloads, 1);
  target.location.hash = '#/new_dashboard/complaints/43';
  listener?.();
  assert.equal(reloads, 2);
  target.location.hash = '#/dashboard';
  listener?.();
  assert.equal(reloads, 3);
});

test('successful writes consume data.etag from the retained PatchResult', async () => {
  const root = document.createElement('main');
  /** @type {Function[]} */
  const tasks = [];
  /** @type {string[]} */
  const etags = [];
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: (task) => (tasks.push(task), tasks.length),
    cancelSchedule: () => {},
    client: {
      getCase: async () => row(),
      patchCase: async (
        /** @type {any} */ _id,
        /** @type {any} */ _fields,
        /** @type {string} */ etag
      ) => {
        etags.push(etag);
        const next = `v${etags.length + 1}`;
        return { ok: true, status: 200, data: row({ etag: next }) };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'No' }), 'change', {
    target: { value: 'No' },
  });
  await tasks.at(-1)?.();
  fireEvent(getByRole(root, 'radio', { name: 'Yes' }), 'change', {
    target: { value: 'Yes' },
  });
  await tasks.at(-1)?.();
  assert.deepEqual(etags, ['v1', 'v2']);
});

test('status 412 is surfaced as an ETag conflict', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let task;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: (next) => ((task = next), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => row(),
      patchCase: async () => ({ ok: false, status: 412 }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
  fireEvent(getByRole(root, 'textbox', { name: 'Notes' }), 'input', {
    target: { value: 'draft' },
  });
  await task?.();
  assert.match(textContent(root), /Save conflict/);
});

test('debounced edits coalesce into one write without losing fields', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let task;
  /** @type {any[]} */
  const writes = [];
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: (next) => ((task = next), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => row(),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        writes.push(fields);
        return { ok: true, status: 200, data: row({ etag: 'v2' }) };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'No' }), 'change', {
    target: { value: 'No' },
  });
  fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
  fireEvent(getByRole(root, 'textbox', { name: 'Notes' }), 'input', {
    target: { value: 'Keep this too' },
  });
  await task?.();
  assert.deepEqual(writes, [
    {
      answers: { q1: { value: 'No' } },
      notes: 'Keep this too',
    },
  ]);
});

test('a lifecycle write flushes pending answers and uses their returned ETag', async () => {
  const root = document.createElement('main');
  /** @type {any[]} */
  const writes = [];
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: () => 1,
    cancelSchedule: () => {},
    now: () => new Date('2026-08-05T12:00:00Z'),
    client: {
      getCase: async () => row(),
      patchCase: async (
        /** @type {any} */ _id,
        /** @type {any} */ fields,
        /** @type {string} */ etag
      ) => {
        writes.push([fields, etag]);
        return {
          ok: true,
          status: 200,
          data: row({ etag: etag === 'v1' ? 'v2' : 'v3' }),
        };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'Yes' }), 'change', {
    target: { value: 'Yes' },
  });
  fireEvent(getByRole(root, 'button', { name: 'Complete Case' }), 'click');
  await flush();
  await flush();
  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes.map((write) => write[1]),
    ['v1', 'v2']
  );
  assert.deepEqual(writes[0][0], { answers: { q1: { value: 'Yes' } } });
  assert.equal(writes[1][0].status, 'Completed');
});

test('disposing the route flushes the latest pending edit', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: () => 1,
    cancelSchedule: () => {},
    client: {
      getCase: async () => row(),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, status: 200, data: row({ etag: 'v2' }) };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
  fireEvent(getByRole(root, 'textbox', { name: 'Notes' }), 'input', {
    target: { value: 'Last edit' },
  });
  mounted.dispose();
  await mounted.flush();
  assert.deepEqual(written, { notes: 'Last edit' });
});

test('typing preserves the live field node across successive input events', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: () => 1,
    cancelSchedule: () => {},
    client: { getCase: async () => row(), patchCase: async () => ({}) },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
  const field = getByRole(root, 'textbox', { name: 'Notes' });
  fireEvent(field, 'input', { target: { value: 'a' } });
  assert.equal(getByRole(root, 'textbox', { name: 'Notes' }), field);
  fireEvent(field, 'input', { target: { value: 'ab' } });
  assert.equal(getByRole(root, 'textbox', { name: 'Notes' }), field);
});

test('autosave completion preserves the focused node and caret while updating status', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let task;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: (next) => ((task = next), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => row(),
      patchCase: async () => ({
        ok: true,
        status: 200,
        data: row({ etag: 'v2' }),
      }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
  const field = getByRole(root, 'textbox', { name: 'Notes' });
  field.focus();
  field.setSelectionRange(2, 4);
  fireEvent(field, 'input', { target: { value: 'draft' } });
  await task?.();
  assert.equal(getByRole(root, 'textbox', { name: 'Notes' }), field);
  assert.equal(document.activeElement, field);
  assert.deepEqual([field.selectionStart, field.selectionEnd], [2, 4]);
  assert.equal(getByRole(root, 'status').textContent, 'Saved');
});

test('failed and conflicting autosaves also preserve the focused editor', async () => {
  for (const [result, expected] of [
    [{ ok: false, status: 500 }, 'Save failed'],
    [{ ok: false, status: 412 }, 'Save conflict — reload the Case'],
  ]) {
    const root = document.createElement('main');
    /** @type {Function | undefined} */
    let task;
    const mounted = mountNewDashboard({
      root,
      hash: '#/new_dashboard/complaints/42',
      loadConfig: async () => config,
      schedule: (next) => ((task = next), 1),
      cancelSchedule: () => {},
      client: {
        getCase: async () => row(),
        patchCase: async () => result,
      },
    });
    await mounted.ready;
    fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
    const field = getByRole(root, 'textbox', { name: 'Notes' });
    field.focus();
    field.setSelectionRange(1, 3);
    fireEvent(field, 'input', { target: { value: 'draft' } });
    await task?.();
    assert.equal(getByRole(root, 'textbox', { name: 'Notes' }), field);
    assert.deepEqual([field.selectionStart, field.selectionEnd], [1, 3]);
    assert.equal(getByRole(root, 'status').textContent, expected);
  }
});

test('a viewer with no role is denied before Case identity is exposed', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () => row(),
      getCurrentUser: async () => ({ id: 'stranger', displayName: 'Stranger' }),
      getCurrentUserGroups: async () => [],
    },
  });
  await mounted.ready;
  assert.equal(
    getByRole(root, 'alert').textContent.includes('Access denied'),
    true
  );
  assert.doesNotMatch(textContent(root), /Sensitive complaint|Reviewer: alex/);
});

test('only the assigned Reviewer can update remediation resolution', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        row({
          status: 'Actions In Progress',
          responsibleParty: 'sam',
          answers: {
            q1: {
              value: 'No',
              remediationRequired: 'yes',
              remediationActions: [{ id: 'fix', text: 'Fix it' }],
            },
          },
        }),
      getCurrentUser: async () => ({ id: 'sam', displayName: 'Sam' }),
      getCurrentUserGroups: async () => [],
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REMEDIATION' }), 'click');
  assert.ok(
    queryAllByRole(root, 'radio').every((radio) => radio.disabled === true)
  );
});

test('the conversation toggle exposes live state and Alt+C changes it', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: { getCase: async () => row() },
  });
  await mounted.ready;
  let toggle = getByRole(root, 'button', {
    name: 'Toggle conversation panel (⌥C / Alt+C)',
  });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  fireEvent(getByTag(root, 'article'), 'keydown', {
    altKey: true,
    key: 'c',
  });
  toggle = getByRole(root, 'button', {
    name: 'Toggle conversation panel (⌥C / Alt+C)',
  });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
});

test('multi-choice Questions persist arrays and drive failure Issues', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let task;
  /** @type {any} */
  let written;
  const multi = {
    ...config,
    questions: [
      {
        id: 'q1',
        text: 'Select findings',
        responseType: 'multi-choice',
        options: ['Clean', 'Error'],
        optionOutcomes: { Clean: 'good', Error: 'poor' },
      },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => multi,
    schedule: (next) => ((task = next), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => row(),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, status: 200, data: row({ etag: 'v2' }) };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  fireEvent(getByRole(root, 'checkbox', { name: 'Error' }), 'change', {
    target: { value: 'Error', checked: true },
  });
  await task?.();
  assert.deepEqual(written.answers.q1.value, ['Error']);
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');
  assert.match(textContent(getByRole(root, 'tabpanel')), /Select findings/);
});

test('section copy, General Questions placement, group overrides, and response vocab are config driven', async () => {
  const root = document.createElement('main');
  const varied = {
    ...config,
    sectionLabels: {
      questions: { tab: 'CHECKS', heading: 'Configured checks' },
    },
    generalQuestionsPlacement: 'before',
    generalQuestions: [{ key: 'context', label: 'Context', type: 'text' }],
    allowBulkOutcome: false,
    questionGroups: { Checks: { allowBulkOutcome: true } },
    questions: [
      {
        id: 'yes-no',
        text: 'Binary',
        questionGroup: 'Checks',
        responseType: 'yes-no',
        optionOutcomes: { Yes: 'good', No: 'poor' },
      },
      {
        id: 'single',
        text: 'Single',
        questionGroup: 'Checks',
        responseType: 'single-choice',
        options: ['One', 'Two'],
        optionOutcomes: { One: 'good', Two: 'poor' },
      },
      {
        id: 'multi',
        text: 'Multiple',
        questionGroup: 'Checks',
        responseType: 'multi-choice',
        options: ['A', 'B'],
        optionOutcomes: { A: 'good', B: 'poor' },
      },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => varied,
    client: { getCase: async () => row() },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'CHECKS' }), 'click');
  const panel = getByRole(root, 'tabpanel');
  assert.equal(getByTag(panel, 'h2').textContent, 'Configured checks');
  const generalIndex = panel._children.findIndex(
    (/** @type {any} */ child) => child.className === 'cora-general-questions'
  );
  const listIndex = panel._children.findIndex(
    (/** @type {any} */ child) => child.className === 'cora-question-list'
  );
  assert.ok(generalIndex < listIndex);
  assert.ok(
    queryAllByRole(panel, 'combobox', {
      name: 'Group outcome for Checks',
    }).length === 1
  );
  const binary = getByRole(panel, 'radiogroup', { name: 'Binary' });
  assert.deepEqual(
    queryAllByRole(binary, 'radio').map((control) => control.value),
    ['Yes', 'No', 'NA']
  );
  const single = getByRole(panel, 'radiogroup', { name: 'Single' });
  assert.deepEqual(
    queryAllByRole(single, 'radio').map((control) => control.value),
    ['One', 'Two', 'NA']
  );
  const multiple = getByRole(panel, 'group', { name: 'Multiple' });
  assert.deepEqual(
    queryAllByRole(multiple, 'checkbox').map((control) => control.value),
    ['A', 'B', 'NA']
  );
});

test('capture showWhen, required gating, and person selection are config driven', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let task;
  /** @type {any} */
  let written;
  const captureConfig = {
    ...config,
    captureGroups: [
      {
        key: 'cause',
        label: 'Cause',
        fields: [
          {
            key: 'confirmed',
            label: 'Confirmed?',
            type: 'radio',
            options: ['Yes', 'No'],
            required: true,
          },
          {
            key: 'owner',
            label: 'Attributed person',
            type: 'person',
            required: true,
            showWhen: { confirmed: { equals: 'Yes' } },
          },
        ],
      },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => captureConfig,
    schedule: (next) => ((task = next), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () =>
        row({
          answers: { q1: { value: 'No', remediationRequired: 'no' } },
        }),
      searchPeople: async () => [
        { loginName: 'jane', displayName: 'Jane Smith' },
      ],
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, status: 200, data: row({ etag: 'v2' }) };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');
  assert.equal(
    queryAllByRole(root, 'textbox', { name: 'Attributed person' }).length,
    0
  );
  const confirmed = getByRole(root, 'group', { name: 'Confirmed?' });
  fireEvent(getByRole(confirmed, 'radio', { name: 'Yes' }), 'change', {
    target: { value: 'Yes' },
  });
  assert.equal(
    getByRole(root, 'button', { name: 'Complete Case' }).disabled,
    true
  );
  const search = getByRole(root, 'textbox', { name: 'Attributed person' });
  fireEvent(search, 'input', { target: { value: 'Jane' } });
  await flush();
  fireEvent(getByRole(root, 'button', { name: 'Jane Smith' }), 'click');
  assert.equal(
    getByRole(root, 'button', { name: 'Complete Case' }).disabled,
    false
  );
  await task?.();
  assert.deepEqual(written.answers.q1.capture, {
    confirmed: 'Yes',
    owner: { loginName: 'jane', displayName: 'Jane Smith' },
  });
});

test('jump to next unanswered focuses the first unanswered Question', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: { getCase: async () => row() },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  const group = getByRole(root, 'radiogroup', { name: 'Compliant?' });
  fireEvent(
    getByRole(root, 'button', { name: 'Jump to next unanswered' }),
    'click'
  );
  assert.equal(group._focused, true);
});

test('Controls lifecycle gates Appeal Review and Amend Outcome', async () => {
  async function tabsFor(/** @type {any} */ overrides) {
    const root = document.createElement('main');
    const mounted = mountNewDashboard({
      root,
      hash: '#/new_dashboard/complaints/42',
      loadConfig: async () => ({
        ...config,
        appeal: { raisedBy: 'journeyOwner' },
        sections: {
          ...config.sections,
          appealReview: {},
          amendOutcome: {},
        },
      }),
      client: {
        getCase: async () => row(overrides),
        getCurrentUser: async () => ({ id: 'control', displayName: 'Control' }),
        getCurrentUserGroups: async () => ['Controls'],
      },
    });
    await mounted.ready;
    return queryAllByRole(root, 'tab').map((tab) => tab.textContent);
  }
  const completed = await tabsFor({ status: 'Completed', reportableAt: 'now' });
  assert.ok(completed.includes('AMEND OUTCOME'));
  assert.ok(!completed.includes('APPEAL REVIEW'));
  const open = await tabsFor({
    status: 'Completed',
    reportableAt: 'now',
    appeals: [{ id: 'a', state: 'raised', rationale: 'Review' }],
  });
  assert.ok(open.includes('APPEAL REVIEW'));
  const voided = await tabsFor({ status: 'Void', reportableAt: 'now' });
  assert.ok(!voided.includes('AMEND OUTCOME'));
});

test('non-Review panels retain the stylesheet root and Summary outcome nesting contracts', async () => {
  async function panelClass(
    /** @type {string} */ tabName,
    /** @type {any} */ overrides,
    /** @type {string[]} */ groups,
    /** @type {string} */ userId
  ) {
    const root = document.createElement('main');
    const mounted = mountNewDashboard({
      root,
      hash: '#/new_dashboard/complaints/42',
      loadConfig: async () => ({
        ...config,
        appeal: { raisedBy: 'journeyOwner' },
        sections: {
          ...config.sections,
          appealRequest: {},
          appealReview: {},
          amendOutcome: {},
        },
      }),
      client: {
        getCase: async () => row(overrides),
        getCurrentUser: async () => ({ id: userId, displayName: userId }),
        getCurrentUserGroups: async () => groups,
      },
    });
    await mounted.ready;
    fireEvent(getByRole(root, 'tab', { name: tabName }), 'click');
    return { root, panel: getByRole(root, 'tabpanel') };
  }
  const appeal = await panelClass(
    'APPEAL',
    { status: 'Completed' },
    ['JourneyOwner - Complaints'],
    'journey'
  );
  assert.match(appeal.panel.className, /\bcora-appeal\b/);
  const review = await panelClass(
    'APPEAL REVIEW',
    {
      status: 'Completed',
      appeals: [{ id: 'a', state: 'raised', rationale: 'Review' }],
    },
    ['Controls'],
    'control'
  );
  assert.match(review.panel.className, /\bcora-appeal-review\b/);
  const amend = await panelClass(
    'AMEND OUTCOME',
    { status: 'Completed', reportableAt: 'now' },
    ['Controls'],
    'control'
  );
  assert.match(amend.panel.className, /\bcora-amend-outcome\b/);
  const summary = await panelClass('SUMMARY', {}, [], 'alex');
  assert.ok(summary.panel.querySelector('.cora-outcome'));
});

test('Summary composition follows each configured showInSummary rule', async () => {
  const root = document.createElement('main');
  const summaryConfig = {
    ...config,
    sections: {
      ...config.sections,
      details: { showInSummary: false },
      questions: { showInSummary: false },
      issues: { showInSummary: ['assignedReviewer'] },
      notes: { showInSummary: true },
      remediation: { showInSummary: false },
    },
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => summaryConfig,
    client: {
      getCase: async () =>
        row({
          notes: 'Visible configured note',
          answers: { q1: { value: 'No', justification: 'A clear issue' } },
        }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'SUMMARY' }), 'click');
  const summary = textContent(getByRole(root, 'tabpanel'));
  assert.doesNotMatch(summary, /Case Details|1\/1 answered/);
  assert.match(summary, /Issues.*Compliant\?.*A clear issue/);
  assert.match(summary, /Notes.*Visible configured note/);
});

test('showInSummary never exposes a Section denied to the Responsible Party', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => ({
      ...config,
      generalQuestions: [
        { key: 'secret', label: 'Reviewer-only observation', type: 'text' },
      ],
    }),
    client: {
      getCase: async () =>
        row({
          status: 'Actions In Progress',
          responsibleParty: 'sam',
          details: { customer: 'Hidden customer' },
          answers: {
            q1: { value: 'No' },
            'general:secret': { value: 'Hidden observation' },
          },
        }),
      getCurrentUser: async () => ({ id: 'sam', displayName: 'Sam' }),
      getCurrentUserGroups: async () => [],
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'SUMMARY' }), 'click');
  const summary = textContent(getByRole(root, 'tabpanel'));
  assert.doesNotMatch(
    summary,
    /Case Details|Questions|Reviewer-only observation|Hidden observation/
  );
});
