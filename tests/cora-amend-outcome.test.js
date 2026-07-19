// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import.

const { AmendOutcomeSection } =
  await import('../src/pages/cora-case-review/amend-outcome-view.js');

class CORAAmendOutcome extends HTMLElement {
  constructor() {
    super();
    /** @type {any} */
    this.caseRow = null;
    /** @type {any} */
    this.saveQueue = null;
    this.caseId = '';
    this.access = /** @type {'edit'|'read-only'|'hidden'} */ ('read-only');
    /** @type {any} */
    this.currentUser = null;
    /** @type {any[]} */
    this.outcomeOptions = [];
  }

  now() {
    return new Date().toISOString();
  }

  connectedCallback() {
    this.replaceChildren(
      ...AmendOutcomeSection({
        caseRow: this.caseRow,
        saveQueue: /** @type {any} */ (this.saveQueue),
        caseId: this.caseId,
        access: this.access,
        currentUser: this.currentUser,
        outcomeOptions: this.outcomeOptions,
        now: () => this.now(),
        render: () => this.connectedCallback(),
      })
    );
  }
}

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return /** @type {CaseRow} */ ({
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
    outcomeAtCompletion: 'fail',
    hadRemediation: true,
    etag: 'e1',
    ...overrides,
  });
}

function makeQueue() {
  /** @type {{ id: string, fields: any }[]} */
  const enqueued = [];
  return {
    enqueued,
    enqueueFields(/** @type {string} */ id, /** @type {any} */ fields) {
      enqueued.push({ id, fields });
    },
  };
}

const OUTCOME_OPTIONS = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'refer', wording: 'Refer', severity: 50 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

/** @param {any} el @returns {string} */
function allText(el) {
  let out = el.textContent ? el.textContent + ' ' : '';
  for (const c of el._children ?? []) out += allText(c);
  return out;
}

/** Build a `cora-amend-outcome` wired for the Controls edit flow. */
function makeEditable(caseOverrides = {}) {
  const queue = makeQueue();
  const el = new CORAAmendOutcome();
  el.caseRow = makeCase(caseOverrides);
  el.saveQueue = /** @type {any} */ (queue);
  el.caseId = 'c1';
  el.access = 'edit';
  el.currentUser = { id: 'controls-1', displayName: 'Controls' };
  el.outcomeOptions = OUTCOME_OPTIONS;
  el.now = () => '2026-06-12T00:00:00Z';
  el.connectedCallback();
  return { el, queue };
}

// --- Rendering ---

test('CORAAmendOutcome: renders an Amend Outcome heading first', () => {
  const el = new CORAAmendOutcome();
  el.connectedCallback();
  assert.equal(
    /** @type {any} */ (el)._children[0].textContent,
    'Amend Outcome'
  );
});

test('CORAAmendOutcome: shows the Current Outcome (the frozen snapshot) with configured wording', () => {
  const el = new CORAAmendOutcome();
  el.caseRow = makeCase({ outcomeAtCompletion: 'fail' });
  el.access = 'read-only';
  el.outcomeOptions = OUTCOME_OPTIONS;
  el.connectedCallback();
  const current = findByClass(el, 'cora-amend-outcome-current');
  assert.ok(
    current.textContent.includes('Fail'),
    'renders the outcome wording'
  );
});

test('CORAAmendOutcome: Current Outcome falls back to an em dash before a snapshot exists', () => {
  const el = new CORAAmendOutcome();
  const c = makeCase({ status: 'In-progress' });
  delete (/** @type {any} */ (c).outcomeAtCompletion);
  el.caseRow = c;
  el.access = 'read-only';
  el.connectedCallback();
  assert.ok(
    findByClass(el, 'cora-amend-outcome-current').textContent.includes('—')
  );
});

test('CORAAmendOutcome: Current Outcome shows the amended value once amended', () => {
  const el = new CORAAmendOutcome();
  el.caseRow = makeCase({
    outcomeAtCompletion: 'fail',
    amendedOutcome: {
      outcome: 'pass',
      justification: 'ok',
      amendedBy: 'controls-1',
      amendedAt: '2026-06-12T00:00:00Z',
    },
  });
  el.access = 'read-only';
  el.outcomeOptions = OUTCOME_OPTIONS;
  el.connectedCallback();
  assert.ok(
    findByClass(el, 'cora-amend-outcome-current').textContent.includes('Pass'),
    'the amended Outcome is in force'
  );
});

test('CORAAmendOutcome: Current Outcome falls back to the raw value when no option wording matches', () => {
  const el = new CORAAmendOutcome();
  el.caseRow = makeCase({ outcomeAtCompletion: 'fail' });
  el.access = 'read-only';
  el.outcomeOptions = []; // no wording configured for this Case Type
  el.connectedCallback();
  assert.ok(
    findByClass(el, 'cora-amend-outcome-current').textContent.includes('fail'),
    'renders the raw outcome value'
  );
});

test('CORAAmendOutcome: edit access on a Completed Case shows the amend form', () => {
  const { el } = makeEditable();
  assert.ok(findByClass(el, 'cora-amend-outcome-form'), 'form rendered');
  assert.ok(findByClass(el, 'cora-amend-outcome-select'), 'outcome select');
  assert.ok(
    findByClass(el, 'cora-amend-outcome-justification'),
    'justification input'
  );
  assert.ok(findByClass(el, 'cora-amend-outcome-submit'), 'submit button');
});

test('CORAAmendOutcome: read-only access shows a placeholder when nothing has been amended', () => {
  const el = new CORAAmendOutcome();
  el.caseRow = makeCase();
  el.access = 'read-only';
  el.connectedCallback();
  assert.equal(findByClass(el, 'cora-amend-outcome-form'), null, 'no form');
  assert.ok(
    findByClass(el, 'cora-empty cora-amend-outcome-empty'),
    'placeholder shown'
  );
});

test('CORAAmendOutcome: read-only access with no Case row shows the empty placeholder', () => {
  const el = new CORAAmendOutcome();
  el.caseRow = null;
  el.access = 'read-only';
  el.connectedCallback();
  assert.ok(findByClass(el, 'cora-empty cora-amend-outcome-empty'));
});

test('CORAAmendOutcome: read-only access renders the existing amendment record', () => {
  const el = new CORAAmendOutcome();
  el.caseRow = makeCase({
    amendedOutcome: {
      outcome: 'pass',
      justification: 'Reviewer misread the transcript.',
      amendedBy: 'controls-1',
      amendedAt: '2026-06-12T00:00:00Z',
    },
  });
  el.access = 'read-only';
  el.outcomeOptions = OUTCOME_OPTIONS;
  el.connectedCallback();
  const record = findByClass(el, 'cora-amend-outcome-record');
  assert.ok(record, 'record rendered');
  const text = allText(record);
  assert.ok(text.includes('Reviewer misread the transcript.'), 'justification');
  assert.ok(text.includes('controls-1'), 'amendedBy shown');
  assert.ok(text.includes('2026-06-12T00:00:00Z'), 'amendedAt shown');
});

// --- Amend flow ---

test('CORAAmendOutcome: amending writes the record and re-stamps the effective columns in one field set', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-amend-outcome-select').value = 'pass';
  findByClass(el, 'cora-amend-outcome-justification').value =
    '  Corrected after appeal.  ';
  findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();

  assert.equal(queue.enqueued.length, 1, 'a single ETag-guarded write');
  assert.equal(queue.enqueued[0].id, 'c1');
  const fields = queue.enqueued[0].fields;
  assert.deepEqual(fields, {
    amendedOutcome: {
      outcome: 'pass',
      justification: 'Corrected after appeal.',
      amendedBy: 'controls-1',
      amendedAt: '2026-06-12T00:00:00Z',
    },
    effectiveOutcome: 'pass',
    effectiveHadRemediation: true,
    outcomeOverridden: true,
  });
});

test('CORAAmendOutcome: amending mutates the Case row locally so the view reflects it', () => {
  const { el } = makeEditable();
  findByClass(el, 'cora-amend-outcome-select').value = 'refer';
  findByClass(el, 'cora-amend-outcome-justification').value = 'Borderline';
  findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();

  assert.equal(el.caseRow?.amendedOutcome?.outcome, 'refer');
  assert.equal(el.caseRow?.effectiveOutcome, 'refer');
  assert.equal(el.caseRow?.outcomeOverridden, true);
  assert.equal(
    el.caseRow?.outcomeAtCompletion,
    'fail',
    'the frozen snapshot is untouched'
  );
  assert.ok(
    findByClass(el, 'cora-amend-outcome-current').textContent.includes('Refer'),
    'the Current Outcome re-renders to the amended value'
  );
});

test('CORAAmendOutcome: a missing justification blocks the write and reveals an error', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-amend-outcome-select').value = 'pass';
  findByClass(el, 'cora-amend-outcome-justification').value = '   ';
  findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0, 'nothing persisted');
  assert.equal(findByClass(el, 'cora-amend-outcome-error').hidden, false);
});

test('CORAAmendOutcome: a missing outcome blocks the write and reveals an error', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-amend-outcome-select').value = '';
  findByClass(el, 'cora-amend-outcome-justification').value = 'has a reason';
  findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0);
  assert.equal(findByClass(el, 'cora-amend-outcome-error').hidden, false);
});

test('CORAAmendOutcome: a null outcome selection is treated as empty', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-amend-outcome-select').value = /** @type {any} */ (
    null
  );
  findByClass(el, 'cora-amend-outcome-justification').value = 'has a reason';
  findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0);
});

test('CORAAmendOutcome: a null justification value is treated as empty', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-amend-outcome-select').value = 'pass';
  findByClass(el, 'cora-amend-outcome-justification').value =
    /** @type {any} */ (null);
  findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0);
});

test('CORAAmendOutcome: the edit form pre-fills from an existing amendment (re-amend overwrites)', () => {
  const { el } = makeEditable({
    amendedOutcome: {
      outcome: 'refer',
      justification: 'first pass',
      amendedBy: 'controls-0',
      amendedAt: '2026-06-11T00:00:00Z',
    },
  });
  assert.equal(findByClass(el, 'cora-amend-outcome-select').value, 'refer');
  assert.equal(
    findByClass(el, 'cora-amend-outcome-justification').value,
    'first pass'
  );
});

test('CORAAmendOutcome: amending with no saveQueue or caseRow does not throw', () => {
  const el = new CORAAmendOutcome();
  el.access = 'edit';
  el.caseRow = null;
  el.saveQueue = null;
  el.currentUser = null;
  el.outcomeOptions = OUTCOME_OPTIONS;
  el.connectedCallback();
  findByClass(el, 'cora-amend-outcome-select').value = 'pass';
  findByClass(el, 'cora-amend-outcome-justification').value = 'orphan';
  assert.doesNotThrow(() => {
    findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();
  });
});

test('CORAAmendOutcome: amending with a Case row but no saveQueue still mutates the row without throwing', () => {
  const el = new CORAAmendOutcome();
  el.caseRow = makeCase();
  el.saveQueue = null;
  el.caseId = 'c1';
  el.access = 'edit';
  el.currentUser = { id: 'controls-1', displayName: 'Controls' };
  el.outcomeOptions = OUTCOME_OPTIONS;
  el.now = () => '2026-06-12T00:00:00Z';
  el.connectedCallback();

  findByClass(el, 'cora-amend-outcome-select').value = 'pass';
  findByClass(el, 'cora-amend-outcome-justification').value = 'Corrected';
  assert.doesNotThrow(() => {
    findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();
  });
  assert.equal(el.caseRow?.amendedOutcome?.outcome, 'pass');
});

test('CORAAmendOutcome: now() yields a non-empty ISO-like string by default', () => {
  assert.ok(new CORAAmendOutcome().now().length > 0);
});
