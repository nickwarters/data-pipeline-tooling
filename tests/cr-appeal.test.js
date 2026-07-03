// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import.

const { CRAppeal } = await import('../src/components/cr-appeal.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    status: 'Completed',
    assignedReviewer: 'u1',
    responsibleParty: 'u-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: '2026-06-10T00:00:00Z',
    etag: 'e1',
    ...overrides,
  };
}

function makeQueue() {
  /** @type {{ id: string, field: string, value: any }[]} */
  const enqueued = [];
  return {
    enqueued,
    enqueue(
      /** @type {string} */ id,
      /** @type {string} */ field,
      /** @type {any} */ value
    ) {
      enqueued.push({ id, field, value });
    },
  };
}

/** Build a `cr-appeal` wired for the edit (raise) flow. */
function makeEditable(caseOverrides = {}) {
  const queue = makeQueue();
  const el = new CRAppeal();
  el.caseRow = makeCase(caseOverrides);
  el.saveQueue = /** @type {any} */ (queue);
  el.caseId = 'c1';
  el.access = 'edit';
  el.currentUser = { id: 'u-rp', displayName: 'RP' };
  el.connectedCallback();
  return { el, queue };
}

// --- Rendering ---

test('CRAppeal: renders an Appeal heading first', () => {
  const el = new CRAppeal();
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'Appeal');
});

test('CRAppeal: edit access on a Completed Case shows the raise form', () => {
  const { el } = makeEditable();
  assert.ok(findByClass(el, 'cr-appeal-form'), 'raise form rendered');
  assert.ok(findByClass(el, 'cr-appeal-rationale'), 'rationale input rendered');
  assert.ok(findByClass(el, 'cr-appeal-submit'), 'submit button rendered');
});

test('CRAppeal: read-only access shows no form and a placeholder when there are no Appeals', () => {
  const el = new CRAppeal();
  el.caseRow = makeCase();
  el.access = 'read-only';
  el.connectedCallback();
  assert.equal(
    findByClass(el, 'cr-appeal-form'),
    null,
    'no form for a read-only viewer'
  );
  assert.ok(findByClass(el, 'cr-appeal-empty'), 'placeholder shown');
});

test('CRAppeal: with no caseRow there are no Appeals to list', () => {
  const el = new CRAppeal();
  el.access = 'read-only';
  el.connectedCallback();
  assert.ok(findByClass(el, 'cr-appeal-empty'));
});

// --- Citations (failed Answers) ---

const FAIL_CATALOGUE = [
  {
    id: 'q-greet',
    text: 'Greeted?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
  {
    id: 'q-close',
    text: 'Closed well?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
];

test('CRAppeal: the form offers a citation checkbox only for failed Answers', () => {
  const { el } = makeEditable();
  el.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  el.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'Yes' } };
  el.connectedCallback();
  const boxes = findAllByClass(el, 'cr-appeal-cite');
  assert.equal(
    boxes.length,
    1,
    'only the failed Answer is offered for citation'
  );
});

test('CRAppeal: the citations list is introduced with a heading and guidance when there are failed Answers', () => {
  const { el } = makeEditable();
  el.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  el.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'No' } };
  el.connectedCallback();
  const heading = findByClass(el, 'cr-appeal-cite-heading');
  const intro = findByClass(el, 'cr-appeal-cite-intro');
  assert.ok(heading, 'a citations heading is rendered');
  assert.ok(intro, 'guidance wording is rendered');
  assert.match(intro.textContent, /disagree with/i);
});

test('CRAppeal: the citations heading sits between the rationale and the citation checkboxes', () => {
  const { el } = makeEditable();
  el.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  el.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'No' } };
  el.connectedCallback();
  const form = findByClass(el, 'cr-appeal-form');
  const classes = form._children.map((/** @type {any} */ c) => c.className);
  const rationaleIdx = classes.indexOf('cr-appeal-rationale');
  const headingIdx = classes.indexOf('cr-appeal-cite-heading');
  const firstCiteIdx = classes.indexOf('cr-appeal-cite');
  assert.ok(
    rationaleIdx > -1 && rationaleIdx < headingIdx,
    'heading follows the rationale'
  );
  assert.ok(
    headingIdx > -1 && headingIdx < firstCiteIdx,
    'heading precedes the citation checkboxes'
  );
});

test('CRAppeal: the citations heading and guidance are omitted when there are no failed Answers', () => {
  const { el } = makeEditable();
  el.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  el.answers = { 'q-greet': { value: 'Yes' }, 'q-close': { value: 'Yes' } };
  el.connectedCallback();
  assert.equal(findByClass(el, 'cr-appeal-cite-heading'), null);
  assert.equal(findByClass(el, 'cr-appeal-cite-intro'), null);
});

// --- Raise flow ---

test('CRAppeal: raising with a rationale enqueues an additive appeals save with state raised', () => {
  const { el, queue } = makeEditable();
  const rationale = findByClass(el, 'cr-appeal-rationale');
  rationale.value = '  The greeting was actually present.  ';
  findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();

  assert.equal(queue.enqueued.length, 1);
  assert.equal(queue.enqueued[0].id, 'c1');
  assert.equal(queue.enqueued[0].field, 'appeals');
  const saved = queue.enqueued[0].value;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].state, 'raised');
  assert.equal(saved[0].appellant, 'u-rp');
  assert.equal(
    saved[0].rationale,
    'The greeting was actually present.',
    'rationale is trimmed'
  );
  assert.ok(saved[0].id, 'an id is assigned');
  assert.ok(saved[0].at, 'a timestamp is stamped');
  assert.equal(
    saved[0].citedAnswerKeys,
    undefined,
    'no citations when none selected'
  );
});

test('CRAppeal: raising appends to existing resolved Appeals (full history kept)', () => {
  const prior = {
    id: 'a0',
    appellant: 'u-rp',
    at: '2026-01-01T00:00:00Z',
    rationale: 'old',
    state: 'resolved',
  };
  const { el, queue } = makeEditable({ appeals: [prior] });
  findByClass(el, 'cr-appeal-rationale').value = 'second appeal';
  findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();
  const saved = queue.enqueued[0].value;
  assert.equal(saved.length, 2, 'prior Appeal retained');
  assert.equal(saved[0].id, 'a0');
  assert.equal(saved[1].rationale, 'second appeal');
});

test('CRAppeal: an empty rationale shows a validation error and does not save', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cr-appeal-rationale').value = '   ';
  findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0, 'nothing persisted');
  assert.equal(
    findByClass(el, 'cr-appeal-error').hidden,
    false,
    'error is revealed'
  );
});

test('CRAppeal: a missing rationale value (null) is treated as empty', () => {
  const { el, queue } = makeEditable();
  const rationale = findByClass(el, 'cr-appeal-rationale');
  rationale.value = /** @type {any} */ (null);
  findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0);
});

test('CRAppeal: citing disputed failed Answers records their keys on the Appeal', () => {
  const { el, queue } = makeEditable();
  el.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  el.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'No' } };
  el.connectedCallback();

  findByClass(el, 'cr-appeal-rationale').value = 'both wrong';
  const boxes = findAllByClass(el, 'cr-appeal-cite').map((w) => w._children[0]);
  boxes[0].checked = true; // cite q-greet only
  findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();

  const saved = queue.enqueued[0].value;
  assert.deepEqual(
    saved[0].citedAnswerKeys,
    ['q-greet'],
    'only the checked Answer is cited'
  );
});

test('CRAppeal: a raised Appeal does not set Answer values (case-level only)', () => {
  const { el, queue } = makeEditable({
    answers: { 'q-greet': { value: 'No' } },
  });
  findByClass(el, 'cr-appeal-rationale').value = 'dispute';
  findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();
  // Only the `appeals` field is ever written — never `answers`.
  assert.deepEqual(
    queue.enqueued.map((e) => e.field),
    ['appeals']
  );
  assert.deepEqual(
    el.caseRow?.answers,
    { 'q-greet': { value: 'No' } },
    'frozen Answers untouched'
  );
});

test('CRAppeal: after raising, the form is replaced by an open-Appeal note (one open at a time)', () => {
  const { el } = makeEditable();
  findByClass(el, 'cr-appeal-rationale').value = 'dispute';
  findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();
  assert.equal(
    findByClass(el, 'cr-appeal-form'),
    null,
    'form removed once an Appeal is open'
  );
  assert.ok(findByClass(el, 'cr-appeal-open-note'), 'open-Appeal note shown');
  assert.ok(
    findByClass(el, 'cr-appeal-item'),
    'the raised Appeal appears in the history'
  );
});

test('CRAppeal: an existing open Appeal blocks the form even before raising', () => {
  const open = {
    id: 'a1',
    appellant: 'u-rp',
    at: '2026-06-10T00:00:00Z',
    rationale: 'pending',
    state: 'underReview',
  };
  const { el } = makeEditable({ appeals: [open] });
  assert.equal(findByClass(el, 'cr-appeal-form'), null);
  assert.ok(findByClass(el, 'cr-appeal-open-note'));
});

test('CRAppeal: an Appeal item renders its state, rationale and cited Answers', () => {
  const el = new CRAppeal();
  el.access = 'read-only';
  el.caseRow = makeCase({
    appeals: [
      {
        id: 'a1',
        appellant: 'u-rp',
        at: '2026-06-10T00:00:00Z',
        rationale: 'wrong outcome',
        citedAnswerKeys: ['q-greet'],
        state: 'raised',
      },
    ],
  });
  el.connectedCallback();
  const item = findByClass(el, 'cr-appeal-item');
  assert.ok(
    findByClass(item, 'cr-appeal-state').textContent.includes('raised')
  );
  assert.equal(
    findByClass(item, 'cr-appeal-item-rationale').textContent,
    'wrong outcome'
  );
  assert.ok(
    findByClass(item, 'cr-appeal-item-cited').textContent.includes('q-greet')
  );
});

test('CRAppeal: a resolved Appeal item renders its verdict and resolver rationale', () => {
  const el = new CRAppeal();
  el.access = 'read-only';
  el.caseRow = makeCase({
    appeals: [
      {
        id: 'a1',
        appellant: 'u-rp',
        at: '2026-06-10T00:00:00Z',
        rationale: 'wrong',
        state: 'resolved',
        resolution: {
          verdict: 'agreed',
          rationale: 'Reviewer misread the transcript.',
          resolver: 'u-qa',
          at: '2026-06-11T00:00:00Z',
        },
      },
    ],
  });
  el.connectedCallback();
  const item = findByClass(el, 'cr-appeal-item');
  assert.ok(
    findByClass(item, 'cr-appeal-resolution').textContent.includes('agreed'),
    'verdict shown'
  );
  assert.ok(
    findByClass(item, 'cr-appeal-resolution').textContent.includes(
      'Reviewer misread the transcript.'
    ),
    'resolver rationale shown'
  );
});

test('CRAppeal: an open Appeal item omits the resolution line', () => {
  const el = new CRAppeal();
  el.access = 'read-only';
  el.caseRow = makeCase({
    appeals: [
      {
        id: 'a1',
        appellant: 'u-rp',
        at: '2026-06-10T00:00:00Z',
        rationale: 'pending',
        state: 'raised',
      },
    ],
  });
  el.connectedCallback();
  assert.equal(findByClass(el, 'cr-appeal-resolution'), null);
});

test('CRAppeal: an Appeal item without citations omits the cited-Answers line', () => {
  const el = new CRAppeal();
  el.access = 'read-only';
  el.caseRow = makeCase({
    appeals: [
      {
        id: 'a1',
        appellant: 'u-rp',
        at: '2026-06-10T00:00:00Z',
        rationale: 'no citations',
        state: 'raised',
      },
    ],
  });
  el.connectedCallback();
  assert.equal(findByClass(el, 'cr-appeal-item-cited'), null);
});

test('CRAppeal: raising without a saveQueue or caseRow does not throw', () => {
  const el = new CRAppeal();
  el.access = 'edit';
  el.caseRow = null;
  el.saveQueue = null;
  el.currentUser = null;
  el.connectedCallback();
  const rationale = findByClass(el, 'cr-appeal-rationale');
  rationale.value = 'orphan appeal';
  assert.doesNotThrow(() => {
    findByClass(el, 'cr-appeal-submit')._listeners['click'][0]();
  });
});
test('CRAppeal: newAppealId yields a non-empty string', () => {
  assert.ok(new CRAppeal().newAppealId().length > 0);
});
