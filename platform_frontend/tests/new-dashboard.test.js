// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush, findByClass } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByRole,
  textContent,
} from './helpers/semantic-dom.js';
import { importSpecifiers, resolveRelative } from '../scripts/module-graph.js';

installDom();

const { mountNewDashboard } =
  await import('../src/new-dashboard/new-dashboard.js');

test('the clean Complaints descriptor resolves the retained bank artifact', async () => {
  const descriptor = (await import('../case-types/new-dashboard/complaints.js'))
    .default;
  assert.ok(descriptor.questions.length > 0);
  assert.equal(descriptor.questions[0].id, 'q-cmp-0001');
});

test('the clean descriptor is an exact data projection of the live Complaints configuration', async () => {
  const [live, clean, shared] = await Promise.all([
    import('../case-types/complaints.js'),
    import('../case-types/new-dashboard/complaints.js'),
    import('../case-types/complaints-data.js'),
  ]);
  assert.equal(clean.default, shared.default);
  for (const key of Object.keys(shared.default)) {
    assert.deepEqual(
      /** @type {any} */ (clean.default)[key],
      /** @type {any} */ (live.default)[key],
      key
    );
  }
});

const config = /** @type {any} */ ({
  listName: 'Cases-Complaints',
  detailFields: [
    { key: 'complaintRef', label: 'Complaint reference' },
    { key: 'customerName', label: 'Customer name' },
  ],
  questions: [
    {
      id: 'q1',
      text: 'Was the customer treated fairly?',
      questionGroup: 'Customer Treatment',
      responseType: 'outcome',
      options: ['Good', 'Poor'],
      optionOutcomes: { Good: 'good', Poor: 'poor' },
      deprecated: false,
    },
  ],
  outcomeOptions: [
    { id: 'good', wording: 'Good', severity: 0 },
    { id: 'poor', wording: 'Poor', severity: 100 },
  ],
  defaultOutcomeId: 'good',
  generalQuestions: [],
  captureGroups: [],
});

function caseRow(overrides = {}) {
  return /** @type {any} */ ({
    id: '42',
    caseType: 'complaints',
    title: 'Complaint #42',
    status: 'In-progress',
    assignedReviewer: 'alex',
    answers: {},
    conversation: [],
    details: { complaintRef: 'CMP-42', customerName: '' },
    notes: '',
    completedAt: null,
    etag: 'v1',
    ...overrides,
  });
}

test('new_dashboard loads the routed Case Type list and shows read-only Case Details', async () => {
  const root = document.createElement('main');
  /** @type {Array<unknown>} */
  const reads = [];
  /** @type {((value:any)=>void) | undefined} */
  let release;
  const pending = new Promise((resolve) => (release = resolve));

  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async (slug) => {
      assert.equal(slug, 'complaints');
      return config;
    },
    client: {
      async getCase(/** @type {any} */ id, /** @type {any} */ options) {
        reads.push([id, options]);
        return pending;
      },
    },
  });

  assert.equal(getByRole(root, 'status').textContent, 'Loading Case…');
  release?.(caseRow());
  await mounted.ready;
  await flush();

  assert.deepEqual(reads, [['42', { listName: 'Cases-Complaints' }]]);
  const details = getByRole(root, 'tabpanel');
  assert.equal(details.getAttribute('data-access'), 'read-only');
  assert.equal(getByTag(details, 'h2').textContent, 'Case Details');
  assert.match(textContent(details), /Title Complaint #42/);
  assert.match(textContent(details), /Complaint reference CMP-42/);
  assert.match(textContent(details), /Customer name —/);
});

test('the new dashboard browser graph contains only retained assets and clean-room code', () => {
  const root = new URL('../', import.meta.url);
  const retained = new Set([
    'src/sharepoint-client.js',
    'src/services/http-sharepoint-client.js',
    'src/styles/cora-design-tokens.css',
    'src/styles/cora-styles.css',
    'src/lib/html.js',
  ]);
  const seen = new Set();
  const pending = ['src/new-dashboard/browser.js'];

  while (pending.length) {
    const file = /** @type {string} */ (pending.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const edge of importSpecifiers(file, root)) {
      const target = resolveRelative(file, edge.specifier, root);
      if (target && target.endsWith('.js')) pending.push(target);
    }
  }

  const forbidden = [...seen].filter(
    (file) =>
      !retained.has(file) &&
      !file.startsWith('src/new-dashboard/') &&
      !file.startsWith('case-types/') &&
      !file.startsWith('dev/')
  );
  assert.deepEqual(forbidden, []);
});

test('Review is generated from the Question Bank and selecting an answer is observable', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: { getCase: async () => caseRow() },
  });
  await mounted.ready;

  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  const panel = getByRole(root, 'tabpanel');
  assert.equal(getByTag(panel, 'h2').textContent, 'Questions');
  assert.match(textContent(panel), /Customer Treatment/);
  assert.equal(queryAllByRole(panel, 'radiogroup').length, 1);
  const poor = getByRole(panel, 'radio', { name: 'Poor' });
  fireEvent(poor, 'change', { target: { checked: true, value: 'Poor' } });

  const selected = getByRole(root, 'radio', { name: 'Poor' });
  assert.equal(selected.checked, true);
  assert.match(textContent(root), /1\/1/);
});

test('Review uses the retained question-card, grouped-list, and sticky progress CSS contract', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => ({ ...config, allowBulkOutcome: true }),
    client: { getCase: async () => caseRow() },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  const panel = getByRole(root, 'tabpanel');
  const list = findByClass(panel, 'cora-question-list');
  const heading = findByClass(list, 'cora-question-group-heading');
  const card = findByClass(list, 'cora-question-card');
  const progress = findByClass(panel, 'cora-group-progress');

  assert.equal(card._children[0].className, 'cora-question');
  assert.equal(findByClass(heading, 'cora-group-outcome').tagName, 'SELECT');
  assert.ok(findByClass(progress, 'cora-group-progress-row'));
  assert.ok(findByClass(progress, 'cora-group-progress-label'));
  assert.ok(findByClass(progress, 'cora-group-progress-count'));
});

test('every Case section keeps the retained tab-panel spacing contract', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: { getCase: async () => caseRow() },
  });
  await mounted.ready;
  for (const tab of queryAllByRole(root, 'tab')) {
    fireEvent(tab, 'click');
    assert.match(getByRole(root, 'tabpanel').className, /\bcora-tabs-panel\b/);
  }
});

test('an answer is debounced and saved with the Case ETag and list', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any[]} */
  const writes = [];
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: (task, delay) => {
      assert.equal(delay, 1500);
      scheduled = task;
      return 1;
    },
    cancelSchedule: () => {},
    client: {
      getCase: async () => caseRow(),
      async patchCase(
        /** @type {any} */ id,
        /** @type {any} */ fields,
        /** @type {any} */ etag,
        /** @type {any} */ options
      ) {
        writes.push([id, fields, etag, options]);
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'Poor' }), 'change', {
    target: { value: 'Poor' },
  });

  assert.equal(getByRole(root, 'status').textContent, 'Unsaved changes');
  assert.ok(scheduled);
  await scheduled();

  assert.deepEqual(writes, [
    [
      '42',
      { answers: { q1: { value: 'Poor' } } },
      'v1',
      { listName: 'Cases-Complaints' },
    ],
  ]);
  assert.equal(getByRole(root, 'status').textContent, 'Saved');
});

test('Issues shows outcome failures and the Case Type capture fields', async () => {
  const root = document.createElement('main');
  const issueConfig = {
    ...config,
    captureGroups: [
      {
        key: 'root-cause',
        label: 'Root cause & attribution',
        fields: [
          {
            key: 'rootCauseSummary',
            label: 'Root cause summary',
            type: 'textarea',
          },
        ],
      },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => issueConfig,
    client: {
      getCase: async () =>
        caseRow({
          answers: { q1: { value: 'Poor', justification: 'Evidence' } },
        }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');

  const panel = getByRole(root, 'tabpanel');
  assert.equal(getByTag(panel, 'h2').textContent, 'Issues');
  assert.match(textContent(panel), /Was the customer treated fairly\?/);
  assert.match(textContent(panel), /Response Poor/);
  assert.match(textContent(panel), /Remediation required\?/);
  assert.match(textContent(panel), /Root cause & attribution/);
  assert.ok(getByRole(panel, 'textbox', { name: 'Root cause summary' }));
});

test('Summary rolls up configured Details, review progress, and Outcome', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () => caseRow({ answers: { q1: { value: 'Poor' } } }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'SUMMARY' }), 'click');

  const panel = getByRole(root, 'tabpanel');
  assert.equal(panel._children[0].textContent, 'Summary');
  assert.match(textContent(panel), /Outcome Poor/);
  assert.match(textContent(panel), /Questions 1\/1 answered/);
  assert.match(textContent(panel), /Complaint reference CMP-42/);
});

test('the Case Review keeps the current CORA chrome and case controls', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: { getCase: async () => caseRow({ onHold: true }) },
  });
  await mounted.ready;

  assert.equal(getByRole(root, 'link', { name: 'CORA — home' }).href, '#/');
  assert.ok(getByRole(root, 'link', { name: 'Dashboard' }));
  assert.ok(getByRole(root, 'link', { name: 'Roadmap' }));
  assert.ok(getByRole(root, 'button', { name: /conversation/i }));
  const hold = getByRole(root, 'button', { name: 'On hold' });
  assert.equal(hold.getAttribute('aria-pressed'), 'true');
});

test('Review follows the Question Bank showWhen graph as answers change', async () => {
  const root = document.createElement('main');
  const conditional = {
    ...config,
    questions: [
      ...config.questions,
      {
        id: 'q2',
        text: 'Was the failure escalated?',
        questionGroup: 'Customer Treatment',
        responseType: 'outcome',
        options: ['Good', 'Poor'],
        optionOutcomes: { Good: 'good', Poor: 'poor' },
        showWhen: { q1: { equals: 'Poor' } },
        deprecated: false,
      },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => conditional,
    client: { getCase: async () => caseRow() },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  assert.equal(queryAllByRole(root, 'radiogroup').length, 1);

  fireEvent(getByRole(root, 'radio', { name: 'Poor' }), 'change', {
    target: { value: 'Poor' },
  });
  assert.equal(queryAllByRole(root, 'radiogroup').length, 2);
  assert.match(textContent(root), /Was the failure escalated\?/);
});

test('a Responsible Party cannot see the live reviewer sections', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () => caseRow({ responsibleParty: 'adviser' }),
      getCurrentUser: async () => ({ id: 'adviser', displayName: 'Adviser' }),
      getCurrentUserGroups: async () => [],
    },
  });
  await mounted.ready;

  assert.equal(queryAllByRole(root, 'tab').length, 0);
  assert.ok(getByRole(root, 'button', { name: /conversation/i }));
  assert.doesNotMatch(textContent(root), /Case Details/);
});

test('Issue decisions and configured capture fields persist in Answers', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any} */
  /** @type {any} */
  let written;
  const issueConfig = {
    ...config,
    captureGroups: [
      {
        key: 'root-cause',
        label: 'Root cause',
        fields: [
          {
            key: 'rootCauseSummary',
            label: 'Root cause summary',
            type: 'textarea',
          },
        ],
      },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => issueConfig,
    schedule: (task) => ((scheduled = task), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => caseRow({ answers: { q1: { value: 'Poor' } } }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'Yes' }), 'change', {
    target: { value: 'yes' },
  });
  fireEvent(
    getByRole(root, 'textbox', { name: 'Root cause summary' }),
    'input',
    {
      target: { value: 'A missed handoff' },
    }
  );
  await scheduled?.();

  assert.deepEqual(written, {
    answers: {
      q1: {
        value: 'Poor',
        remediationRequired: 'yes',
        capture: { rootCauseSummary: 'A missed handoff' },
      },
    },
  });
});

test('Issue justification, configured actions, and free-form remediation persist together', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any} */
  let written;
  const actionConfig = {
    ...config,
    questions: [
      {
        ...config.questions[0],
        remediationActions: ['Write to the customer'],
      },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => actionConfig,
    schedule: (task) => ((scheduled = task), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => caseRow({ answers: { q1: { value: 'Poor' } } }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');
  fireEvent(getByRole(root, 'textbox', { name: 'Justification' }), 'input', {
    target: { value: 'The evidence demonstrates the failure.' },
  });
  fireEvent(
    getByRole(root, 'checkbox', { name: 'Write to the customer' }),
    'change',
    {
      target: { checked: true },
    }
  );
  fireEvent(getByRole(root, 'textbox', { name: 'Free-form action' }), 'input', {
    target: { value: 'Refund the fee' },
  });
  await scheduled?.();

  assert.deepEqual(written, {
    answers: {
      q1: {
        value: 'Poor',
        justification: 'The evidence demonstrates the failure.',
        remediationActions: [{ id: 'q1-ra-0', text: 'Write to the customer' }],
        freeFormRemediation: 'Refund the fee',
      },
    },
  });
});

test('the Assigned Reviewer searches and persists the Case Responsible Party', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          answers: { q1: { value: 'Poor', remediationRequired: 'yes' } },
        }),
      searchPeople: async (/** @type {string} */ query) => {
        assert.equal(query, 'tay');
        return [{ loginName: 'rp-1', displayName: 'Taylor Adviser' }];
      },
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');
  fireEvent(
    getByRole(root, 'textbox', { name: 'Search people for Responsible Party' }),
    'input',
    { target: { value: 'tay' } }
  );
  await flush();
  fireEvent(getByRole(root, 'button', { name: 'Taylor Adviser' }), 'click');
  await flush();

  assert.deepEqual(written, { responsibleParty: 'rp-1' });
  assert.match(textContent(root), /Responsible Party: Taylor Adviser/);
});

test('Send Actions requires recorded remediation and a Responsible Party', async () => {
  const withoutWork = document.createElement('main');
  const first = mountNewDashboard({
    root: withoutWork,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          answers: { q1: { value: 'Poor', remediationRequired: 'yes' } },
        }),
    },
  });
  await first.ready;
  assert.equal(
    getByRole(withoutWork, 'button', { name: 'Complete Case' }).disabled,
    true
  );

  const withoutParty = document.createElement('main');
  const second = mountNewDashboard({
    root: withoutParty,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              freeFormRemediation: 'Refund the fee',
            },
          },
        }),
    },
  });
  await second.ready;
  assert.equal(
    getByRole(withoutParty, 'button', { name: 'Send Actions' }).disabled,
    true
  );

  const ready = document.createElement('main');
  const third = mountNewDashboard({
    root: ready,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          responsibleParty: 'rp-1',
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              freeFormRemediation: 'Refund the fee',
            },
          },
        }),
    },
  });
  await third.ready;
  assert.equal(
    getByRole(ready, 'button', { name: 'Send Actions' }).disabled,
    false
  );
});

test('deciding remediation is not required clears previously authored remediation', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: (task) => ((scheduled = task), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () =>
        caseRow({
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              remediationActions: [{ id: 'a1', text: 'Fix it' }],
              freeFormRemediation: 'Refund it',
            },
          },
        }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'No' }), 'change', {
    target: { value: 'no' },
  });
  await scheduled?.();

  assert.deepEqual(written.answers.q1, {
    value: 'Poor',
    remediationRequired: 'no',
  });
});

test('the Assigned Reviewer completes a fully answered Case without remediation', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T12:00:00Z'),
    loadConfig: async () => ({ ...config, version: 'live-descriptor' }),
    client: {
      getCase: async () => caseRow({ answers: { q1: { value: 'Good' } } }),
      getExportHash: async (/** @type {string} */ slug) => {
        assert.equal(slug, 'complaints');
        return 'bank-7';
      },
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'button', { name: 'Complete Case' }), 'click');
  await flush();

  assert.deepEqual(written, {
    status: 'Completed',
    reportableAt: '2026-08-05T12:00:00.000Z',
    completedAt: '2026-08-05T12:00:00.000Z',
    outcomeAtCompletion: 'good',
    hadRemediation: false,
    effectiveOutcome: 'good',
    effectiveHadRemediation: false,
    outcomeOverridden: false,
    questionBankVersion: 'bank-7',
  });
  assert.match(textContent(root), /Status Completed/);
});

test('completion is absent until every currently applicable Question is answered', async () => {
  const unanswered = document.createElement('main');
  const first = mountNewDashboard({
    root: unanswered,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: { getCase: async () => caseRow() },
  });
  await first.ready;
  assert.equal(
    queryAllByRole(unanswered, 'button', { name: 'Complete Case' }).length,
    0
  );

  const answered = document.createElement('main');
  const second = mountNewDashboard({
    root: answered,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () => caseRow({ answers: { q1: { value: 'Good' } } }),
    },
  });
  await second.ready;
  assert.equal(
    getByRole(answered, 'button', { name: 'Complete Case' }).disabled,
    false
  );
});

test('sent remediation is resolved before the Assigned Reviewer closes the Case', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any[]} */
  const writes = [];
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T13:00:00Z'),
    loadConfig: async () => ({
      ...config,
      remediationStatuses: ['complete', 'cancelled'],
    }),
    schedule: (task) => ((scheduled = task), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () =>
        caseRow({
          status: 'Actions In Progress',
          reportableAt: '2026-08-04T12:00:00Z',
          outcomeAtCompletion: 'poor',
          hadRemediation: true,
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              freeFormRemediation: 'Write to the customer',
            },
          },
        }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        writes.push(fields);
        return { ok: true, etag: `v${writes.length + 1}` };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REMEDIATION' }), 'click');
  assert.match(textContent(root), /Write to the customer/);
  fireEvent(getByRole(root, 'radio', { name: 'Complete' }), 'change', {
    target: { value: 'complete' },
  });
  await scheduled?.();
  fireEvent(getByRole(root, 'button', { name: 'Complete Case' }), 'click');
  await flush();

  assert.deepEqual(writes.at(-1), {
    status: 'Completed',
    completedAt: '2026-08-05T13:00:00.000Z',
  });
});

test('Remediation tracking shows the sent actions, due date, and Responsible Party', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          status: 'Actions In Progress',
          reportableAt: '2026-08-04T12:00:00Z',
          remediationDueDate: '2026-08-18',
          responsibleParty: 'rp-1',
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              remediationActions: [{ id: 'a1', text: 'Write to the customer' }],
            },
          },
        }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REMEDIATION' }), 'click');

  assert.match(textContent(root), /Write to the customer/);
  assert.match(textContent(root), /Remediation due: 2026-08-18/);
  assert.match(textContent(root), /Responsible Party: rp-1/);
});

test('Summary includes the remediation handoff facts', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          status: 'Actions In Progress',
          reportableAt: '2026-08-04T12:00:00Z',
          remediationDueDate: '2026-08-18',
          responsibleParty: 'rp-1',
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              remediationActions: [{ id: 'a1', text: 'Write to the customer' }],
              freeFormRemediation: 'Refund the fee',
            },
          },
        }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'SUMMARY' }), 'click');

  assert.match(textContent(root), /Remediation Actions: 2/);
  assert.match(textContent(root), /Remediation due: 2026-08-18/);
  assert.match(textContent(root), /Responsible Party: rp-1/);
});

test('Conversation toggles and posts an attributed message through the Case write', async () => {
  const root = document.createElement('main');
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T14:00:00Z'),
    loadConfig: async () => config,
    client: {
      getCase: async () => caseRow({ status: 'Actions In Progress' }),
      getCurrentUser: async () => ({
        id: 'alex',
        displayName: 'Alex Reviewer',
      }),
      getCurrentUserGroups: async () => [],
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'button', { name: /conversation/i }), 'click');
  const box = getByRole(root, 'textbox', { name: 'Message' });
  fireEvent(box, 'input', { target: { value: 'Actions are complete.' } });
  fireEvent(getByRole(root, 'button', { name: 'Send message' }), 'click');
  await flush();
  assert.deepEqual(written, {
    conversation: [
      {
        author: 'Alex Reviewer',
        timestamp: '2026-08-05T14:00:00.000Z',
        body: 'Actions are complete.',
      },
    ],
  });
});

test('Conversation observers can read history but cannot post', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          status: 'Completed',
          conversation: [
            {
              author: 'Alex',
              timestamp: '2026-08-01T09:00:00Z',
              body: 'Done.',
            },
          ],
        }),
      getCurrentUser: async () => ({
        id: 'controls-1',
        displayName: 'Controls',
      }),
      getCurrentUserGroups: async () => ['Controls'],
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'button', { name: /conversation/i }), 'click');

  assert.match(textContent(root), /Done\./);
  assert.equal(getByRole(root, 'textbox', { name: 'Message' }).disabled, true);
  assert.equal(
    queryAllByRole(root, 'button', { name: 'Send message' }).length,
    0
  );
});

test('On hold writes the paired flag and timestamp atomically', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T15:00:00Z'),
    loadConfig: async () => config,
    client: {
      getCase: async () => caseRow({ onHold: false }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'button', { name: 'On hold' }), 'click');
  await flush();
  assert.deepEqual(written, {
    onHold: true,
    placedOnHoldAt: '2026-08-05T15:00:00.000Z',
  });
});

test('Void Case requires and persists a configured reason', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T16:00:00Z'),
    loadConfig: async () => config,
    client: {
      getCase: async () => caseRow({ onHold: true }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  const button = getByRole(root, 'button', { name: 'Void Case…' });
  assert.equal(button.disabled, true);
  fireEvent(getByRole(root, 'combobox', { name: 'Void reason' }), 'change', {
    target: { value: 'duplicate' },
  });
  fireEvent(getByRole(root, 'button', { name: 'Void Case…' }), 'click');
  await flush();
  assert.deepEqual(written, {
    status: 'Void',
    voidReason: 'duplicate',
    voidedAt: '2026-08-05T16:00:00.000Z',
    voidedBy: 'alex',
    onHold: false,
    placedOnHoldAt: null,
  });
});

test('Notes edits use the same 1500ms ETag-guarded save path', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    schedule: (task, delay) => {
      assert.equal(delay, 1500);
      scheduled = task;
      return 1;
    },
    cancelSchedule: () => {},
    client: {
      getCase: async () => caseRow(),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
  fireEvent(getByRole(root, 'textbox', { name: 'Notes' }), 'input', {
    target: { value: 'Reviewer working note' },
  });
  await scheduled?.();
  assert.deepEqual(written, { notes: 'Reviewer working note' });
});

test('configured General Questions persist beside Question Bank Answers', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any} */
  let written;
  const generalConfig = {
    ...config,
    generalQuestions: [
      { key: 'observations', label: 'Reviewer observations', type: 'textarea' },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => generalConfig,
    schedule: (task) => ((scheduled = task), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => caseRow(),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  fireEvent(
    getByRole(root, 'textbox', { name: 'Reviewer observations' }),
    'input',
    {
      target: { value: 'Escalate the trend.' },
    }
  );
  await scheduled?.();
  assert.deepEqual(written, {
    answers: { 'general:observations': { value: 'Escalate the trend.' } },
  });
});

test('Group outcome answers every currently applicable Question in that group', async () => {
  const root = document.createElement('main');
  /** @type {Function | undefined} */
  let scheduled;
  /** @type {any} */
  let written;
  const bulkConfig = {
    ...config,
    allowBulkOutcome: true,
    questions: [
      ...config.questions,
      { ...config.questions[0], id: 'q2', text: 'Second question' },
    ],
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => bulkConfig,
    schedule: (task) => ((scheduled = task), 1),
    cancelSchedule: () => {},
    client: {
      getCase: async () => caseRow(),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  fireEvent(getByRole(root, 'combobox', { name: /Group outcome/ }), 'change', {
    target: { value: 'Poor' },
  });
  await scheduled?.();
  assert.deepEqual(written, {
    answers: { q1: { value: 'Poor' }, q2: { value: 'Poor' } },
  });
});

test('non-assigned reviewers can inspect but cannot mutate the live review', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => ({ ...config, displayName: 'Complaints' }),
    client: {
      getCase: async () => caseRow(),
      getCurrentUser: async () => ({ id: 'sam', displayName: 'Sam Reviewer' }),
      getCurrentUserGroups: async () => ['Reviewers - Complaints'],
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');

  assert.equal(
    getByRole(root, 'tabpanel').getAttribute('data-access'),
    'read-only'
  );
  assert.equal(getByRole(root, 'radio', { name: 'Poor' }).disabled, true);
  assert.equal(queryAllByRole(root, 'button', { name: 'On hold' }).length, 0);
  assert.equal(
    queryAllByRole(root, 'button', { name: 'Complete Case' }).length,
    0
  );
});

test('a reportable Case renders its stamped Question Bank snapshot', async () => {
  const root = document.createElement('main');
  /** @type {any[]} */
  const calls = [];
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          status: 'Completed',
          reportableAt: '2026-08-01T09:00:00Z',
          questionBankVersion: 'sha256:frozen',
          answers: { old: { value: 'No' } },
        }),
      getVersionedExport: async (
        /** @type {string} */ slug,
        /** @type {string} */ hash
      ) => {
        calls.push([slug, hash]);
        return {
          questions: [
            {
              id: 'old',
              text: 'Question as reviewed?',
              category: null,
              questionGroup: 'Historic',
              responseType: 'outcome',
              options: ['Yes', 'No'],
              optionOutcomes: { Yes: 'good', No: 'poor' },
              showWhen: null,
              deprecated: false,
            },
          ],
          outcomeOptions: config.outcomeOptions,
          defaultOutcomeId: 'good',
        };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');

  assert.deepEqual(calls, [['complaints', 'sha256:frozen']]);
  assert.match(textContent(root), /Question as reviewed\?/);
  assert.doesNotMatch(textContent(root), /Was the customer treated fairly\?/);
});

test('Send Actions freezes the remediation working-day due date', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-07T12:00:00Z'),
    loadConfig: async () => ({ ...config, remediationSlaWorkingDays: 2 }),
    client: {
      getCase: async () =>
        caseRow({
          responsibleParty: 'rp-1',
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              freeFormRemediation: 'Refund the fee',
            },
          },
        }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'button', { name: 'Send Actions' }), 'click');
  await flush();

  assert.equal(written.remediationDueDate, '2026-08-11');
});

test('the remediation SLA excludes England and Wales bank holidays', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-28T12:00:00Z'),
    loadConfig: async () => ({ ...config, remediationSlaWorkingDays: 1 }),
    client: {
      getCase: async () =>
        caseRow({
          responsibleParty: 'rp-1',
          answers: {
            q1: {
              value: 'Poor',
              remediationRequired: 'yes',
              freeFormRemediation: 'Refund the fee',
            },
          },
        }),
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'button', { name: 'Send Actions' }), 'click');
  await flush();
  assert.equal(written.remediationDueDate, '2026-09-01');
});

test('a non-complete remediation resolution requires supporting details', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => ({
      ...config,
      remediationStatuses: ['complete', 'cancelled'],
    }),
    client: {
      getCase: async () =>
        caseRow({
          status: 'Actions In Progress',
          answers: {
            q1: { value: 'Poor', remediationRequired: 'yes' },
          },
        }),
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REMEDIATION' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'Cancelled' }), 'change', {
    target: { value: 'cancelled' },
  });

  assert.ok(getByRole(root, 'textbox', { name: 'Cancellation justification' }));
  assert.equal(
    getByRole(root, 'button', { name: 'Complete Case' }).disabled,
    true
  );
});

test('the configured Journey Owner can raise one additive Appeal on a Completed Case', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T17:00:00Z'),
    loadConfig: async () => ({
      ...config,
      displayName: 'Complaints',
      appeal: { raisedBy: 'journeyOwner' },
      sections: { ...config.sections, appealRequest: {} },
    }),
    client: {
      getCase: async () =>
        caseRow({
          status: 'Completed',
          reportableAt: '2026-08-01T09:00:00Z',
          appeals: [],
        }),
      getCurrentUser: async () => ({
        id: 'jo-1',
        displayName: 'Journey Owner',
      }),
      getCurrentUserGroups: async () => ['JourneyOwner - Complaints'],
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'APPEAL' }), 'click');
  fireEvent(getByRole(root, 'textbox', { name: 'Rationale' }), 'input', {
    target: { value: 'The evidence was misunderstood.' },
  });
  fireEvent(getByRole(root, 'button', { name: 'Raise Appeal' }), 'click');
  await flush();

  assert.equal(written.appeals[0].state, 'raised');
  assert.equal(written.appeals[0].appellant, 'jo-1');
  assert.equal(written.appeals[0].rationale, 'The evidence was misunderstood.');
  assert.equal(written.hasOpenAppeal, true);
  assert.equal(written.appealRaisedAt, '2026-08-05T17:00:00.000Z');
});

test('Controls can amend the effective Outcome without changing its frozen snapshot', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T18:00:00Z'),
    loadConfig: async () => ({
      ...config,
      sections: { ...config.sections, amendOutcome: {} },
    }),
    client: {
      getCase: async () =>
        caseRow({
          status: 'Completed',
          reportableAt: '2026-08-01T09:00:00Z',
          outcomeAtCompletion: 'poor',
          effectiveOutcome: 'poor',
          hadRemediation: true,
        }),
      getCurrentUser: async () => ({
        id: 'controls-1',
        displayName: 'Controls',
      }),
      getCurrentUserGroups: async () => ['Controls'],
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'AMEND OUTCOME' }), 'click');
  fireEvent(getByRole(root, 'combobox', { name: 'New outcome' }), 'change', {
    target: { value: 'good' },
  });
  fireEvent(getByRole(root, 'textbox', { name: 'Justification' }), 'input', {
    target: { value: 'Corrected after review.' },
  });
  fireEvent(getByRole(root, 'button', { name: 'Amend Outcome' }), 'click');
  await flush();

  assert.deepEqual(written, {
    amendedOutcome: {
      outcome: 'good',
      justification: 'Corrected after review.',
      amendedBy: 'controls-1',
      amendedAt: '2026-08-05T18:00:00.000Z',
    },
    effectiveOutcome: 'good',
    effectiveHadRemediation: true,
    outcomeOverridden: true,
  });
});

test('the tab strip supports wrapped arrow-key navigation and focus', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: { getCase: async () => caseRow() },
  });
  await mounted.ready;
  const details = getByRole(root, 'tab', { name: 'DETAILS' });
  const event = fireEvent(details, 'keydown', { key: 'ArrowLeft' });
  await flush();

  assert.equal(event.defaultPrevented, true);
  assert.equal(document.activeElement?.textContent, 'NOTES');
  assert.equal(
    getByRole(root, 'tabpanel').getAttribute('id'),
    'new-case-panel-notes'
  );
});

test('a terminal Case is visibly frozen across editable reviewer sections', async () => {
  const root = document.createElement('main');
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => config,
    client: {
      getCase: async () =>
        caseRow({
          status: 'Completed',
          reportableAt: '2026-08-01T09:00:00Z',
          answers: { q1: { value: 'Poor', remediationRequired: 'no' } },
        }),
    },
  });
  await mounted.ready;
  assert.match(textContent(root), /Completed — this Case is read-only/);
  fireEvent(getByRole(root, 'tab', { name: 'ISSUES' }), 'click');
  assert.equal(getByRole(root, 'radio', { name: 'Yes' }).disabled, true);
  fireEvent(getByRole(root, 'tab', { name: 'NOTES' }), 'click');
  assert.equal(getByRole(root, 'textbox', { name: 'Notes' }).disabled, true);
});

test('Controls resolve an open Appeal and clear its queryable worklist fields', async () => {
  const root = document.createElement('main');
  /** @type {any} */
  let written;
  const openAppeal = {
    id: 'a1',
    appellant: 'jo-1',
    at: '2026-08-04T09:00:00Z',
    rationale: 'The evidence was misunderstood.',
    state: 'raised',
  };
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    now: () => new Date('2026-08-05T19:00:00Z'),
    loadConfig: async () => ({
      ...config,
      sections: { ...config.sections, appealReview: {} },
    }),
    client: {
      getCase: async () =>
        caseRow({
          status: 'Completed',
          reportableAt: '2026-08-01T09:00:00Z',
          appeals: [openAppeal],
        }),
      getCurrentUser: async () => ({
        id: 'controls-1',
        displayName: 'Controls',
      }),
      getCurrentUserGroups: async () => ['Controls'],
      patchCase: async (/** @type {any} */ _id, /** @type {any} */ fields) => {
        written = fields;
        return { ok: true, etag: 'v2' };
      },
    },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'APPEAL REVIEW' }), 'click');
  fireEvent(getByRole(root, 'radio', { name: 'Reject' }), 'change', {
    target: { value: 'rejected' },
  });
  fireEvent(
    getByRole(root, 'textbox', { name: 'Resolution rationale' }),
    'input',
    {
      target: { value: 'The original decision stands.' },
    }
  );
  fireEvent(getByRole(root, 'button', { name: 'Resolve Appeal' }), 'click');
  await flush();

  assert.equal(written.appeals[0].state, 'resolved');
  assert.deepEqual(written.appeals[0].resolution, {
    verdict: 'rejected',
    rationale: 'The original decision stands.',
    resolver: 'controls-1',
    at: '2026-08-05T19:00:00.000Z',
  });
  assert.equal(written.hasOpenAppeal, false);
  assert.equal(written.appealRaisedAt, null);
});

test('a 500-Question Bank renders within the dashboard performance budget', async () => {
  const root = document.createElement('main');
  const largeConfig = {
    ...config,
    questions: Array.from({ length: 500 }, (_, index) => ({
      ...config.questions[0],
      id: `q${index}`,
      text: `Question ${index + 1}`,
    })),
  };
  const started = performance.now();
  const mounted = mountNewDashboard({
    root,
    hash: '#/new_dashboard/complaints/42',
    loadConfig: async () => largeConfig,
    client: { getCase: async () => caseRow() },
  });
  await mounted.ready;
  fireEvent(getByRole(root, 'tab', { name: 'REVIEW' }), 'click');
  const elapsed = performance.now() - started;

  assert.equal(queryAllByRole(root, 'radiogroup').length, 500);
  assert.ok(elapsed < 250, `500 questions rendered in ${elapsed.toFixed(1)}ms`);
});
