// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, walk } from './_dom-stub.js';
import { makeCaseRow } from './helpers/fixtures.js';
import { fireEvent, getByRole, queryAllByTag } from './helpers/semantic-dom.js';

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

const REASONS = [
  { key: 'qa-check', label: 'QA Check' },
  { key: 'tm-check', label: 'TM Check' },
  { key: 'appeal', label: 'Appeal' },
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
    reasons: /** @type {any[]} */ (REASONS),
    ...overrides,
  };
  const el = document.createElement('main');
  const render = () => {
    el.replaceChildren(
      ...AmendOutcomeSection({
        ...props,
        onAmend: ({ outcome, reason, justification }) => {
          if (!props.caseRow) return;
          const result = amendOutcome({
            caseRow: props.caseRow,
            outcome,
            reason,
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
  assert.ok(
    getByRole(el, 'combobox', { name: 'Amended outcome' }),
    'outcome select'
  );
  assert.ok(
    getByRole(el, 'textbox', { name: 'Amendment justification' }),
    'justification input'
  );
  assert.ok(
    getByRole(el, 'button', { name: 'Amend Outcome' }),
    'submit button'
  );
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
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = 'appeal';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    '  Corrected after appeal.  ';
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');

  assert.equal(queue.enqueued.length, 1, 'a single ETag-guarded write');
  assert.equal(queue.enqueued[0].id, 'c1');
  const fields = queue.enqueued[0].fields;
  assert.deepEqual(fields, {
    amendedOutcome: {
      outcome: 'pass',
      reason: 'appeal',
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
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = 'refer';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = 'tm-check';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    'Borderline';
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');

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
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = 'qa-check';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value = '   ';
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');
  assert.equal(queue.enqueued.length, 0, 'nothing persisted');
  assert.equal(findByClass(el, 'cora-amend-outcome-error').hidden, false);
});

test('CORAAmendOutcome: a missing outcome blocks the write and reveals an error', () => {
  const { el, queue } = makeEditable();
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = '';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = 'qa-check';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    'has a reason';
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');
  assert.equal(queue.enqueued.length, 0);
  assert.equal(findByClass(el, 'cora-amend-outcome-error').hidden, false);
});

test('CORAAmendOutcome: a null outcome selection is treated as empty', () => {
  const { el, queue } = makeEditable();
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value =
    /** @type {any} */ (null);
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = 'qa-check';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    'has a reason';
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');
  assert.equal(queue.enqueued.length, 0);
});

test('CORAAmendOutcome: a null justification value is treated as empty', () => {
  const { el, queue } = makeEditable();
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = 'qa-check';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    /** @type {any} */ (null);
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');
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
  assert.equal(
    getByRole(el, 'combobox', { name: 'Amended outcome' }).value,
    'refer'
  );
  assert.equal(
    getByRole(el, 'textbox', { name: 'Amendment justification' }).value,
    'first pass'
  );
});

test('CORAAmendOutcome: amending with no Case row does not throw', () => {
  const { el } = renderAmendOutcome({
    access: 'edit',
    outcomeOptions: OUTCOME_OPTIONS,
  });
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = 'qa-check';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    'orphan';
  assert.doesNotThrow(() => {
    fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');
  });
});

// --- Reason ---

test('CORAAmendOutcome: the form offers the Case Type reasons', () => {
  const { el } = makeEditable();
  const reason = getByRole(el, 'combobox', { name: 'Amendment reason' });
  assert.ok(reason, 'reason select rendered');
  assert.deepEqual(
    queryAllByTag(reason, 'option').map((option) => option.value),
    ['', 'qa-check', 'tm-check', 'appeal']
  );
  assert.deepEqual(
    queryAllByTag(reason, 'option').map((option) => option.textContent),
    ['Select a reason…', 'QA Check', 'TM Check', 'Appeal']
  );
});

test('CORAAmendOutcome: a Case Type extension is offered after the shared reasons', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase(),
    access: 'edit',
    outcomeOptions: OUTCOME_OPTIONS,
    reasons: [...REASONS, { key: 'data-correction', label: 'Data correction' }],
  });
  assert.deepEqual(
    queryAllByTag(
      getByRole(el, 'combobox', { name: 'Amendment reason' }),
      'option'
    ).map((option) => option.value),
    ['', 'qa-check', 'tm-check', 'appeal', 'data-correction']
  );
});

test('CORAAmendOutcome: the justification box is labelled Justification', () => {
  const { el } = makeEditable();
  const form = findByClass(el, 'cora-amend-outcome-form');
  /** @type {string[]} */
  const labels = [];
  walk(form, (/** @type {any} */ n) => {
    if (n.tagName === 'LABEL') labels.push(n.textContent);
  });
  assert.deepEqual(labels, ['New Outcome', 'Reason', 'Justification']);
});

test('CORAAmendOutcome: a missing reason blocks the write and reveals an error', () => {
  const { el, queue } = makeEditable();
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value = '';
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    'Corrected';
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');
  assert.equal(queue.enqueued.length, 0, 'nothing persisted');
  assert.equal(findByClass(el, 'cora-amend-outcome-error').hidden, false);
});

test('CORAAmendOutcome: a null reason value is treated as empty', () => {
  const { el, queue } = makeEditable();
  getByRole(el, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(el, 'combobox', { name: 'Amendment reason' }).value =
    /** @type {any} */ (null);
  getByRole(el, 'textbox', { name: 'Amendment justification' }).value =
    'Corrected';
  fireEvent(getByRole(el, 'button', { name: 'Amend Outcome' }), 'click');
  assert.equal(queue.enqueued.length, 0);
});

test('CORAAmendOutcome: the edit form pre-fills the reason from an existing amendment', () => {
  const { el } = makeEditable({
    amendedOutcome: {
      outcome: 'refer',
      reason: 'tm-check',
      justification: 'first pass',
      amendedBy: 'controls-0',
      amendedAt: '2026-06-11T00:00:00Z',
    },
  });
  assert.equal(
    getByRole(el, 'combobox', { name: 'Amendment reason' }).value,
    'tm-check'
  );
});

test('CORAAmendOutcome: the record names the reason by its label', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase({
      amendedOutcome: {
        outcome: 'pass',
        reason: 'qa-check',
        justification: 'Reviewer misread the transcript.',
        amendedBy: 'controls-1',
        amendedAt: '2026-06-12T00:00:00Z',
      },
    }),
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.equal(
    findByClass(el, 'cora-amend-outcome-record-reason').textContent,
    'Reason: QA Check'
  );
});

test('CORAAmendOutcome: the record labels a reason this Case Type declared, not just the shared three', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase({
      amendedOutcome: {
        outcome: 'pass',
        reason: 'data-correction',
        justification: 'Wrong policy number.',
        amendedBy: 'controls-1',
        amendedAt: '2026-06-12T00:00:00Z',
      },
    }),
    outcomeOptions: OUTCOME_OPTIONS,
    reasons: [...REASONS, { key: 'data-correction', label: 'Data correction' }],
  });
  assert.equal(
    findByClass(el, 'cora-amend-outcome-record-reason').textContent,
    'Reason: Data correction'
  );
});

test('CORAAmendOutcome: a reason the Case Type no longer offers renders as its raw key', () => {
  const { el } = renderAmendOutcome({
    caseRow: makeCase({
      amendedOutcome: {
        outcome: 'pass',
        reason: 'retired-reason',
        justification: 'Wrong policy number.',
        amendedBy: 'controls-1',
        amendedAt: '2026-06-12T00:00:00Z',
      },
    }),
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.equal(
    findByClass(el, 'cora-amend-outcome-record-reason').textContent,
    'Reason: retired-reason'
  );
});

test('CORAAmendOutcome: an amendment authored before reasons existed renders without a reason line', () => {
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
  assert.equal(
    findByClass(el, 'cora-amend-outcome-record-reason'),
    null,
    'no empty reason line'
  );
  const record = findByClass(el, 'cora-amend-outcome-record');
  assert.equal(
    findByClass(record, 'cora-amend-outcome-record-justification').textContent,
    'Reviewer misread the transcript.'
  );
  assert.ok(
    findByClass(record, 'cora-amend-outcome-record-audit').textContent.includes(
      'controls-1'
    ),
    'the audit line still renders'
  );
});
