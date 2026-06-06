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
  // Records the most recent update() call so tests can observe what Summary
  // forwarded to the Outcome block.
  update(/** @type {any} */ a1, /** @type {any} */ a2, /** @type {any} */ a3) {
    this._updateArgs = { a1, a2, a3 };
  }
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
});
