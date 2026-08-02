// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import.

const { AppealReviewSection } =
  await import('../src/pages/cora-case-review/appeal-review-view.js');
const { resolveAppeal } =
  await import('../src/pages/cora-case-review/appeal-actions.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').Appeal} Appeal */

/** @param {Partial<CaseRow>} [overrides] @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    status: 'Completed',
    assignedReviewer: 'u-reviewer',
    responsibleParty: 'u-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: '2026-06-10T00:00:00Z',
    outcomeAtCompletion: 'fail',
    etag: 'e1',
    ...overrides,
  };
}

/** @returns {Appeal} */
function openAppeal() {
  return {
    id: 'ap1',
    appellant: 'u-rp',
    at: '2026-06-10T00:00:00Z',
    rationale: 'The outcome was wrong.',
    state: 'raised',
  };
}

/** @returns {Appeal} */
function resolvedAppeal() {
  return {
    ...openAppeal(),
    state: 'resolved',
    resolution: {
      verdict: 'agreed',
      rationale: 'Agreed, outcome was wrong.',
      resolver: 'u-controls',
      at: '2026-06-11T00:00:00Z',
    },
  };
}

function makeQueue() {
  /** @type {any[]} */
  const enqueued = [];
  /** @type {any[]} */
  const enqueuedFields = [];
  return {
    enqueued,
    enqueuedFields,
    enqueue(
      /** @type {string} */ id,
      /** @type {string} */ field,
      /** @type {any} */ value
    ) {
      enqueued.push({ id, field, value });
    },
    enqueueFields(/** @type {string} */ id, /** @type {any} */ fields) {
      enqueuedFields.push({ id, fields });
    },
  };
}

/** Render the shipped view directly into a DOM query root. */
function renderAppealReview(overrides = {}, queue = makeQueue()) {
  const props = {
    heading: 'Appeal Review',
    caseRow: /** @type {CaseRow | null} */ (null),
    access: /** @type {'edit'|'read-only'|'hidden'} */ ('read-only'),
    outcomeOptions: /** @type {any[]} */ ([]),
    ...overrides,
  };
  const el = document.createElement('main');
  const render = () => {
    el.replaceChildren(
      ...AppealReviewSection({
        ...props,
        onResolve: (resolution) => {
          if (!props.caseRow) return;
          const result = resolveAppeal({
            caseRow: props.caseRow,
            resolver: 'u-controls',
            at: '2026-06-12T00:00:00Z',
            ...resolution,
          });
          props.caseRow = result.caseRow;
          if (result.transactional) {
            queue.enqueueFields('c1', result.fields);
          } else {
            queue.enqueue('c1', 'appeals', result.fields.appeals);
          }
          render();
        },
      })
    );
  };
  render();
  return { el, props, queue, render };
}

function makeEditable(caseOverrides = {}) {
  return renderAppealReview({
    caseRow: makeCase({ appeals: [openAppeal()], ...caseOverrides }),
    access: 'edit',
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
  });
}

/** Submit the resolve form by clicking the submit button. */
function clickSubmit(/** @type {any} */ el) {
  findByClass(el, 'cora-appeal-review-submit')._listeners['click'][0]();
}

// --- Rendering ---

test('CORAAppealReview: renders an Appeal Review heading first', () => {
  const { el } = renderAppealReview();
  assert.equal(
    /** @type {any} */ (el)._children[0].textContent,
    'Appeal Review'
  );
});

test('CORAAppealReview: edit access with an open Appeal renders the resolve form', () => {
  const { el } = makeEditable();
  assert.ok(findByClass(el, 'cora-appeal-review-form'), 'resolve form present');
  assert.ok(
    findByClass(el, 'cora-appeal-review-verdict-agreed'),
    'agree radio'
  );
  assert.ok(
    findByClass(el, 'cora-appeal-review-verdict-rejected'),
    'reject radio'
  );
  assert.ok(
    findByClass(el, 'cora-appeal-review-rationale-input'),
    'rationale textarea'
  );
  assert.ok(
    findByClass(el, 'cora-appeal-review-outcome-select'),
    'outcome select'
  );
  assert.ok(
    findByClass(el, 'cora-appeal-review-amend-justification'),
    'amendment justification'
  );
  assert.ok(findByClass(el, 'cora-appeal-review-submit'), 'submit button');
});

test('CORAAppealReview: edit access with no open Appeal shows no form', () => {
  const { el } = renderAppealReview({
    caseRow: makeCase({ appeals: [resolvedAppeal()] }),
    access: 'edit',
  });
  assert.equal(
    findByClass(el, 'cora-appeal-review-form'),
    null,
    'no form when all resolved'
  );
});

test('CORAAppealReview: read-only access shows no form', () => {
  const { el } = renderAppealReview({
    caseRow: makeCase({ appeals: [openAppeal()] }),
  });
  assert.equal(
    findByClass(el, 'cora-appeal-review-form'),
    null,
    'no form for read-only'
  );
});

test('CORAAppealReview: with no Appeals shows a placeholder', () => {
  const { el } = renderAppealReview();
  assert.ok(findByClass(el, 'cora-empty cora-appeal-review-empty'));
});

test('CORAAppealReview: caseRow without an appeals property is treated as having no Appeals', () => {
  const { el } = renderAppealReview({
    caseRow: /** @type {any} */ ({
      id: 'c1',
      status: 'Completed',
      assignedReviewer: 'u1',
      responsibleParty: 'u-rp',
      etag: 'e1',
    }),
  });
  assert.ok(
    findByClass(el, 'cora-empty cora-appeal-review-empty'),
    'placeholder shown when appeals is missing'
  );
});

test('CORAAppealReview: with no caseRow shows an empty placeholder', () => {
  const { el } = renderAppealReview({ access: 'edit' });
  assert.ok(findByClass(el, 'cora-empty cora-appeal-review-empty'));
});

// --- Appeal summary items ---

test('CORAAppealReview: each Appeal renders a summary item with state and rationale', () => {
  const { el } = renderAppealReview({
    caseRow: makeCase({ appeals: [openAppeal()] }),
  });
  const item = findByClass(el, 'cora-appeal-review-item');
  assert.ok(item, 'item rendered');
  assert.ok(
    findByClass(item, 'cora-appeal-review-state').textContent.includes('raised')
  );
  assert.ok(
    findByClass(item, 'cora-appeal-review-rationale').textContent.includes(
      'The outcome was wrong.'
    )
  );
});

test('CORAAppealReview: a resolved Appeal item shows the resolution verdict and rationale', () => {
  const { el } = renderAppealReview({
    caseRow: makeCase({ appeals: [resolvedAppeal()] }),
  });
  const item = findByClass(el, 'cora-appeal-review-item');
  const res = findByClass(item, 'cora-appeal-review-resolution');
  assert.ok(res.textContent.includes('agreed'));
  assert.ok(res.textContent.includes('Agreed, outcome was wrong.'));
});

test('CORAAppealReview: an unresolved Appeal item omits the resolution line', () => {
  const { el } = renderAppealReview({
    caseRow: makeCase({ appeals: [openAppeal()] }),
  });
  const item = findByClass(el, 'cora-appeal-review-item');
  assert.equal(findByClass(item, 'cora-appeal-review-resolution'), null);
});

test('CORAAppealReview: multiple Appeals each render their own summary item', () => {
  const { el } = renderAppealReview({
    caseRow: makeCase({ appeals: [resolvedAppeal(), openAppeal()] }),
  });
  assert.equal(findAllByClass(el, 'cora-appeal-review-item').length, 2);
});

// --- Validation ---

test('CORAAppealReview: submitting without a verdict or rationale shows error, does not save', () => {
  const { el, queue } = makeEditable();
  clickSubmit(el);
  assert.equal(queue.enqueued.length, 0, 'nothing saved');
  assert.equal(queue.enqueuedFields.length, 0, 'no field write');
  assert.equal(
    findByClass(el, 'cora-appeal-review-error').hidden,
    false,
    'error visible'
  );
});

test('CORAAppealReview: submitting with verdict but no rationale shows error and does not save', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  clickSubmit(el);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(findByClass(el, 'cora-appeal-review-error').hidden, false);
});

test('CORAAppealReview: agreeing without outcome or justification shows error and does not save', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'This outcome was incorrect.';
  // outcome and justification left empty → should fail
  clickSubmit(el);
  assert.equal(
    queue.enqueuedFields.length,
    0,
    'no field write when outcome missing'
  );
  assert.equal(findByClass(el, 'cora-appeal-review-error').hidden, false);
});

test('CORAAppealReview: agreeing without justification (but with outcome) shows error', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'Valid rationale';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  // justification left empty
  clickSubmit(el);
  assert.equal(queue.enqueuedFields.length, 0);
});

// --- Reject flow ---

test('CORAAppealReview: reject resolves the appeal with rejected verdict and saves only appeals', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'Outcome was correct.';
  clickSubmit(el);

  assert.equal(queue.enqueued.length, 1, 'one enqueue call');
  assert.equal(queue.enqueued[0].id, 'c1');
  assert.equal(queue.enqueued[0].field, 'appeals');
  const saved = queue.enqueued[0].value;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].state, 'resolved');
  assert.equal(saved[0].resolution.verdict, 'rejected');
  assert.equal(saved[0].resolution.rationale, 'Outcome was correct.');
  assert.equal(queue.enqueuedFields.length, 0, 'no amendment on reject');
});

test('CORAAppealReview: reject does not create an Amended Outcome', () => {
  const { el, props } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'No change needed.';
  clickSubmit(el);
  assert.equal(
    props.caseRow?.amendedOutcome,
    undefined,
    'no amendment authored'
  );
});

test('CORAAppealReview: after rejecting, the form is replaced by the resolved item (re-render)', () => {
  const { el } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value = 'No change.';
  clickSubmit(el);
  assert.equal(
    findByClass(el, 'cora-appeal-review-form'),
    null,
    'form removed'
  );
  assert.ok(findByClass(el, 'cora-appeal-review-item'), 'resolved item shown');
});

test('CORAAppealReview: reject stamps resolver id and timestamp on the resolution', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value = 'No change.';
  clickSubmit(el);
  const saved = queue.enqueued[0].value[0];
  assert.equal(saved.resolution.resolver, 'u-controls');
  assert.ok(saved.resolution.at, 'timestamp stamped');
});

// --- Agree flow ---

test('CORAAppealReview: agree resolves the appeal and writes amendment fields in one enqueueFields call', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'Outcome was wrong.';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  findByClass(el, 'cora-appeal-review-amend-justification').value =
    'Reviewer mis-assessed.';
  clickSubmit(el);

  assert.equal(queue.enqueued.length, 0, 'no separate enqueue call on agree');
  assert.equal(queue.enqueuedFields.length, 1, 'one enqueueFields call');
  const { id, fields } = queue.enqueuedFields[0];
  assert.equal(id, 'c1');
  assert.ok(Array.isArray(fields.appeals), 'appeals included in fields write');
  assert.equal(fields.appeals[0].state, 'resolved');
  assert.equal(fields.appeals[0].resolution.verdict, 'agreed');
  assert.ok(fields.amendedOutcome, 'amendedOutcome authored');
  assert.equal(fields.amendedOutcome.outcome, 'pass');
  assert.equal(fields.amendedOutcome.justification, 'Reviewer mis-assessed.');
  assert.equal(fields.amendedOutcome.amendedBy, 'u-controls');
});

test('CORAAppealReview: agree links the Amended Outcome to the Appeal id via fromAppealId', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'Yes, outcome wrong.';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  findByClass(el, 'cora-appeal-review-amend-justification').value =
    'Correction needed.';
  clickSubmit(el);

  const { fields } = queue.enqueuedFields[0];
  assert.equal(
    fields.amendedOutcome.fromAppealId,
    'ap1',
    'fromAppealId links the appeal'
  );
});

test('CORAAppealReview: agree also updates caseRow.amendedOutcome in memory', () => {
  const { el, props } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'Wrong outcome.';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  findByClass(el, 'cora-appeal-review-amend-justification').value =
    'Correction.';
  clickSubmit(el);

  assert.equal(props.caseRow?.amendedOutcome?.outcome, 'pass');
  assert.equal(props.caseRow?.amendedOutcome?.fromAppealId, 'ap1');
});

test('CORAAppealReview: agree stamps the effectiveOutcome and outcomeOverridden on caseRow', () => {
  const { el, props } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value = 'Wrong.';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  findByClass(el, 'cora-appeal-review-amend-justification').value = 'Amended.';
  clickSubmit(el);

  assert.equal(props.caseRow?.effectiveOutcome, 'pass');
  assert.equal(props.caseRow?.outcomeOverridden, true);
});

test('CORAAppealReview: after agreeing, the form is replaced by the resolved item (re-render)', () => {
  const { el } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value = 'Wrong.';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  findByClass(el, 'cora-appeal-review-amend-justification').value = 'Amended.';
  clickSubmit(el);

  assert.equal(
    findByClass(el, 'cora-appeal-review-form'),
    null,
    'form removed after resolve'
  );
});

// --- One open appeal at a time ---

test('CORAAppealReview: prior resolved Appeals are retained in the appeals array (full history)', () => {
  const prior = resolvedAppeal();
  const { el, queue } = makeEditable({ appeals: [prior, openAppeal()] });
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value = 'No change.';
  clickSubmit(el);

  const saved = queue.enqueued[0].value;
  assert.equal(saved.length, 2, 'both appeals retained');
  assert.equal(saved[0].id, prior.id, 'prior appeal unchanged');
  assert.equal(saved[1].state, 'resolved', 'new appeal resolved');
});

// --- Missing dependencies (null guards) ---

test('CORAAppealReview: resolving without a saveQueue or caseRow does not throw', () => {
  const { el } = renderAppealReview({
    access: 'edit',
    caseRow: makeCase({ appeals: [openAppeal()] }),
  });
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value = 'No change.';
  assert.doesNotThrow(() => clickSubmit(el));
});

test('CORAAppealReview: agreeing without caseRow does not throw', () => {
  const { el } = renderAppealReview({
    access: 'edit',
    caseRow: makeCase({ appeals: [openAppeal()] }),
    outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  });
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value = 'Wrong.';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  findByClass(el, 'cora-appeal-review-amend-justification').value = 'Amended.';
  assert.doesNotThrow(() => clickSubmit(el));
});

test('CORAAppealReview: a null rationale value is treated as empty (does not save)', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-rejected').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    /** @type {any} */ (null);
  clickSubmit(el);
  assert.equal(
    queue.enqueued.length,
    0,
    'null rationale treated as empty → validation fails'
  );
});

test('CORAAppealReview: null outcome value on agree treated as empty (validation fails)', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'Good rationale';
  findByClass(el, 'cora-appeal-review-outcome-select').value =
    /** @type {any} */ (null);
  findByClass(el, 'cora-appeal-review-amend-justification').value =
    'Justification text';
  clickSubmit(el);
  assert.equal(
    queue.enqueuedFields.length,
    0,
    'null outcome treated as empty → validation fails'
  );
});

test('CORAAppealReview: null justification value on agree treated as empty (validation fails)', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-review-verdict-agreed').checked = true;
  findByClass(el, 'cora-appeal-review-rationale-input').value =
    'Good rationale';
  findByClass(el, 'cora-appeal-review-outcome-select').value = 'pass';
  findByClass(el, 'cora-appeal-review-amend-justification').value =
    /** @type {any} */ (null);
  clickSubmit(el);
  assert.equal(
    queue.enqueuedFields.length,
    0,
    'null justification treated as empty → validation fails'
  );
});
