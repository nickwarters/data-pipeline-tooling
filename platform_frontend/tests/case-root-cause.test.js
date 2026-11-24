// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { makeLoader } from './helpers/case-loader.js';
import { configureAppSections } from './helpers/configure-sections.js';
import {
  CATALOGUE,
  assertGrid,
  makeCase,
  makeConfig,
} from './helpers/section-access.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';
import { getSectionPlugin } from '../src/sections/registry.js';
import { checkCaseTypes } from '../scripts/verify-config.js';
import {
  answerEdited,
  caseRootCauseCaptured,
} from '../src/pages/cora-case-review/answer-actions.js';
import {
  CASE_ROOT_CAUSE_KEY,
  caseRootCauseCapture,
} from '../src/evaluators/case-root-cause.js';
import { failedIssues } from '../src/evaluators/remediation-status.js';
import { evaluate } from '../src/evaluators/applicability-evaluator.js';
import { materializeRemediationActions } from '../src/evaluators/failure-evaluator.js';
import complaintsConfig from '../case-types/complaints.js';
import { cases } from '../dev/fixtures/cases.js';

installDom();
configureAppSections();
isolateBrowserGlobals();

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const CASE_GROUPS = [
  {
    key: 'checks',
    label: 'Checks',
    fields: [
      {
        key: 'supervisorChecked',
        label: 'Supervisor checked?',
        type: 'radio',
        options: ['Yes', 'No'],
        required: true,
      },
      {
        key: 'developmentPlan',
        label: 'Development plan?',
        type: 'radio',
        options: ['Yes', 'No'],
      },
      {
        key: 'planDate',
        label: 'Plan date',
        type: 'text',
        showWhen: { developmentPlan: { equals: 'Yes' } },
      },
    ],
  },
];

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const ISSUE_GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    fields: [
      {
        key: 'primaryCause',
        label: 'Primary cause',
        type: 'select',
        options: ['Training gap', 'Process gap'],
      },
    ],
  },
];

/** @param {any} [overrides] */
function caseOnlyConfig(overrides = {}) {
  return makeConfig({ rootCauseCaseGroups: CASE_GROUPS, ...overrides });
}

/** @param {any} [overrides] */
function caseWithIssue(overrides = {}) {
  return makeCase({ answers: { q1: { value: 'No' } }, ...overrides });
}

/** @param {any} config @returns {any} */
function demoEntry(config) {
  return {
    slug: 'demo',
    displayName: 'Demo',
    importer: async () => ({
      default: {
        listName: 'Cases-Demo',
        questions: [],
        computeOutcome: () => 'good',
        outcomeOptions: [{ id: 'good', wording: 'Good', severity: 0 }],
        defaultOutcomeId: 'good',
        ...config,
      },
    }),
  };
}

const PLUGIN = /** @type {any} */ (getSectionPlugin('rootCause'));

// --- Where it is stored ---

test('the Case Root Cause is kept under a namespaced key no Question Definition id can take', () => {
  assert.ok(CASE_ROOT_CAUSE_KEY.includes(':'));
  assert.deepEqual(caseRootCauseCapture({}), {});
  assert.deepEqual(
    caseRootCauseCapture({
      [CASE_ROOT_CAUSE_KEY]: { value: '', rcaCapture: { a: 'b' } },
    }),
    { a: 'b' }
  );
});

test('no catalogue-driven evaluator mistakes the Case entry for an Answer', () => {
  const answers = {
    q1: { value: 'No' },
    [CASE_ROOT_CAUSE_KEY]: {
      value: '',
      rcaCapture: { supervisorChecked: 'Yes' },
    },
  };
  assert.deepEqual(
    failedIssues(CATALOGUE, answers).map(({ question }) => question.id),
    ['q1']
  );
  assert.ok(!evaluate(CATALOGUE, answers).has(CASE_ROOT_CAUSE_KEY));
});

test('a response written to a Question carries the Case entry through untouched', () => {
  const entry = { value: '', rcaCapture: { supervisorChecked: 'Yes' } };
  const next = answerEdited({
    answers: { q1: { value: 'No' }, [CASE_ROOT_CAUSE_KEY]: entry },
    catalogue: CATALOGUE,
    questionId: 'q1',
    value: 'Yes',
    canEdit: true,
  });
  assert.equal(next?.[CASE_ROOT_CAUSE_KEY], entry);
});

test('the Case entry outlives an Issue that stops failing, which takes only its own Root Cause', () => {
  const question = /** @type {any} */ (CATALOGUE[0]);
  assert.deepEqual(
    materializeRemediationActions(question, {
      value: 'Yes',
      rcaCapture: { primaryCause: 'Process gap' },
    }),
    { value: 'Yes' }
  );
  const answers = {
    [CASE_ROOT_CAUSE_KEY]: { value: '', rcaCapture: { a: 'b' } },
  };
  const next = answerEdited({
    answers: { ...answers, q1: { value: 'No', rcaCapture: { x: 'y' } } },
    catalogue: CATALOGUE,
    questionId: 'q1',
    value: 'Yes',
    canEdit: true,
  });
  assert.deepEqual(next?.[CASE_ROOT_CAUSE_KEY], answers[CASE_ROOT_CAUSE_KEY]);
});

// --- Writing it ---

/** @param {any} [overrides] */
function write(overrides = {}) {
  return caseRootCauseCaptured({
    answers: { q1: { value: 'No' } },
    rootCauseCaseGroups: CASE_GROUPS,
    fieldKey: 'supervisorChecked',
    value: 'Yes',
    canEditRootCause: true,
    ...overrides,
  });
}

test('the first Case Root Cause write creates the Case entry and leaves the Issues alone', () => {
  assert.deepEqual(write(), {
    q1: { value: 'No' },
    [CASE_ROOT_CAUSE_KEY]: {
      value: '',
      rcaCapture: { supervisorChecked: 'Yes' },
    },
  });
});

test('a later write adds to the entry, and prunes a field its showWhen has hidden', () => {
  const answers = {
    q1: { value: 'No' },
    [CASE_ROOT_CAUSE_KEY]: {
      value: '',
      rcaCapture: {
        supervisorChecked: 'Yes',
        developmentPlan: 'Yes',
        planDate: '2026-11-20',
      },
    },
  };
  const next = write({ answers, fieldKey: 'developmentPlan', value: 'No' });
  assert.deepEqual(next?.[CASE_ROOT_CAUSE_KEY].rcaCapture, {
    supervisorChecked: 'Yes',
    developmentPlan: 'No',
  });
});

test('clearing the last value removes the Case entry rather than storing an empty one', () => {
  const answers = {
    q1: { value: 'No' },
    [CASE_ROOT_CAUSE_KEY]: {
      value: '',
      rcaCapture: { supervisorChecked: 'Yes' },
    },
  };
  assert.deepEqual(write({ answers, value: null }), { q1: { value: 'No' } });
});

test('a Case Root Cause write is refused without permission, for an undeclared field, or with a value its options lack', () => {
  assert.equal(write({ canEditRootCause: false }), null);
  assert.equal(write({ fieldKey: 'nope' }), null);
  assert.throws(() => write({ value: 'Maybe' }), /Invalid value "Maybe"/);
});

// --- Who sees it ---

test('Case Root Cause Fields alone switch the tab on, under the same gate', () => {
  for (const status of ['Actions In Progress', 'Completed']) {
    assertGrid(
      {
        rootCause: {
          responsiblePartyManager: 'edit',
          controls: 'read-only',
          responsibleParty: 'hidden',
        },
      },
      caseWithIssue({ status }),
      caseOnlyConfig()
    );
  }
  assertGrid(
    { rootCause: { responsiblePartyManager: 'hidden', controls: 'hidden' } },
    caseWithIssue({ status: 'In-progress' }),
    caseOnlyConfig()
  );
  assertGrid(
    { rootCause: { responsiblePartyManager: 'hidden', controls: 'hidden' } },
    makeCase({ status: 'Completed', answers: { q1: { value: 'Yes' } } }),
    caseOnlyConfig()
  );
});

test('the loader refuses a Case Type whose two Root Cause families share a key', async () => {
  const loader = makeLoader({
    row: {
      caseType: 'complaints',
      status: 'Actions In Progress',
      answers: { 'q-cmp-0016': { value: 'Poor' } },
    },
    client: {},
  });
  const original = complaintsConfig.rootCauseCaseGroups;
  complaintsConfig.rootCauseCaseGroups = [
    {
      key: 'clash',
      label: 'Clash',
      fields: [
        {
          key: complaintsConfig.rootCauseGroups?.[0].fields[0].key ?? '',
          label: 'Again',
          type: 'text',
        },
      ],
    },
  ];
  try {
    await assert.rejects(() => loader.load(), /Duplicate Root Cause Field key/);
  } finally {
    complaintsConfig.rootCauseCaseGroups = original;
  }
});

test('the loader refreshes a person Case Root Cause Field in the same directory call', async () => {
  const original = complaintsConfig.rootCauseCaseGroups;
  complaintsConfig.rootCauseCaseGroups = [
    {
      key: 'who',
      label: 'Who',
      fields: [{ key: 'checkedBy', label: 'Checked by', type: 'person' }],
    },
  ];
  /** @type {string[][]} */
  const calls = [];
  const loader = makeLoader({
    row: {
      caseType: 'complaints',
      status: 'Actions In Progress',
      answers: {
        'q-cmp-0016': { value: 'Poor' },
        [CASE_ROOT_CAUSE_KEY]: {
          value: '',
          rcaCapture: { checkedBy: { loginName: 'jsmith', displayName: 'J' } },
        },
      },
    },
    client: {
      resolveUsers: async (/** @type {string[]} */ accounts) => {
        calls.push(accounts);
        return { jsmith: 'Jane Smith' };
      },
    },
  });
  try {
    await loader.load();
  } finally {
    complaintsConfig.rootCauseCaseGroups = original;
  }
  assert.equal(calls.length, 1);
  assert.deepEqual(loader.answers[CASE_ROOT_CAUSE_KEY].rcaCapture?.checkedBy, {
    loginName: 'jsmith',
    displayName: 'Jane Smith',
  });
});

// --- The build gate ---

test('verify-config: Case Root Cause Fields alone satisfy the Root Cause Section', async () => {
  assert.deepEqual(
    await checkCaseTypes({
      caseTypes: [
        demoEntry({
          sections: { summary: {}, rootCause: {} },
          rootCauseCaseGroups: CASE_GROUPS,
        }),
      ],
    }),
    []
  );
  const left = await checkCaseTypes({
    caseTypes: [
      demoEntry({
        sections: { summary: {} },
        rootCauseCaseGroups: CASE_GROUPS,
      }),
    ],
  });
  assert.equal(left.length, 1);
  assert.match(left[0].message, /leave out `rootCause`/);
});

test('verify-config checks Case Root Cause Fields like any capture family', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry({
        rootCauseCaseGroups: [
          {
            key: 'g',
            label: 'G',
            fields: [
              { key: 'kind', label: 'Kind', type: 'radio' },
              { key: 'odd', label: 'Odd', type: 'nonsense' },
            ],
          },
        ],
      }),
    ],
  });
  const messages = failures.map((failure) => failure.message).join('\n');
  assert.match(messages, /Case Root Cause Field "kind" is a radio with no/);
  assert.match(messages, /Case Root Cause Field "odd" declares type/);
});

test('verify-config refuses a key both Root Cause families declare', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry({
        rootCauseGroups: ISSUE_GROUPS,
        rootCauseCaseGroups: [
          {
            key: 'g',
            label: 'G',
            fields: [{ key: 'primaryCause', label: 'Again', type: 'text' }],
          },
        ],
      }),
    ],
  });
  assert.equal(failures.length, 1);
  assert.match(
    failures[0].message,
    /"primaryCause" is declared in both `rootCauseGroups` and `rootCauseCaseGroups`/
  );
});

test('verify-config refuses a Case Root Cause showWhen that reaches into the per-Issue fields', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry({
        rootCauseGroups: ISSUE_GROUPS,
        rootCauseCaseGroups: [
          {
            key: 'g',
            label: 'G',
            fields: [
              {
                key: 'why',
                label: 'Why',
                type: 'text',
                showWhen: { primaryCause: { answered: true } },
              },
            ],
          },
        ],
      }),
    ],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /"primaryCause", which is not a field/);
});

test('Complaints declares Case Root Cause Fields, every one a required Yes/No', () => {
  const fields = (complaintsConfig.rootCauseCaseGroups ?? []).flatMap(
    (group) => group.fields
  );
  assert.ok(fields.length > 0);
  for (const field of fields) {
    assert.equal(field.type, 'radio', field.key);
    assert.deepEqual(field.options, ['Yes', 'No'], field.key);
    assert.equal(field.required, true, field.key);
  }
});

test('every fixture Case Root Cause holds only fields its Case Type declares, with declared values', () => {
  for (const row of cases) {
    const entry = row.answers?.[CASE_ROOT_CAUSE_KEY];
    if (!entry) continue;
    assert.equal(row.caseType, 'complaints', row.id);
    const fields = new Map(
      (complaintsConfig.rootCauseCaseGroups ?? [])
        .flatMap((group) => group.fields)
        .map((field) => [field.key, field])
    );
    for (const [key, value] of Object.entries(entry.rcaCapture ?? {})) {
      const field = fields.get(key);
      assert.ok(field, `${row.id}: ${key} is not declared`);
      assert.ok(field.options?.includes(String(value)), `${row.id}: ${key}`);
    }
  }
});

// --- The tab ---

/**
 * Mount the shipped Root Cause panel.
 *
 * @param {{ answers?: any, access?: string, sectionState?: any, groups?: any[], caseGroups?: any[], rcaCaptureSearch?: any }} [options]
 */
function rootCausePanel(options = {}) {
  /** @type {any[]} */
  const calls = [];
  const answers = options.answers ?? { q1: { value: 'No' } };
  const nodes = PLUGIN.view({
    snapshot: {
      catalogue: CATALOGUE,
      answers,
      access: { rootCause: options.access ?? 'edit' },
      sectionLabels: {},
    },
    config: makeConfig({
      rootCauseGroups: options.groups ?? ISSUE_GROUPS,
      rootCauseCaseGroups: options.caseGroups ?? CASE_GROUPS,
    }),
    route: {
      captureSearch: {},
      rcaCaptureSearch: options.rcaCaptureSearch ?? {},
    },
    sectionState: options.sectionState,
    dispatch: (/** @type {any} */ action) => calls.push(['dispatch', action]),
    actions: {
      currentAnswers: () => answers,
      editAnswers: (/** @type {any} */ next) => calls.push(['edit', next]),
      requestCaptureSearch: (/** @type {any[]} */ ...args) =>
        calls.push(['search', ...args]),
      clearCaptureSearch: (/** @type {any[]} */ ...args) =>
        calls.push(['clear', ...args]),
    },
  });
  const root = document.createElement('div');
  root.append(...nodes);
  return { root, calls };
}

test('the tab asks about the Case once, above the Issues', () => {
  const { root } = rootCausePanel();
  const text = root.textContent ?? '';
  assert.match(text, /About this Case/);
  assert.match(text, /Still to record: Supervisor checked\?/);
  assert.ok(
    text.indexOf('About this Case') < text.indexOf('A Question?'),
    'the Case block comes before the first Issue'
  );
  assert.equal(
    queryAllByRole(root, 'radio', { name: 'Yes' }).length,
    2,
    'one Yes for each Case Root Cause radio, none repeated per Issue'
  );
});

test('the manager records a Case Root Cause Field into the Case entry', () => {
  const { root, calls } = rootCausePanel();
  const [yes] = queryAllByRole(root, 'radio', { name: 'Yes' });
  yes.checked = true;
  fireEvent(yes, 'change');
  assert.deepEqual(calls, [
    [
      'edit',
      {
        q1: { value: 'No' },
        [CASE_ROOT_CAUSE_KEY]: {
          value: '',
          rcaCapture: { supervisorChecked: 'Yes' },
        },
      },
    ],
    ['clear', CASE_ROOT_CAUSE_KEY, 'supervisorChecked', 'rcaCapture'],
  ]);
});

test('a person Case Root Cause Field searches under the Case entry', () => {
  const { root, calls } = rootCausePanel({
    caseGroups: [
      {
        key: 'who',
        label: 'Who',
        fields: [{ key: 'checkedBy', label: 'Checked by', type: 'person' }],
      },
    ],
  });
  const input = getByRole(root, 'combobox', {
    name: 'Search people for Checked by',
  });
  input.value = 'Ja';
  fireEvent(input, 'input');
  assert.deepEqual(calls, [
    ['search', CASE_ROOT_CAUSE_KEY, 'checkedBy', 'Ja', 'rcaCapture'],
  ]);
});

test('a reader sees the Case answers as text, and is told when there are none', () => {
  const recorded = rootCausePanel({
    access: 'read-only',
    answers: {
      q1: { value: 'No' },
      [CASE_ROOT_CAUSE_KEY]: {
        value: '',
        rcaCapture: { supervisorChecked: 'No' },
      },
    },
  }).root;
  assert.equal(queryAllByRole(recorded, 'radio').length, 0);
  assert.match(recorded.textContent ?? '', /Supervisor checked\?: No/);

  const empty = rootCausePanel({ access: 'read-only' }).root;
  assert.match(empty.textContent ?? '', /Nothing recorded about this Case\./);
});

test('a Case Type with only Case Root Cause Fields lists no Issues to fill in', () => {
  const { root } = rootCausePanel({ groups: [] });
  assert.match(root.textContent ?? '', /About this Case/);
  assert.doesNotMatch(root.textContent ?? '', /A Question\?/);
  assert.doesNotMatch(root.textContent ?? '', /No root cause recorded/);
});

test('a Case Type with only per-Issue fields draws no Case block', () => {
  const { root } = rootCausePanel({ caseGroups: [] });
  assert.doesNotMatch(root.textContent ?? '', /About this Case/);
  assert.match(root.textContent ?? '', /A Question\?/);
});

test("the Case block's group toggle is kept under the Case entry", () => {
  const { root, calls } = rootCausePanel();
  fireEvent(getByRole(root, 'button', { name: 'Checks' }), 'click');
  const [[, action]] = calls;
  assert.equal(action.questionId, CASE_ROOT_CAUSE_KEY);
  const state = PLUGIN.reduce(undefined, action);
  const collapsed = rootCausePanel({ sectionState: state }).root;
  assert.equal(
    getByRole(collapsed, 'button', { name: 'Checks' }).getAttribute(
      'aria-expanded'
    ),
    'false'
  );
  assert.equal(
    getByRole(collapsed, 'button', { name: 'Cause' }).getAttribute(
      'aria-expanded'
    ),
    'true',
    "the Issue's own group is untouched"
  );
});

// --- The Summary block ---

/** @param {any} answers @param {any} [groups] */
function summaryBlock(answers, groups = ISSUE_GROUPS) {
  const root = document.createElement('div');
  root.append(
    PLUGIN.summaryView({
      heading: 'Root Cause',
      catalogue: CATALOGUE,
      answers,
      rootCauseGroups: groups,
      rootCauseCaseGroups: CASE_GROUPS,
    })
  );
  return root.textContent ?? '';
}

test('the Summary block shows the Case answers, and says when a required one is still to do', () => {
  const recorded = summaryBlock({
    q1: { value: 'No' },
    [CASE_ROOT_CAUSE_KEY]: {
      value: '',
      rcaCapture: { supervisorChecked: 'Yes' },
    },
  });
  assert.match(recorded, /About this Case/);
  assert.match(recorded, /Supervisor checked\?: Yes/);
  assert.doesNotMatch(recorded, /still to be recorded/);

  const outstanding = summaryBlock({ q1: { value: 'No' } });
  assert.match(outstanding, /still to be recorded/);
  assert.match(outstanding, /Nothing recorded about this Case\./);
});

test('the Summary block of a Case-only Root Cause names no per-Issue gap', () => {
  const text = summaryBlock(
    {
      q1: { value: 'No' },
      [CASE_ROOT_CAUSE_KEY]: {
        value: '',
        rcaCapture: { supervisorChecked: 'Yes' },
      },
    },
    []
  );
  assert.doesNotMatch(text, /No root cause recorded/);
});
