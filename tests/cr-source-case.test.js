// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// DOM stubs must be in place before any src import.
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.value = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute() {}
  // cr-outcome / cr-override-editor stubs record their last update() args.
  update(/** @type {any[]} */ ...args) {
    this._update = args;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).CustomEvent = class {
  constructor(/** @type {string} */ t, /** @type {any} */ o) {
    this.type = t;
    Object.assign(this, o);
  }
};
/** @type {any} */ (globalThis).document = {
  createElement() {
    return new StubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };

const { CRSourceCase } = await import('../src/components/cr-source-case.js');
const { SaveQueue } = await import('../src/services/save-queue.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q-welcome',
    text: 'Was the customer greeted professionally?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: 'Were needs identified?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
];

/** Mirrors example-review: fail if any Answer is 'No'. */
const computeOutcome = (/** @type {Record<string, any>} */ a) => ({
  outcome: Object.values(a).some((x) => x.value === 'No') ? 'fail' : 'pass',
});

/** @returns {CaseRow} */
function originalRow() {
  return {
    id: 'case-14',
    caseType: 'example-review',
    title: 'Example Review #14 (overridden)',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'Yes' } },
    overrides: [
      {
        source: 'qa',
        author: 'user-qa',
        at: '2026-04-05T00:00:00Z',
        answerKey: 'q-welcome',
        value: 'No',
        reasoning: 'No greeting on the recording.',
      },
    ],
    conversation: [],
    notes: '',
    completedAt: '2026-04-05T08:00:00Z',
    outcomeAtCompletion: 'pass',
    etag: 'etag-c14-v1',
  };
}

/** @param {Record<string, any>} [props] @returns {any} */
function mount(props = {}) {
  const el = new CRSourceCase();
  const row = originalRow();
  const saveQueue = new SaveQueue(/** @type {any} */ ({}));
  saveQueue.loadCase(row);
  Object.assign(el, {
    originalRow: row,
    catalogue: CATALOGUE,
    computeOutcome,
    attributeFailures: true,
    remediationFields: [],
    saveQueue,
    currentUser: { id: 'user-qa', displayName: 'Quinn QA' },
    client: {},
    overrideAccess: 'override',
    sourceCaseId: 'qa-case-1',
    ...props,
  });
  el.connectedCallback();
  return el;
}

const textOf = (/** @type {any} */ el) =>
  /** @type {any[]} */ (el._children).map((c) => c.textContent);

test('cr-source-case: renders the SourceCaseId and the original Case title', () => {
  const el = mount();
  const texts = textOf(el);
  assert.ok(
    texts.some((t) => t.includes('case-14')),
    'renders the SourceCaseId'
  );
  assert.ok(
    texts.some((t) => t.includes('Example Review #14')),
    'renders the original title'
  );
});

test('cr-source-case: Current Outcome is derived from the Effective Answers (override applied)', () => {
  const el = mount();
  const outcomeEl = /** @type {any[]} */ (el._children).find(
    (c) => typeof c.update === 'function' && c._update
  );
  assert.ok(outcomeEl, 'a cr-outcome was updated');
  const [computeFn, , allAnswered] = outcomeEl._update;
  assert.equal(
    allAnswered,
    true,
    'Outcome is shown as resolved for a Completed source Case'
  );
  // q-welcome is overridden Yes→No, so the Effective Answers fail.
  assert.equal(
    computeFn({}).outcome,
    'fail',
    'Current Outcome re-derives to fail from the Effective Answers'
  );
});

test('cr-source-case: lists each question with its Effective (overridden) value', () => {
  const el = mount();
  // Find the effective-answers list and assert q-welcome shows the overridden No.
  const list = /** @type {any[]} */ (el._children).find(
    (c) => c.className === 'cr-source-case-answers'
  );
  assert.ok(list, 'renders an effective-answers list');
  const items = /** @type {any[]} */ (list._children).map(
    (li) => li.textContent
  );
  assert.ok(
    items.some((t) => t.includes('greeted') && t.includes('No')),
    'q-welcome shows its Effective value (No)'
  );
});

test('cr-source-case: embeds the Override editor wired cross-row to the original', () => {
  const el = mount();
  const editor = /** @type {any[]} */ (el._children).find(
    (c) => c.caseId !== undefined && c.source === 'qa'
  );
  assert.ok(editor, 'the cr-override-editor is embedded');
  assert.equal(
    editor.caseId,
    'case-14',
    'the write targets the original row id (cross-row)'
  );
  assert.equal(
    editor.caseRow,
    el.originalRow,
    'the editor reads the original row'
  );
  assert.equal(
    editor.access,
    'override',
    'access is resolved against the linked original'
  );
  assert.equal(
    editor.sourceCaseId,
    'qa-case-1',
    'authored-during-QA-Check provenance is stamped'
  );
  assert.equal(
    editor.saveQueue,
    el.saveQueue,
    'writes go through the shared SaveQueue'
  );
  assert.equal(
    editor.currentUser.id,
    'user-qa',
    'the QA Reviewer authors the Override'
  );
  assert.equal(
    editor.attributeFailures,
    true,
    'forwards the original Case Type attribution flag'
  );
});

test('cr-source-case: a QA Reviewer who is not the original reviewer gets override access; the editor still mounts read-only otherwise', () => {
  const el = mount({ overrideAccess: 'read-only' });
  const editor = /** @type {any[]} */ (el._children).find(
    (c) => c.source === 'qa'
  );
  assert.equal(
    editor.access,
    'read-only',
    'read-only when the original is not in an overridable state'
  );
});

test('cr-source-case: formats multi-choice and unanswered values, and tolerates a null computeOutcome', () => {
  /** @type {QuestionDefinition[]} */
  const catalogue = [
    {
      id: 'q-products',
      text: 'Which products?',
      responseType: 'multi-choice',
      options: ['A', 'B'],
      deprecated: false,
    },
    {
      id: 'q-blank',
      text: 'Unanswered question?',
      responseType: 'yes-no-na',
      deprecated: false,
    },
  ];
  const row = originalRow();
  row.answers = { 'q-products': { value: ['A', 'B'] } }; // q-blank has no Answer
  row.overrides = undefined; // exercise the no-overrides path
  const el = mount({ originalRow: row, catalogue, computeOutcome: null });

  const list = /** @type {any[]} */ (el._children).find(
    (c) => c.className === 'cr-source-case-answers'
  );
  const items = /** @type {any[]} */ (list._children).map(
    (li) => li.textContent
  );
  assert.ok(
    items.some((t) => t.includes('A, B')),
    'multi-choice values are joined'
  );
  assert.ok(
    items.some((t) => t.includes('—')),
    'an unanswered Question renders an em dash'
  );

  // With no computeOutcome the panel falls back to a default outcome rather than throwing.
  const outcomeEl = /** @type {any[]} */ (el._children).find(
    (c) => typeof c.update === 'function' && c._update
  );
  assert.equal(
    outcomeEl._update[0]().outcome,
    'pass',
    'falls back to a default Outcome when none is supplied'
  );
});

test('cr-source-case: renders a not-found message and no editor when the original is missing', () => {
  const el = mount({ originalRow: null });
  const texts = textOf(el);
  assert.ok(
    texts.some((t) => t.includes('not found') || t.includes('not available')),
    'shows a missing-source message'
  );
  const editor = /** @type {any[]} */ (el._children).find(
    (c) => c.source === 'qa'
  );
  assert.equal(editor, undefined, 'no Override editor without a source Case');
});
