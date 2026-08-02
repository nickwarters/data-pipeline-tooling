// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();

// DOM stubs must be in place before any src import.

const { AmendOutcomeSection } =
  await import('../src/pages/cora-case-review/amend-outcome-view.js');
const { amendOutcome } =
  await import('../src/pages/cora-case-review/appeal-actions.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    status: 'Completed',
    assignedReviewer: 'u1',
    responsibleParty: 'u-rp',
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

/** Render the shipped view directly into a DOM query root. */
function renderAmendOutcome(overrides = {}, queue = makeQueue()) {
  const props = {
    heading: 'Amend Outcome',
    caseRow: /** @type {CaseRow | null} */ (null),
    access: /** @type {'edit'|'read-only'|'hidden'} */ ('read-only'),
    outcomeOptions: /** @type {any[]} */ ([]),
    ...overrides,
  };
  const el = document.createElement('main');
  const render = () => {
    el.replaceChildren(
      ...AmendOutcomeSection({
        ...props,
        onAmend: ({ outcome, justification }) => {
          if (!props.caseRow) return;
          const result = amendOutcome({
            caseRow: props.caseRow,
            outcome,
            justification,
            amendedBy: 'controls-1',
            amendedAt: '2026-06-12T00:00:00Z',
          });
          props.caseRow = result.caseRow;
          queue.enqueueFields('c1', result.fields);
          render();
        },
      })
    );
  };
  render();
  return { el, props, queue, render };
}

function makeEditable(caseOverrides = {}) {
  return renderAmendOutcome({
    caseRow: makeCase(caseOverrides),
    access: 'edit',
    outcomeOptions: OUTCOME_OPTIONS,
  });
}

// --- Rendering ---

test('CORAAmendOutcome: renders an Amend Outcome heading first', () => {
  const { el } = renderAmendOutcome();
  assert.equal(
    /** @type {any} */ (el)._children[0].textContent,
    'Amend Outcome'
  );
});

test('CORAAmendOutcome: shows the Current Outcome (the frozen snapshot) with configured wording', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase({ outcomeAtCompletion: 'fail' }),
    outcomeOptions: OUTCOME_OPTIONS,
  });
  const current = findByClass(el, 'cora-amend-outcome-current');
  assert.ok(
    current.textContent.includes('Fail'),
    'renders the outcome wording'
  );
});

test('CORAAmendOutcome: Current Outcome falls back to an em dash before a snapshot exists', () => {
  const c = makeCase({ status: 'In-progress' });
  delete (/** @type {any} */ (c).outcomeAtCompletion);
  const { el } = renderAmendOutcome({ caseRow: c });
  assert.ok(
    findByClass(el, 'cora-amend-outcome-current').textContent.includes('—')
  );
});

test('CORAAmendOutcome: Current Outcome shows the amended value once amended', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase({
      outcomeAtCompletion: 'fail',
      amendedOutcome: {
        outcome: 'pass',
        justification: 'ok',
        amendedBy: 'controls-1',
        amendedAt: '2026-06-12T00:00:00Z',
      },
    }),
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.ok(
    findByClass(el, 'cora-amend-outcome-current').textContent.includes('Pass'),
    'the amended Outcome is in force'
  );
});

test('CORAAmendOutcome: Current Outcome falls back to the raw value when no option wording matches', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase({ outcomeAtCompletion: 'fail' }),
  });
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
  const { el } = renderAmendOutcome({ caseRow: makeCase() });
  assert.equal(findByClass(el, 'cora-amend-outcome-form'), null, 'no form');
  assert.ok(
    findByClass(el, 'cora-empty cora-amend-outcome-empty'),
    'placeholder shown'
  );
});

test('CORAAmendOutcome: read-only access with no Case row shows the empty placeholder', () => {
  const { el } = renderAmendOutcome();
  assert.ok(findByClass(el, 'cora-empty cora-amend-outcome-empty'));
});

test('CORAAmendOutcome: read-only access renders the existing amendment record', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase({
      amendedOutcome: {
        outcome: 'pass',
        justification: 'Reviewer misread the transcript.',
        amendedBy: 'controls-1',
        amendedAt: '2026-06-12T00:00:00Z',
      },
    }),
    outcomeOptions: OUTCOME_OPTIONS,
  });
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
  const { el, props } = makeEditable();
  findByClass(el, 'cora-amend-outcome-select').value = 'refer';
  findByClass(el, 'cora-amend-outcome-justification').value = 'Borderline';
  findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();

  assert.equal(props.caseRow?.amendedOutcome?.outcome, 'refer');
  assert.equal(props.caseRow?.effectiveOutcome, 'refer');
  assert.equal(props.caseRow?.outcomeOverridden, true);
  assert.equal(
    props.caseRow?.outcomeAtCompletion,
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

test('CORAAmendOutcome: amending with no Case row does not throw', () => {
  const { el } = renderAmendOutcome({
    access: 'edit',
    outcomeOptions: OUTCOME_OPTIONS,
  });
  findByClass(el, 'cora-amend-outcome-select').value = 'pass';
  findByClass(el, 'cora-amend-outcome-justification').value = 'orphan';
  assert.doesNotThrow(() => {
    findByClass(el, 'cora-amend-outcome-submit')._listeners['click'][0]();
  });
});
