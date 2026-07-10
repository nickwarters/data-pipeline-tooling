// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installDom,
  StubEl,
  useElementClass,
  findByClass,
  findAllByClass,
} from './_dom-stub.js';

installDom();

// Records the most recent update() call so tests can observe what Summary
// forwarded to the Outcome block.
class RecordingEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {{ a1: any, a2: any, a3: any } | null} */
    this._updateArgs = null;
  }
  update(/** @type {any} */ a1, /** @type {any} */ a2, /** @type {any} */ a3) {
    this._updateArgs = { a1, a2, a3 };
  }
}

useElementClass(RecordingEl);

// DOM stubs must be in place before any src import.

/**
 * Flattens a subtree's text into one string for content assertions.
 * @param {any} el
 * @returns {string}
 */
function allText(el) {
  let out = el.textContent ? el.textContent + ' ' : '';
  for (const c of el._children ?? []) out += allText(c);
  return out;
}

const { CORASummary, Summary } =
  await import('../src/components/sections/cora-summary.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    status: 'In-progress',
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e1',
    ...overrides,
  };
}

/** @param {Record<string, import('../src/sharepoint-client.js').Answer>} answers */
function makeComputeOutcome(answers) {
  const hasNo = Object.values(answers).some((a) => a.value === 'No');
  return { outcome: /** @type {'pass' | 'fail'} */ (hasNo ? 'fail' : 'pass') };
}

test('CORASummary: renders a Summary heading as its first child', () => {
  const el = new CORASummary();
  el.connectedCallback();
  const heading = /** @type {any} */ (el)._children[0];
  assert.equal(heading.textContent, 'Summary');
});

test('Summary: plain function renders heading and outcome block', () => {
  const nodes = Summary({
    computeOutcome: null,
    answers: {},
    allAnswered: false,
    caseRow: null,
    catalogue: [],
    summarySections: [],
    captureGroups: [],
    detailFields: [],
    outcomeOptions: [],
  });

  assert.equal(/** @type {any} */ (nodes[0]).textContent, 'Summary');
  assert.equal(/** @type {any} */ (nodes[1])._updateArgs.a3, false);
});

test('CORASummary: renders an Outcome block (cora-outcome) as the first content block', () => {
  const el = new CORASummary();
  el.connectedCallback();
  const block = /** @type {any} */ (el)._children[1];
  assert.ok(block, 'an outcome block is rendered inside Summary');
});

test('CORASummary: forwards live computeOutcome/answers/allAnswered to the Outcome block while In-progress', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ status: 'In-progress' });
  el.connectedCallback();

  const answers = { 'q-welcome': { value: 'No' } };
  const compute = (/** @type {any} */ a) => makeComputeOutcome(a);
  el.update(compute, answers, true);

  const block = /** @type {any} */ (el)._children[1];
  assert.equal(
    block._updateArgs.a1,
    compute,
    'the live outcome function is passed through unchanged'
  );
  assert.equal(
    block._updateArgs.a2,
    answers,
    'the current Answers are passed through'
  );
  assert.equal(block._updateArgs.a3, true, 'allAnswered is passed through');
});

test('CORASummary: reads the frozen outcomeAtCompletion snapshot once the Case is Completed', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ status: 'Completed', outcomeAtCompletion: 'fail' });
  el.connectedCallback();

  // Even with live Answers that would compute "pass", a Completed Case shows the
  // frozen outcome (ADR-0012).
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), {}, true);

  const block = /** @type {any} */ (el)._children[1];
  assert.equal(
    block._updateArgs.a3,
    true,
    'frozen outcome is treated as answered'
  );
  assert.equal(
    block._updateArgs.a1().outcome,
    'fail',
    'the frozen outcome is rendered, not a recomputation'
  );
});

test('CORASummary: the Outcome block shows the Current Outcome (amended) over the frozen snapshot (ADR-0026)', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({
    status: 'Completed',
    outcomeAtCompletion: 'fail',
    amendedOutcome: {
      outcome: 'pass',
      justification: 'Reviewer misread the call',
      amendedBy: 'controls-1',
      amendedAt: '2026-06-12T00:00:00Z',
    },
  });
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), {}, true);

  const block = /** @type {any} */ (el)._children[1];
  assert.equal(
    block._updateArgs.a1().outcome,
    'pass',
    'the amended Outcome is rendered, not the frozen snapshot'
  );
});

test('CORASummary: reads the frozen snapshot from the reportable milestone (Actions In Progress), ADR-0023', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({
    status: 'Actions In Progress',
    outcomeAtCompletion: 'fail',
  });
  el.connectedCallback();

  // The snapshot is stamped at reportable, so an Actions-In-Progress Case shows
  // the frozen outcome even though it is not yet Completed.
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), {}, true);

  const block = /** @type {any} */ (el)._children[1];
  assert.equal(
    block._updateArgs.a3,
    true,
    'frozen outcome is treated as answered'
  );
  assert.equal(
    block._updateArgs.a1().outcome,
    'fail',
    'the frozen outcome is rendered from the reportable snapshot'
  );
});

test('CORASummary: falls back to live derivation when a Completed Case has no frozen snapshot', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ status: 'Completed' });
  el.connectedCallback();

  const answers = { 'q-welcome': { value: 'No' } };
  const compute = (/** @type {any} */ a) => makeComputeOutcome(a);
  el.update(compute, answers, true);

  const block = /** @type {any} */ (el)._children[1];
  assert.equal(
    block._updateArgs.a1,
    compute,
    'live function used when there is no snapshot to read'
  );
});

test('CORASummary: renders an indeterminate Outcome block before update() is called', () => {
  const el = new CORASummary();
  el.connectedCallback();
  const block = /** @type {any} */ (el)._children[1];
  assert.equal(
    block._updateArgs.a3,
    false,
    'allAnswered is false until update supplies state'
  );
  // The placeholder outcome function resolves to a pass outcome, but allAnswered
  // is false so the Outcome block renders its indeterminate state regardless.
  assert.equal(block._updateArgs.a1().outcome, 'pass');
});

test('CORASummary: renders a Key dates block (Created, Completed) from the Case row', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ created: '2026-04-01', completedAt: '2026-06-05' });
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cora-summary-key-dates');
  assert.ok(block, 'a key-dates block is rendered');
  const text = allText(block);
  assert.ok(text.includes('2026-04-01'), 'shows Created');
  assert.ok(text.includes('2026-06-05'), 'shows Completed');
});

test('CORASummary: Key dates fall back to an em dash when timestamps are absent', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ completedAt: null });
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cora-summary-key-dates');
  assert.ok(allText(block).includes('—'));
});

test('CORASummary: omits the Key dates block when there is no Case row', () => {
  const el = new CORASummary();
  el.connectedCallback();
  assert.equal(
    findByClass(/** @type {any} */ (el), 'cora-summary-key-dates'),
    null
  );
});

test('CORASummary: renders a Case Details block only when details is in summarySections', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ title: 'Rollup case', assignedReviewer: 'jane' });
  el.summarySections = ['details'];
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cora-summary-details');
  assert.ok(block, 'details block rendered when opted in');
  const text = allText(block);
  assert.ok(text.includes('Rollup case'), 'shows the case title');
  assert.ok(text.includes('jane'), 'shows the assigned reviewer');
});

test('CORASummary: Case Details block includes the Case Type configured detail fields', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({
    title: 'Rollup case',
    details: { customerName: 'Jordan Lee' },
  });
  el.summarySections = ['details'];
  el.detailFields = [{ key: 'customerName', label: 'Customer name' }];
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cora-summary-details');
  const text = allText(block);
  assert.ok(text.includes('Customer name'), 'shows the configured label');
  assert.ok(text.includes('Jordan Lee'), 'shows the configured value');
});

test('CORASummary: omits the Case Details block when details is not in summarySections', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.summarySections = [];
  el.connectedCallback();
  assert.equal(
    findByClass(/** @type {any} */ (el), 'cora-summary-details'),
    null
  );
});

const COUNT_CATALOGUE = [
  {
    id: 'q-open',
    text: 'Greeted?',
    category: 'Opening',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: 'Needs found?',
    category: 'Discovery',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Retrain.'],
    deprecated: false,
  },
];

test('CORASummary: renders a per-category pass/fail counts block when questions is opted in', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['questions'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    { 'q-open': { value: 'No' }, 'q-needs': { value: 'Yes' } },
    true
  );

  const block = findByClass(/** @type {any} */ (el), 'cora-summary-counts');
  assert.ok(block, 'counts block rendered');
  const text = allText(block);
  assert.ok(
    /Opening/.test(text) && /Discovery/.test(text),
    'both categories listed'
  );
  assert.ok(/1\s*fail|fail.*1/i.test(text), 'a failed count is shown');
  assert.ok(/1\s*pass|pass.*1/i.test(text), 'a passed count is shown');
});

test('CORASummary: omits the counts block when questions is not opted in', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = [];
  el.connectedCallback();
  assert.equal(
    findByClass(/** @type {any} */ (el), 'cora-summary-counts'),
    null
  );
});

test('CORASummary: renders a remediation block with the action count and each failed Answer + its actions', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['issues'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    {
      'q-open': { value: 'No' },
      // q-needs fails and the Reviewer selected its 'Retrain.' action (issue #250);
      // only selected actions surface in the Summary.
      'q-needs': {
        value: 'No',
        remediationActions: [
          { id: 'q-needs-ra-0', text: 'Retrain.', completed: false },
        ],
      },
    },
    true
  );

  const block = findByClass(
    /** @type {any} */ (el),
    'cora-summary-remediation'
  );
  assert.ok(block, 'remediation block rendered');
  const text = allText(block);
  assert.ok(
    /Remediation Actions?:?\s*1/i.test(text),
    'shows the selected remediation action count (1)'
  );
  assert.ok(
    text.includes('Greeted?') && text.includes('Needs found?'),
    'lists both failed questions'
  );
  assert.ok(
    text.includes('Retrain.'),
    'lists the failed Answer’s selected action'
  );
});

/** @type {any} */
const SUMMARY_CAPTURE_GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    collapsed: false,
    fields: [{ key: 'rootCause', label: 'Root cause', type: 'text' }],
  },
];

test('CORASummary: renders read-only capture groups for a failed Answer that has captured values', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.captureGroups = SUMMARY_CAPTURE_GROUPS;
  el.summarySections = ['issues'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    {
      'q-open': { value: 'No', capture: { rootCause: 'Rushed' } },
      'q-needs': { value: 'No' },
    },
    true
  );

  const caps = findAllByClass(/** @type {any} */ (el), 'cora-summary-capture');
  assert.equal(
    caps.length,
    1,
    'only the failed Answer with captured values renders a capture block'
  );
  assert.equal(
    caps[0]._updateArgs.a3,
    false,
    'capture is rendered read-only in the Summary'
  );
  assert.deepEqual(caps[0]._updateArgs.a2, { rootCause: 'Rushed' });
  assert.equal(caps[0]._updateArgs.a1, SUMMARY_CAPTURE_GROUPS);
});

test('CORASummary: renders no capture block when the Case Type declares no captureGroups', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['issues'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    { 'q-open': { value: 'No', capture: { rootCause: 'x' } } },
    true
  );
  assert.equal(
    findAllByClass(/** @type {any} */ (el), 'cora-summary-capture').length,
    0
  );
});

test('CORASummary: a failed Answer without a category renders just the question text', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ ([
    {
      id: 'q-bare',
      text: 'No category?',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ]);
  el.summarySections = ['issues'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    { 'q-bare': { value: 'No' } },
    true
  );

  const block = findByClass(
    /** @type {any} */ (el),
    'cora-summary-remediation'
  );
  assert.ok(allText(block).includes('No category?'));
});

test('CORASummary: remediation block reports no failures when there are none', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['issues'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    { 'q-open': { value: 'Yes' }, 'q-needs': { value: 'Yes' } },
    true
  );

  const block = findByClass(
    /** @type {any} */ (el),
    'cora-summary-remediation'
  );
  assert.ok(block, 'remediation block still rendered when opted in');
  assert.ok(
    /no failures/i.test(allText(block)),
    'states there are no failures'
  );
});

test('CORASummary: omits the remediation block when remediation is not opted in', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = [];
  el.connectedCallback();
  assert.equal(
    findByClass(/** @type {any} */ (el), 'cora-summary-remediation'),
    null
  );
});

/** @type {any} */
const ACTIONS_GROUPS = [
  {
    key: 'g',
    label: 'G',
    fields: [{ key: 'acts', label: 'Actions', type: 'actions' }],
  },
];

test('CORASummary: remediation tracking block shows the due date and each sent action status/reason (ADR-0024)', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ remediationDueDate: '2026-07-16' });
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.captureGroups = ACTIONS_GROUPS;
  el.summarySections = ['remediation'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    {
      'q-open': {
        value: 'No',
        capture: {
          acts: [
            { id: 'a1', text: 'Re-issue letter', status: 'complete' },
            {
              id: 'a2',
              text: 'Refund fee',
              status: 'cancelled',
              cancelReason: 'Already refunded',
            },
          ],
        },
      },
    },
    true
  );

  const block = findByClass(
    /** @type {any} */ (el),
    'cora-summary-remediation-tracking'
  );
  assert.ok(block, 'remediation tracking block rendered');
  const text = allText(block);
  assert.ok(/Remediation due:\s*2026-07-16/.test(text), 'shows the due date');
  assert.ok(text.includes('Re-issue letter') && text.includes('complete'));
  assert.ok(
    text.includes('Refund fee') &&
      text.includes('cancelled') &&
      text.includes('Already refunded'),
    'shows a cancelled action with its reason'
  );
});

test('CORASummary: remediation tracking block states none sent and an em-dash due date when there are no actions', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.captureGroups = ACTIONS_GROUPS;
  el.summarySections = ['remediation'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    { 'q-open': { value: 'No' } },
    true
  );

  const block = findByClass(
    /** @type {any} */ (el),
    'cora-summary-remediation-tracking'
  );
  assert.ok(block, 'tracking block rendered');
  const text = allText(block);
  assert.ok(/Remediation due:\s*—/.test(text), 'no due date shows an em-dash');
  assert.ok(/no remediation actions sent/i.test(text));
});

test('CORASummary: renders a notes block with the Case notes only when notes is opted in', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ notes: 'Reviewer notes here.' });
  el.summarySections = ['notes'];
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cora-summary-notes');
  assert.ok(block, 'notes block rendered when opted in');
  assert.ok(allText(block).includes('Reviewer notes here.'));
});

test('CORASummary: a Section with no Summary block (e.g. conversation) contributes nothing', () => {
  const el = new CORASummary();
  el.caseRow = makeCase();
  el.summarySections = /** @type {any} */ (['conversation']);
  el.connectedCallback();
  // Only heading, outcome, and key dates — no extra block for conversation.
  assert.equal(/** @type {any} */ (el)._children.length, 3);
});

test('CORASummary: notes block is omitted by default (notes absent from summarySections)', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ notes: 'Reviewer notes here.' });
  el.summarySections = ['details', 'questions', 'remediation'];
  el.connectedCallback();
  assert.equal(
    findByClass(/** @type {any} */ (el), 'cora-summary-notes'),
    null
  );
});

// --- Case Type sectionLabels heading overrides (MAINT-11) ---

test('CORASummary: sectionHeadings prop overrides the Summary h2 and block h3s', () => {
  const el = new CORASummary();
  el.caseRow = makeCase({ notes: 'note text' });
  el.catalogue = [];
  el.summarySections = /** @type {any} */ ([
    'questions',
    'issues',
    'remediation',
    'notes',
  ]);
  el.sectionHeadings = {
    details: 'Details',
    questions: 'Assessment',
    issues: 'Findings',
    remediation: 'Fix-up',
    summary: 'Wrap-up',
    notes: 'Case Notes',
    appealRequest: 'Appeal',
    appealReview: 'Appeal Review',
    amendOutcome: 'Amend Outcome',
    conversation: 'Conversation',
  };
  el.connectedCallback();

  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'Wrap-up');
  const text = allText(el);
  assert.match(text, /Assessment/);
  assert.match(text, /Findings/);
  assert.match(text, /Fix-up/);
  assert.match(text, /Case Notes/);
});

test('Summary: default headings are unchanged when no sectionHeadings passed', () => {
  const nodes = Summary({
    computeOutcome: null,
    answers: {},
    allAnswered: false,
    caseRow: makeCase({ notes: 'n' }),
    catalogue: [],
    summarySections: /** @type {any} */ ([
      'questions',
      'issues',
      'remediation',
      'notes',
    ]),
    captureGroups: [],
    detailFields: [],
    outcomeOptions: [],
  });

  assert.equal(/** @type {any} */ (nodes[0]).textContent, 'Summary');
  const text = nodes.map((n) => allText(n)).join(' ');
  assert.match(text, /Questions/);
  assert.match(text, /Issues/);
  assert.match(text, /Remediation/);
  assert.match(text, /Notes/);
});
