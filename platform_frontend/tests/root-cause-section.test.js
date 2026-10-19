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
import {
  getSectionPlugin,
  getSectionPlugins,
} from '../src/sections/registry.js';
import {
  evaluateAccess,
  summarySectionsFor,
} from '../src/services/section-access.js';
import { checkCaseTypes } from '../scripts/verify-config.js';
import { rootCauseCaptured } from '../src/pages/cora-case-review/answer-actions.js';
import { materializeRemediationActions } from '../src/evaluators/failure-evaluator.js';
import complaintsConfig from '../case-types/complaints.js';

installDom();
configureAppSections();
isolateBrowserGlobals();

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    fields: [
      {
        key: 'primaryCause',
        label: 'Primary cause',
        type: 'select',
        options: ['Training gap', 'Process gap'],
        required: true,
      },
      {
        key: 'preventable',
        label: 'Preventable?',
        type: 'radio',
        options: ['Yes', 'No'],
      },
      {
        key: 'how',
        label: 'How',
        type: 'text',
        showWhen: { preventable: { equals: 'Yes' } },
      },
    ],
  },
];

/** @param {any} [overrides] */
function rootCauseConfig(overrides = {}) {
  return makeConfig({ rootCauseGroups: GROUPS, ...overrides });
}

/** A Case whose one Question, `q1`, has failed: an Issue. */
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

// --- Where it sits ---

test('the Root Cause tab and Summary block sit after Remediation and before Notes', () => {
  const tabs = getSectionPlugins()
    .filter((plugin) => plugin.tab)
    .sort((a, b) => a.tabOrder - b.tabOrder)
    .map((plugin) => plugin.id);
  assert.equal(tabs.indexOf('rootCause'), tabs.indexOf('remediation') + 1);
  assert.equal(tabs.indexOf('notes'), tabs.indexOf('rootCause') + 1);

  const blocks = getSectionPlugins()
    .filter((plugin) => plugin.summaryBlock)
    .sort((a, b) => (a.summaryOrder ?? 0) - (b.summaryOrder ?? 0))
    .map((plugin) => plugin.id);
  assert.equal(blocks.indexOf('rootCause'), blocks.indexOf('remediation') + 1);
});

test('a Case Type may key `sections` by rootCause, and a typo is a compile error', () => {
  /** @type {import('../src/sharepoint-client.js').CaseTypeConfig['sections']} */
  const sections = {
    summary: {},
    rootCause: { showInSummary: true },
    // @ts-expect-error 'rootCaus' is not a Section this application composes.
    rootCaus: {},
  };
  assert.ok(sections);
});

// --- Who sees it, and how ---

/**
 * The reviewer side, who read it whenever it is live.
 *
 * @type {Partial<Record<import('../src/services/section-access.js').Role, import('../src/services/section-access.js').Mode>>}
 */
const READERS = {
  assignedReviewer: 'read-only',
  otherReviewer: 'read-only',
  reviewerManager: 'read-only',
  caseTypeOwner: 'read-only',
  journeyOwner: 'read-only',
  controls: 'read-only',
};

test('before the Case is reportable, nobody sees the Root Cause tab', () => {
  for (const status of ['To-allocate', 'In-progress']) {
    assertGrid(
      {
        rootCause: {
          responsiblePartyManager: 'hidden',
          assignedReviewer: 'hidden',
          controls: 'hidden',
          responsibleParty: 'hidden',
          none: 'hidden',
        },
      },
      caseWithIssue({ status }),
      rootCauseConfig()
    );
  }
});

test('once reportable, the manager edits it and the reviewer side reads it, Completed included', () => {
  for (const status of ['Actions In Progress', 'Completed']) {
    assertGrid(
      {
        rootCause: {
          responsiblePartyManager: 'edit',
          ...READERS,
          responsibleParty: 'hidden',
          none: 'hidden',
        },
      },
      caseWithIssue({ status }),
      rootCauseConfig()
    );
  }
});

test('a Case voided after it was reportable stays readable, and the manager can no longer edit it', () => {
  assertGrid(
    {
      rootCause: {
        responsiblePartyManager: 'read-only',
        ...READERS,
        responsibleParty: 'hidden',
        none: 'hidden',
      },
    },
    caseWithIssue({ status: 'Void', reportableAt: '2026-06-01T00:00:00Z' }),
    rootCauseConfig()
  );
});

test('a Case voided before it was reportable never shows the tab', () => {
  assertGrid(
    { rootCause: { responsiblePartyManager: 'hidden', controls: 'hidden' } },
    caseWithIssue({ status: 'Void' }),
    rootCauseConfig()
  );
});

test('a reportable Case with no Issue has nothing to record against', () => {
  assertGrid(
    { rootCause: { responsiblePartyManager: 'hidden', controls: 'hidden' } },
    makeCase({ status: 'Completed', answers: { q1: { value: 'Yes' } } }),
    rootCauseConfig()
  );
});

test('a Case Type declaring no Root Cause Fields has no Root Cause tab', () => {
  for (const config of [
    makeConfig(),
    rootCauseConfig({ rootCauseGroups: [] }),
  ]) {
    assertGrid(
      { rootCause: { responsiblePartyManager: 'hidden', controls: 'hidden' } },
      caseWithIssue({ status: 'Actions In Progress' }),
      config
    );
  }
});

test('a manager who is also the Responsible Party still edits it', () => {
  assert.equal(
    evaluateAccess(
      'rootCause',
      ['responsibleParty', 'responsiblePartyManager'],
      caseWithIssue({ status: 'Actions In Progress' }),
      rootCauseConfig(),
      CATALOGUE
    ),
    'edit'
  );
});

test('the Summary block follows the tab: the reviewer side gets it, the Responsible Party does not', () => {
  const caseRow = caseWithIssue({ status: 'Completed' });
  const config = rootCauseConfig();
  /** @param {any[]} roles */
  const blocksFor = (roles) => {
    /** @type {any} */
    const access = {
      rootCause: evaluateAccess('rootCause', roles, caseRow, config, CATALOGUE),
    };
    return summarySectionsFor(access, config, roles);
  };
  assert.ok(blocksFor(['controls']).includes('rootCause'));
  assert.ok(!blocksFor(['responsibleParty']).includes('rootCause'));
});

test('the loader gives the current manager edit on a reportable Complaints Case with an Issue', async () => {
  const row = {
    caseType: 'complaints',
    status: 'Actions In Progress',
    assignedReviewer: 'someone-else',
    currentResponsiblePartyManager: 'u1',
    reportableAt: '2026-06-01T00:00:00Z',
    answers: { 'q-cmp-0016': { value: 'Poor' } },
  };
  const loader = makeLoader({ row });
  await loader.load();
  assert.equal(loader.access.rootCause, 'edit');

  const withoutGroups = makeLoader({
    row: {
      ...row,
      caseType: 'example-review',
      answers: { q1: { value: 'No' } },
    },
  });
  await withoutGroups.load();
  assert.equal(
    withoutGroups.access.rootCause,
    'hidden',
    'example-review declares no Root Cause Fields'
  );
});

// --- The build gate ---

test('verify-config holds rootCauseGroups and sections.rootCause in step', async () => {
  const sections = { summary: {}, rootCause: {} };
  assert.deepEqual(
    await checkCaseTypes({
      caseTypes: [demoEntry({ sections, rootCauseGroups: GROUPS })],
    }),
    [],
    'both together pass'
  );
  assert.deepEqual(
    await checkCaseTypes({
      caseTypes: [demoEntry({ rootCauseGroups: GROUPS })],
    }),
    [],
    'an absent `sections` is every Section, so the groups are shown'
  );

  const groupsOnly = await checkCaseTypes({
    caseTypes: [
      demoEntry({ sections: { summary: {} }, rootCauseGroups: GROUPS }),
    ],
  });
  assert.equal(groupsOnly.length, 1);
  assert.match(groupsOnly[0].message, /leave out `rootCause`/);

  const sectionOnly = await checkCaseTypes({
    caseTypes: [demoEntry({ sections })],
  });
  assert.equal(sectionOnly.length, 1);
  assert.match(sectionOnly[0].message, /declares no `rootCauseGroups`/);
});

test('verify-config refuses a person Root Cause Field, and checks the rest like Issue capture', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry({
        rootCauseGroups: [
          {
            key: 'cause',
            label: 'Cause',
            fields: [
              { key: 'who', label: 'Who', type: 'person' },
              { key: 'kind', label: 'Kind', type: 'select' },
              { key: 'kind', label: 'Again', type: 'text' },
            ],
          },
        ],
      }),
    ],
  });
  const messages = failures.map((failure) => failure.message).join('\n');
  assert.match(messages, /Root Cause Field "who" declares type "person"/);
  assert.match(
    messages,
    /Root Cause Field "kind" is a select with no `options`/
  );
  assert.match(messages, /Duplicate Root Cause Field key "kind"/);
});

test('a Root Cause Field may reuse an Issue Capture Field key', async () => {
  const shared = [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'detail', label: 'Detail', type: 'text' }],
    },
  ];
  assert.deepEqual(
    await checkCaseTypes({
      caseTypes: [
        demoEntry({ captureGroups: shared, rootCauseGroups: shared }),
      ],
    }),
    []
  );
});

test('Complaints switches the Root Cause Section on', () => {
  assert.ok((complaintsConfig.rootCauseGroups ?? []).length > 0);
  assert.ok(Object.hasOwn(complaintsConfig.sections ?? {}, 'rootCause'));
});

// --- Writing it ---

test('a Root Cause write lands in rcaCapture and leaves the Reviewer capture alone', () => {
  const answers = { q1: { value: 'No', capture: { primaryCause: 'Kept' } } };
  const next = rootCauseCaptured({
    answers,
    rootCauseGroups: GROUPS,
    questionId: 'q1',
    fieldKey: 'primaryCause',
    value: 'Process gap',
    canEditRootCause: true,
  });
  assert.deepEqual(next, {
    q1: {
      value: 'No',
      capture: { primaryCause: 'Kept' },
      rcaCapture: { primaryCause: 'Process gap' },
    },
  });
});

test('a Root Cause write prunes a field its showWhen has hidden', () => {
  const next = rootCauseCaptured({
    answers: {
      q1: { value: 'No', rcaCapture: { preventable: 'Yes', how: 'Training' } },
    },
    rootCauseGroups: GROUPS,
    questionId: 'q1',
    fieldKey: 'preventable',
    value: 'No',
    canEditRootCause: true,
  });
  assert.deepEqual(next?.q1.rcaCapture, { preventable: 'No' });
});

test('a Root Cause write is refused without permission, on an unknown Question or an undeclared field', () => {
  const answers = { q1: { value: 'No' } };
  const write = {
    answers,
    rootCauseGroups: GROUPS,
    questionId: 'q1',
    fieldKey: 'primaryCause',
    value: 'Process gap',
    canEditRootCause: true,
  };
  assert.equal(rootCauseCaptured({ ...write, canEditRootCause: false }), null);
  assert.equal(rootCauseCaptured({ ...write, questionId: 'q9' }), null);
  assert.equal(rootCauseCaptured({ ...write, fieldKey: 'nope' }), null);
});

test('an Answer that stops failing loses its Root Cause with the failure', () => {
  const question = /** @type {any} */ (CATALOGUE[0]);
  assert.deepEqual(
    materializeRemediationActions(question, {
      value: 'Yes',
      rcaCapture: { primaryCause: 'Process gap' },
    }),
    { value: 'Yes' }
  );
  assert.deepEqual(
    materializeRemediationActions(question, {
      value: 'No',
      rcaCapture: { primaryCause: 'Process gap' },
    }).rcaCapture,
    { primaryCause: 'Process gap' },
    'a still-failing Answer keeps it'
  );
});

// --- The tab ---

/**
 * Mount the shipped Root Cause panel.
 *
 * @param {{ answers?: any, access?: string, sectionState?: any }} [options]
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
    config: rootCauseConfig(),
    sectionState: options.sectionState,
    dispatch: (/** @type {any} */ action) => calls.push(['dispatch', action]),
    actions: {
      currentAnswers: () => answers,
      editAnswers: (/** @type {any} */ next) => calls.push(['edit', next]),
    },
  });
  const root = document.createElement('div');
  root.append(...nodes);
  return { root, calls };
}

test('the manager records a Root Cause Field against an Issue', () => {
  const { root, calls } = rootCausePanel();
  assert.match(root.textContent ?? '', /A Question\?/);
  assert.match(root.textContent ?? '', /Still to record: Primary cause/);

  const no = getByRole(root, 'radio', { name: 'No' });
  no.checked = true;
  fireEvent(no, 'change');
  assert.deepEqual(calls, [
    ['edit', { q1: { value: 'No', rcaCapture: { preventable: 'No' } } }],
  ]);
});

test('a reader sees what was recorded, as text, and no controls', () => {
  const { root, calls } = rootCausePanel({
    access: 'read-only',
    answers: {
      q1: { value: 'No', rcaCapture: { primaryCause: 'Process gap' } },
    },
  });
  assert.equal(queryAllByRole(root, 'radio').length, 0);
  assert.equal(root.querySelectorAll('select').length, 0);
  assert.match(root.textContent ?? '', /Primary cause: Process gap/);
  assert.doesNotMatch(root.textContent ?? '', /Still to record/);
  assert.deepEqual(calls, []);
});

test('a reader is told when nothing has been recorded against an Issue', () => {
  const { root } = rootCausePanel({ access: 'read-only' });
  assert.match(root.textContent ?? '', /No root cause recorded\./);
  assert.match(root.textContent ?? '', /Still to record: Primary cause/);
});

test('with no Issue left, the tab says so', () => {
  const { root } = rootCausePanel({ answers: { q1: { value: 'Yes' } } });
  assert.match(root.textContent ?? '', /No Issues\./);
});

test("a group toggle is the Section's own state, apart from the Issues tab", () => {
  const { root, calls } = rootCausePanel();
  fireEvent(getByRole(root, 'button', { name: 'Cause' }), 'click');
  const [[, action]] = calls;
  assert.deepEqual(action, {
    type: 'root-cause/group-toggled',
    section: 'rootCause',
    questionId: 'q1',
    groupKey: 'cause',
    collapsed: true,
  });

  const state = PLUGIN.reduce(undefined, action);
  assert.equal(state.collapsed.q1.get('cause'), true);
  assert.equal(
    PLUGIN.reduce(state, { type: 'something-else' }),
    state,
    'an action that is not its own leaves the slice as it was'
  );

  const collapsed = rootCausePanel({ sectionState: state }).root;
  assert.equal(
    getByRole(collapsed, 'button', { name: 'Cause' }).getAttribute(
      'aria-expanded'
    ),
    'false'
  );
});

// --- The Summary block ---

/** @param {any} answers */
function summaryBlock(answers) {
  const root = document.createElement('div');
  root.append(
    PLUGIN.summaryView({
      heading: 'Root Cause',
      catalogue: CATALOGUE,
      answers,
      rootCauseGroups: GROUPS,
    })
  );
  return root.textContent ?? '';
}

test('the Summary block shows what was recorded, and whether anything required is still to do', () => {
  const recorded = summaryBlock({
    q1: { value: 'No', rcaCapture: { primaryCause: 'Process gap' } },
  });
  assert.match(recorded, /Primary cause: Process gap/);
  assert.doesNotMatch(recorded, /still to be recorded/);

  const outstanding = summaryBlock({
    q1: { value: 'No', rcaCapture: { preventable: 'No' } },
  });
  assert.match(outstanding, /still to be recorded/);

  assert.match(
    summaryBlock({ q1: { value: 'No' } }),
    /No root cause recorded\./
  );
});
