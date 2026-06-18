// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// DOM stubs must be in place before any src import.
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {{ a1: any, a2: any, a3: any } | null} */
    this._updateArgs = null;
    this.textContent = '';
    this.className = '';
    this.hidden = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener() {}
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    /** @type {any} */ (this)._attrs ??= {};
    /** @type {any} */ (this)._attrs[k] = v;
  }
  // Records the most recent update() call so tests can observe what Summary
  // forwarded to the Outcome block.
  update(/** @type {any} */ a1, /** @type {any} */ a2, /** @type {any} */ a3) {
    this._updateArgs = { a1, a2, a3 };
  }
}

/**
 * Depth-first find of the first descendant whose className equals `cls`.
 * @param {any} el
 * @param {string} cls
 * @returns {any}
 */
function findByClass(el, cls) {
  for (const c of el._children) {
    if (c.className === cls) return c;
    const found = findByClass(c, cls);
    if (found) return found;
  }
  return null;
}

/**
 * Depth-first collect of all descendants whose className equals `cls`.
 * @param {any} el
 * @param {string} cls
 * @returns {any[]}
 */
function findAllByClass(el, cls) {
  /** @type {any[]} */
  const out = [];
  for (const c of el._children ?? []) {
    if (c.className === cls) out.push(c);
    out.push(...findAllByClass(c, cls));
  }
  return out;
}

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

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) { return new StubEl(); },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };

const { CRSummary } = await import('../src/components/cr-summary.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'c1',
    caseType: 'hello-review',
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
  const hasNo = Object.values(answers).some(a => a.value === 'No');
  return { verdict: /** @type {'pass' | 'fail'} */ (hasNo ? 'fail' : 'pass') };
}

test('CRSummary: renders a Summary heading as its first child', () => {
  const el = new CRSummary();
  el.connectedCallback();
  const heading = (/** @type {any} */ (el))._children[0];
  assert.equal(heading.textContent, 'Summary');
});

test('CRSummary: renders an Outcome block (cr-outcome) as the first content block', () => {
  const el = new CRSummary();
  el.connectedCallback();
  const block = (/** @type {any} */ (el))._children[1];
  assert.ok(block, 'an outcome block is rendered inside Summary');
});

test('CRSummary: forwards live computeOutcome/answers/allAnswered to the Outcome block while In-progress', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ status: 'In-progress' });
  el.connectedCallback();

  const answers = { 'q-welcome': { value: 'No' } };
  const compute = (/** @type {any} */ a) => makeComputeOutcome(a);
  el.update(compute, answers, true);

  const block = (/** @type {any} */ (el))._children[1];
  assert.equal(block._updateArgs.a1, compute, 'the live outcome function is passed through unchanged');
  assert.equal(block._updateArgs.a2, answers, 'the current Answers are passed through');
  assert.equal(block._updateArgs.a3, true, 'allAnswered is passed through');
});

test('CRSummary: reads the frozen outcomeAtCompletion snapshot once the Case is Completed', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ status: 'Completed', outcomeAtCompletion: 'fail' });
  el.connectedCallback();

  // Even with live Answers that would compute "pass", a Completed Case shows the
  // frozen verdict (ADR-0012).
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), {}, true);

  const block = (/** @type {any} */ (el))._children[1];
  assert.equal(block._updateArgs.a3, true, 'frozen outcome is treated as answered');
  assert.equal(block._updateArgs.a1().verdict, 'fail', 'the frozen verdict is rendered, not a recomputation');
});

test('CRSummary: falls back to live derivation when a Completed Case has no frozen snapshot', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ status: 'Completed' });
  el.connectedCallback();

  const answers = { 'q-welcome': { value: 'No' } };
  const compute = (/** @type {any} */ a) => makeComputeOutcome(a);
  el.update(compute, answers, true);

  const block = (/** @type {any} */ (el))._children[1];
  assert.equal(block._updateArgs.a1, compute, 'live function used when there is no snapshot to read');
});

test('CRSummary: renders an indeterminate Outcome block before update() is called', () => {
  const el = new CRSummary();
  el.connectedCallback();
  const block = (/** @type {any} */ (el))._children[1];
  assert.equal(block._updateArgs.a3, false, 'allAnswered is false until update supplies state');
  // The placeholder outcome function resolves to a pass verdict, but allAnswered
  // is false so the Outcome block renders its indeterminate state regardless.
  assert.equal(block._updateArgs.a1().verdict, 'pass');
});

test('CRSummary: renders a Key dates block (Created, Completed) from the Case row', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ created: '2026-04-01', completedAt: '2026-06-05' });
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cr-summary-key-dates');
  assert.ok(block, 'a key-dates block is rendered');
  const text = allText(block);
  assert.ok(text.includes('2026-04-01'), 'shows Created');
  assert.ok(text.includes('2026-06-05'), 'shows Completed');
});

test('CRSummary: Key dates fall back to an em dash when timestamps are absent', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ completedAt: null });
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cr-summary-key-dates');
  assert.ok(allText(block).includes('—'));
});

test('CRSummary: omits the Key dates block when there is no Case row', () => {
  const el = new CRSummary();
  el.connectedCallback();
  assert.equal(findByClass(/** @type {any} */ (el), 'cr-summary-key-dates'), null);
});

test('CRSummary: renders a Case Details block only when details is in summarySections', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ title: 'Rollup case', assignedReviewer: 'jane' });
  el.summarySections = ['details'];
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cr-summary-details');
  assert.ok(block, 'details block rendered when opted in');
  const text = allText(block);
  assert.ok(text.includes('Rollup case'), 'shows the case title');
  assert.ok(text.includes('jane'), 'shows the assigned reviewer');
});

test('CRSummary: omits the Case Details block when details is not in summarySections', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.summarySections = [];
  el.connectedCallback();
  assert.equal(findByClass(/** @type {any} */ (el), 'cr-summary-details'), null);
});

const COUNT_CATALOGUE = [
  { id: 'q-open', text: 'Greeted?', category: 'Opening', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  { id: 'q-needs', text: 'Needs found?', category: 'Discovery', responseType: 'yes-no-na', failureCriteria: 'No', remediationActions: ['Retrain.'], deprecated: false },
];

test('CRSummary: renders a per-category pass/fail counts block when questions is opted in', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['questions'];
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), { 'q-open': { value: 'No' }, 'q-needs': { value: 'Yes' } }, true);

  const block = findByClass(/** @type {any} */ (el), 'cr-summary-counts');
  assert.ok(block, 'counts block rendered');
  const text = allText(block);
  assert.ok(/Opening/.test(text) && /Discovery/.test(text), 'both categories listed');
  assert.ok(/1\s*fail|fail.*1/i.test(text), 'a failed count is shown');
  assert.ok(/1\s*pass|pass.*1/i.test(text), 'a passed count is shown');
});

test('CRSummary: omits the counts block when questions is not opted in', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = [];
  el.connectedCallback();
  assert.equal(findByClass(/** @type {any} */ (el), 'cr-summary-counts'), null);
});

test('CRSummary: renders a remediation block with the action count and each failed Answer + its actions', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['remediation'];
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), { 'q-open': { value: 'No' }, 'q-needs': { value: 'No' } }, true);

  const block = findByClass(/** @type {any} */ (el), 'cr-summary-remediation');
  assert.ok(block, 'remediation block rendered');
  const text = allText(block);
  assert.ok(/Remediation Actions?:?\s*1/i.test(text), 'shows the remediation action count (1)');
  assert.ok(text.includes('Greeted?') && text.includes('Needs found?'), 'lists both failed questions');
  assert.ok(text.includes('Retrain.'), 'lists the failed Answer’s action');
});

/** @type {any} */
const SUMMARY_CAPTURE_GROUPS = [
  { key: 'cause', label: 'Cause', collapsed: false, fields: [
    { key: 'rootCause', label: 'Root cause', type: 'text' },
  ]},
];

test('CRSummary: renders read-only capture groups for a failed Answer that has captured values', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.captureGroups = SUMMARY_CAPTURE_GROUPS;
  el.summarySections = ['remediation'];
  el.connectedCallback();
  el.update(
    (/** @type {any} */ a) => makeComputeOutcome(a),
    { 'q-open': { value: 'No', capture: { rootCause: 'Rushed' } }, 'q-needs': { value: 'No' } },
    true
  );

  const caps = findAllByClass(/** @type {any} */ (el), 'cr-summary-capture');
  assert.equal(caps.length, 1, 'only the failed Answer with captured values renders a capture block');
  assert.equal(caps[0]._updateArgs.a3, false, 'capture is rendered read-only in the Summary');
  assert.deepEqual(caps[0]._updateArgs.a2, { rootCause: 'Rushed' });
  assert.equal(caps[0]._updateArgs.a1, SUMMARY_CAPTURE_GROUPS);
});

test('CRSummary: renders no capture block when the Case Type declares no captureGroups', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['remediation'];
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), { 'q-open': { value: 'No', capture: { rootCause: 'x' } } }, true);
  assert.equal(findAllByClass(/** @type {any} */ (el), 'cr-summary-capture').length, 0);
});

test('CRSummary: a failed Answer without a category renders just the question text', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ ([
    { id: 'q-bare', text: 'No category?', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ]);
  el.summarySections = ['remediation'];
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), { 'q-bare': { value: 'No' } }, true);

  const block = findByClass(/** @type {any} */ (el), 'cr-summary-remediation');
  assert.ok(allText(block).includes('No category?'));
});

test('CRSummary: remediation block reports no failures when there are none', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = ['remediation'];
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), { 'q-open': { value: 'Yes' }, 'q-needs': { value: 'Yes' } }, true);

  const block = findByClass(/** @type {any} */ (el), 'cr-summary-remediation');
  assert.ok(block, 'remediation block still rendered when opted in');
  assert.ok(/no failures/i.test(allText(block)), 'states there are no failures');
});

test('CRSummary: omits the remediation block when remediation is not opted in', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.catalogue = /** @type {any} */ (COUNT_CATALOGUE);
  el.summarySections = [];
  el.connectedCallback();
  assert.equal(findByClass(/** @type {any} */ (el), 'cr-summary-remediation'), null);
});

test('CRSummary: renders a notes block with the Case notes only when notes is opted in', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ notes: 'Reviewer notes here.' });
  el.summarySections = ['notes'];
  el.connectedCallback();
  const block = findByClass(/** @type {any} */ (el), 'cr-summary-notes');
  assert.ok(block, 'notes block rendered when opted in');
  assert.ok(allText(block).includes('Reviewer notes here.'));
});

test('CRSummary: a Section with no Summary block (e.g. conversation) contributes nothing', () => {
  const el = new CRSummary();
  el.caseRow = makeCase();
  el.summarySections = /** @type {any} */ (['conversation']);
  el.connectedCallback();
  // Only heading, outcome, and key dates — no extra block for conversation.
  assert.equal((/** @type {any} */ (el))._children.length, 3);
});

test('CRSummary: notes block is omitted by default (notes absent from summarySections)', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ notes: 'Reviewer notes here.' });
  el.summarySections = ['details', 'questions', 'remediation'];
  el.connectedCallback();
  assert.equal(findByClass(/** @type {any} */ (el), 'cr-summary-notes'), null);
});

/** @returns {import('../src/sharepoint-client.js').QuestionDefinition[]} */
function overrideCatalogue() {
  return [
    { id: 'q-welcome', text: 'Was the customer greeted professionally?', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
}

/** @returns {import('../src/sharepoint-client.js').Override[]} */
function flipPassToFail() {
  return [
    { source: 'qa', author: 'qa-1', at: '2026-06-11T00:00:00Z', answerKey: 'q-welcome', value: 'No', reasoning: 'Greeting was absent.' },
  ];
}

test('CRSummary: a Completed Case with Overrides shows the derived Current Outcome, not the frozen snapshot', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ status: 'Completed', outcomeAtCompletion: 'pass', overrides: flipPassToFail() });
  el.catalogue = overrideCatalogue();
  el.connectedCallback();

  // Frozen Answers said pass; the Override flips q-welcome to a failure, so the
  // Current Outcome derives to fail (ADR-0018).
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), { 'q-welcome': { value: 'Yes' } }, true);

  const block = (/** @type {any} */ (el))._children[1];
  assert.equal(block._updateArgs.a1().verdict, 'fail', 'Current Outcome derived over Effective Answers');
  assert.equal(block._updateArgs.a3, true);
});

test('CRSummary: renders an Outcome corrections block with original→overridden, source and reasoning', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ status: 'Completed', outcomeAtCompletion: 'pass', overrides: flipPassToFail() });
  el.catalogue = overrideCatalogue();
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), { 'q-welcome': { value: 'Yes' } }, true);

  const block = findByClass(/** @type {any} */ (el), 'cr-summary-outcome-overrides');
  assert.ok(block, 'a corrections block is rendered');
  const text = allText(block);
  assert.ok(text.includes('Was the customer greeted professionally?'), 'shows the question label');
  assert.ok(text.includes('Yes'), 'shows the original value');
  assert.ok(text.includes('No'), 'shows the overridden value');
  assert.ok(text.includes('Greeting was absent.'), 'shows the reasoning');
  assert.ok(/qa/i.test(text), 'shows the source');
});

test('CRSummary: no Outcome corrections block when the Completed Case has no Overrides', () => {
  const el = new CRSummary();
  el.caseRow = makeCase({ status: 'Completed', outcomeAtCompletion: 'pass' });
  el.catalogue = overrideCatalogue();
  el.connectedCallback();
  el.update((/** @type {any} */ a) => makeComputeOutcome(a), {}, true);
  assert.equal(findByClass(/** @type {any} */ (el), 'cr-summary-outcome-overrides'), null);
});
