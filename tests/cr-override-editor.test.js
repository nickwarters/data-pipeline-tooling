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
    this.checked = false;
    this.disabled = false;
    this.attributedParty = null;
    this.responsibleParty = null;
    this.client = null;
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
  dispatchEvent(/** @type {any} */ ev) {
    for (const h of this._listeners[ev.type] ?? []) h(ev);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    /** @type {any} */ (this)._attrs ??= {};
    /** @type {any} */ (this)._attrs[k] = v;
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
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) {
    return new StubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };

const { CROverrideEditor } =
  await import('../src/components/cr-override-editor.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    status: 'Completed',
    assignedReviewer: 'rev1',
    responsibleParty: 'rp1',
    answers: { q1: { value: 'Yes' }, q2: { value: 'No' } },
    conversation: [],
    notes: '',
    completedAt: '2026-06-10T00:00:00Z',
    etag: 'e1',
    ...overrides,
  };
}

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Was the call recorded?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Re-record'],
    deprecated: false,
  },
  {
    id: 'q2',
    text: 'Was consent given?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Get consent'],
    deprecated: false,
  },
];

function makeQueue() {
  /** @type {{ id: string, field: string, value: any, fields?: any }[]} */
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
    // The Override write is a single atomic multi-field PATCH (ADR-0019). Record
    // the saved `overrides` array under `value` (so existing assertions on the
    // appended Override hold) plus the full field set under `fields`.
    enqueueFields(/** @type {string} */ id, /** @type {any} */ fields) {
      enqueued.push({
        id,
        field: 'overrides',
        value: fields.overrides,
        fields,
      });
    },
  };
}

/** @param {any} el @param {string} cls @returns {any} */
function findByClass(el, cls) {
  for (const c of el._children) {
    if (c.className === cls) return c;
    const found = findByClass(c, cls);
    if (found) return found;
  }
  return null;
}

/** @param {any} el @param {string} cls @returns {any[]} */
function findAllByClass(el, cls) {
  /** @type {any[]} */
  const out = [];
  for (const c of el._children) {
    if (c.className === cls) out.push(c);
    out.push(...findAllByClass(c, cls));
  }
  return out;
}

/**
 * Build a `cr-override-editor` wired for the QA authoring flow.
 * @param {{ caseOverrides?: any, access?: string, currentUser?: any, attributeFailures?: boolean, remediationFields?: any[], computeOutcome?: any }} [opts]
 */
function makeEditor(opts = {}) {
  const queue = makeQueue();
  const el = new CROverrideEditor();
  el.caseRow = makeCase(opts.caseOverrides);
  el.saveQueue = /** @type {any} */ (queue);
  el.caseId = 'c1';
  el.access = /** @type {any} */ (opts.access ?? 'override');
  el.currentUser = opts.currentUser ?? { id: 'qa1', displayName: 'QA One' };
  el.catalogue = /** @type {any} */ (CATALOGUE);
  el.attributeFailures = opts.attributeFailures ?? false;
  el.remediationFields = opts.remediationFields ?? [];
  // The original Case Type's outcome fn, re-run over the Effective Answers to
  // re-stamp the effective-outcome columns (ADR-0019). A failing q2 ⇒ fail.
  el.computeOutcome = /** @type {any} */ (
    opts.computeOutcome ??
      ((/** @type {Record<string, any>} */ a) => ({
        outcome: Object.values(a).some((x) => x.value === 'No')
          ? 'fail'
          : 'pass',
      }))
  );
  el.connectedCallback();
  return { el, queue };
}

/**
 * Select a question and a replacement value on the editor's form, then submit.
 * @param {any} el
 * @param {{ answerKey?: string, value?: string, reasoning?: string }} fields
 */
function author(el, { answerKey, value, reasoning }) {
  if (answerKey !== undefined) {
    const sel = findByClass(el, 'cr-override-question');
    sel.value = answerKey;
    sel._listeners['change'][0]({ target: sel });
  }
  if (value !== undefined) {
    const valEl = findByClass(el, 'cr-override-value-control');
    valEl.value = value;
    valEl._listeners['change'][0]({ target: valEl });
  }
  if (reasoning !== undefined) {
    const r = findByClass(el, 'cr-override-reasoning');
    r.value = reasoning;
    if (r._listeners['input']) {
      r._listeners['input'][0]({ target: r });
    } else {
      r._listeners['change'][0]({ target: r });
    }
  }
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();
}

// --- Access / rendering ---

test('CROverrideEditor: override access on a Completed Case renders the authoring form', () => {
  const { el } = makeEditor();
  assert.ok(findByClass(el, 'cr-override-form'), 'form rendered');
  assert.ok(
    findByClass(el, 'cr-override-question'),
    'question picker rendered'
  );
  assert.ok(
    findByClass(el, 'cr-override-reasoning'),
    'reasoning input rendered'
  );
  assert.ok(findByClass(el, 'cr-override-submit'), 'submit rendered');
});

test('CROverrideEditor: read-only access renders no authoring form', () => {
  const { el } = makeEditor({ access: 'read-only' });
  assert.equal(findByClass(el, 'cr-override-form'), null);
});

test('CROverrideEditor: existing Overrides are listed as history', () => {
  const existing = {
    source: 'qa',
    author: 'qaX',
    at: '2026-06-10T00:00:00Z',
    answerKey: 'q1',
    value: 'No',
    reasoning: 'Was actually not recorded.',
  };
  const { el } = makeEditor({
    access: 'read-only',
    caseOverrides: { overrides: [existing] },
  });
  const items = findAllByClass(el, 'cr-override-item');
  assert.equal(items.length, 1);
});

// --- Self-review guard (UX-only, ADR-0010) ---

test('CROverrideEditor: blocks authoring and warns when the author is the original Assigned Reviewer', () => {
  const { el } = makeEditor({
    currentUser: { id: 'rev1', displayName: 'Reviewer One' },
  });
  assert.ok(
    findByClass(el, 'cr-override-self-review'),
    'self-review warning shown'
  );
  assert.equal(
    findByClass(el, 'cr-override-form'),
    null,
    'no authoring form for the original reviewer'
  );
});

// --- Authoring: fail→pass ---

test('CROverrideEditor: a fail→pass Override enqueues an additive overrides save with no failure metadata', () => {
  const { el, queue } = makeEditor();
  author(el, {
    answerKey: 'q2',
    value: 'Yes',
    reasoning: 'Consent was on file.',
  });

  assert.equal(queue.enqueued.length, 1);
  assert.equal(queue.enqueued[0].field, 'overrides');
  assert.equal(queue.enqueued[0].id, 'c1');
  const saved = queue.enqueued[0].value;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].answerKey, 'q2');
  assert.equal(saved[0].value, 'Yes');
  assert.equal(saved[0].source, 'qa');
  assert.equal(saved[0].author, 'qa1');
  assert.equal(saved[0].reasoning, 'Consent was on file.');
  assert.equal(
    saved[0].remediationActions,
    undefined,
    'a pass carries no actions'
  );
  assert.equal(saved[0].attributedParty, undefined);
});

// --- Re-stamping the effective-outcome columns (ADR-0019) ---

test('CROverrideEditor: an Override re-stamps the effective-outcome columns in the same atomic write', () => {
  // Frozen Answers fail (q2 = No). A fail→pass Override flips the Current Outcome.
  const { el, queue } = makeEditor();
  author(el, {
    answerKey: 'q2',
    value: 'Yes',
    reasoning: 'Consent was on file.',
  });

  assert.equal(
    queue.enqueued.length,
    1,
    'overrides[] and the columns ride one PATCH'
  );
  const { fields } = queue.enqueued[0];
  assert.equal(
    fields.effectiveOutcome,
    'pass',
    're-derived over the Effective Answers'
  );
  assert.equal(
    fields.effectiveHadRemediation,
    false,
    'a fail→pass drops the original actions'
  );
  assert.equal(fields.outcomeOverridden, true, 'the Case is flagged corrected');
  assert.ok(
    Array.isArray(fields.overrides),
    'the appended overrides[] is in the same write'
  );
});

test('CROverrideEditor: a pass→fail Override re-stamps effectiveOutcome=fail without auto-selecting remediation', () => {
  // q1 is a passing Answer (Yes); override it to a failing No. Configured
  // Remediation Actions are available choices, not selected choices.
  const { el, queue } = makeEditor();
  author(el, {
    answerKey: 'q1',
    value: 'No',
    reasoning: 'It was not recorded after all.',
  });

  const { fields } = queue.enqueued[0];
  assert.equal(fields.effectiveOutcome, 'fail');
  assert.equal(
    fields.effectiveHadRemediation,
    false,
    'a newly-failed Answer has no selected Remediation Actions'
  );
  assert.equal(fields.outcomeOverridden, true);
});

test('CROverrideEditor: the re-stamp never touches the frozen outcomeAtCompletion snapshot', () => {
  const { el, queue } = makeEditor();
  author(el, {
    answerKey: 'q2',
    value: 'Yes',
    reasoning: 'Consent was on file.',
  });

  const { fields } = queue.enqueued[0];
  assert.ok(
    !('outcomeAtCompletion' in fields),
    'outcomeAtCompletion stays frozen (ADR-0012)'
  );
  assert.ok(!('hadRemediation' in fields), 'hadRemediation stays frozen');
});

test('CROverrideEditor: re-stamp falls back to a pass outcome when no computeOutcome is wired', () => {
  const { el, queue } = makeEditor();
  el.computeOutcome = null;
  author(el, {
    answerKey: 'q2',
    value: 'Yes',
    reasoning: 'Consent was on file.',
  });

  assert.equal(queue.enqueued[0].fields.effectiveOutcome, 'pass');
});

// --- Authoring: reasoning required ---

test('CROverrideEditor: submitting without reasoning shows an error and does not save', () => {
  const { el, queue } = makeEditor();
  author(el, { answerKey: 'q2', value: 'Yes' });
  assert.equal(queue.enqueued.length, 0, 'nothing saved');
  const err = findByClass(el, 'cr-override-error');
  assert.ok(err && err.hidden === false, 'error surfaced');
});

// --- Authoring: pass→fail gate ---

test('CROverrideEditor: a pass→fail Override is blocked until the completion gate is satisfied', () => {
  const { el, queue } = makeEditor({
    attributeFailures: true,
    remediationFields: [
      { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
    ],
  });
  // q1 was 'Yes' (pass); override to 'No' (fail) without attribution/detail.
  author(el, {
    answerKey: 'q1',
    value: 'No',
    reasoning: 'Reviewer missed it.',
  });
  assert.equal(queue.enqueued.length, 0, 'blocked by the gate');
  assert.ok(findByClass(el, 'cr-override-error'));
});

test('CROverrideEditor: a satisfied pass→fail Override saves the complete replacement set', () => {
  const { el, queue } = makeEditor({
    attributeFailures: true,
    remediationFields: [
      { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
    ],
  });
  // Choose q1 and the failing value to reveal the failure sub-form.
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'q1';
  sel._listeners['change'][0]({ target: sel });
  const valEl = findByClass(el, 'cr-override-value-control');
  valEl.value = 'No';
  valEl._listeners['change'][0]({ target: valEl });
  // Supply the required Remediation Detail.
  const detail = findByClass(el, 'cr-override-detail-rootCause');
  detail.value = 'Training gap';
  detail._listeners['change'][0]({ target: detail });
  // Supply the Attributed Party via the embedded attribute menu's event.
  const menu = findByClass(el, 'cr-override-attribute');
  menu.dispatchEvent({
    type: 'cr-attribute-change',
    detail: { attributedParty: { loginName: 'jdoe', displayName: 'J Doe' } },
  });
  // Reasoning + submit.
  const r = findByClass(el, 'cr-override-reasoning');
  r.value = 'Reviewer missed it.';
  (r._listeners['change'] || r._listeners['input'])[0]({ target: r });
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();

  assert.equal(queue.enqueued.length, 1);
  const saved = queue.enqueued[0].value[0];
  assert.equal(saved.value, 'No');
  assert.deepEqual(saved.attributedParty, {
    loginName: 'jdoe',
    displayName: 'J Doe',
  });
  assert.equal(saved.remediationDetails.rootCause, 'Training gap');
  assert.equal(
    saved.remediationActions,
    undefined,
    'no canned replacement action is selected automatically'
  );
});

test('CROverrideEditor: a select-type Remediation Detail is captured and saved', () => {
  const { el, queue } = makeEditor({
    remediationFields: [
      {
        key: 'severity',
        label: 'Severity',
        type: 'select',
        options: ['Low', 'High'],
        required: true,
      },
    ],
  });
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'q1';
  sel._listeners['change'][0]({ target: sel });
  const valEl = findByClass(el, 'cr-override-value-control');
  valEl.value = 'No';
  valEl._listeners['change'][0]({ target: valEl });
  const detail = findByClass(el, 'cr-override-detail-severity');
  detail.value = 'High';
  detail._listeners['change'][0]({ target: detail });
  const r = findByClass(el, 'cr-override-reasoning');
  r.value = 'Missed.';
  (r._listeners['change'] || r._listeners['input'])[0]({ target: r });
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();

  assert.equal(queue.enqueued[0].value[0].remediationDetails.severity, 'High');
});

test('CROverrideEditor: switching a chosen failing value back to a pass clears captured failure metadata', () => {
  const { el, queue } = makeEditor({
    attributeFailures: true,
    remediationFields: [
      { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
    ],
  });
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'q1';
  sel._listeners['change'][0]({ target: sel });
  // Fail, capture a detail, then revert to a passing value.
  let valEl = findByClass(el, 'cr-override-value-control');
  valEl.value = 'No';
  valEl._listeners['change'][0]({ target: valEl });
  const detail = findByClass(el, 'cr-override-detail-rootCause');
  detail.value = 'Training gap';
  detail._listeners['change'][0]({ target: detail });
  valEl = findByClass(el, 'cr-override-value-control');
  valEl.value = 'Yes';
  valEl._listeners['change'][0]({ target: valEl });
  // No failure sub-form is rendered now.
  assert.equal(findByClass(el, 'cr-override-detail-rootCause'), null);
  const r = findByClass(el, 'cr-override-reasoning');
  r.value = 'Actually fine.';
  (r._listeners['change'] || r._listeners['input'])[0]({ target: r });
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();

  const saved = queue.enqueued[0].value[0];
  assert.equal(saved.value, 'Yes');
  assert.equal(saved.remediationDetails, undefined);
  assert.equal(saved.attributedParty, undefined);
});

test('CROverrideEditor: clearing a captured detail (blank value) drops it from the draft', () => {
  const { el, queue } = makeEditor({
    remediationFields: [{ key: 'note', label: 'Note', type: 'text' }],
  });
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'q1';
  sel._listeners['change'][0]({ target: sel });
  const valEl = findByClass(el, 'cr-override-value-control');
  valEl.value = 'No';
  valEl._listeners['change'][0]({ target: valEl });
  const detail = findByClass(el, 'cr-override-detail-note');
  detail.value = 'temp';
  detail._listeners['change'][0]({ target: detail });
  detail.value = '';
  detail._listeners['change'][0]({ target: detail });
  const r = findByClass(el, 'cr-override-reasoning');
  r.value = 'Missed.';
  (r._listeners['change'] || r._listeners['input'])[0]({ target: r });
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();

  assert.equal(queue.enqueued[0].value[0].remediationDetails, undefined);
});

test('CROverrideEditor: read-only with no Overrides shows an empty placeholder', () => {
  const { el } = makeEditor({ access: 'read-only' });
  assert.ok(findByClass(el, 'cr-override-empty'));
});

test('CROverrideEditor: history renders the raw answerKey and an em dash when the Question/value are unknown', () => {
  const existing = {
    source: 'qa',
    author: 'qaX',
    at: 't',
    answerKey: 'gone',
    value: undefined,
    reasoning: 'why',
  };
  const { el } = makeEditor({
    access: 'read-only',
    caseOverrides: { overrides: [/** @type {any} */ (existing)] },
  });
  const item = findByClass(el, 'cr-override-item');
  const label = findByClass(item, 'cr-override-item-question');
  const value = findByClass(item, 'cr-override-item-value');
  assert.equal(label.textContent, 'gone');
  assert.equal(value.textContent, 'Corrected to: —');
});

test('CROverrideEditor: a multi-choice replacement value renders as a comma-joined history value', () => {
  const existing = {
    source: 'qa',
    author: 'qaX',
    at: 't',
    answerKey: 'q1',
    value: ['A', 'B'],
    reasoning: 'why',
  };
  const { el } = makeEditor({
    access: 'read-only',
    caseOverrides: { overrides: [/** @type {any} */ (existing)] },
  });
  const value = findByClass(el, 'cr-override-item-value');
  assert.equal(value.textContent, 'Corrected to: A, B');
});

test('CROverrideEditor: attribution selection re-renders with the chosen party retained', () => {
  const { el } = makeEditor({ attributeFailures: true });
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'q1';
  sel._listeners['change'][0]({ target: sel });
  const valEl = findByClass(el, 'cr-override-value-control');
  valEl.value = 'No';
  valEl._listeners['change'][0]({ target: valEl });
  const menu = findByClass(el, 'cr-override-attribute');
  menu.dispatchEvent({
    type: 'cr-attribute-change',
    detail: { attributedParty: { loginName: 'jdoe', displayName: 'J Doe' } },
  });
  const after = findByClass(el, 'cr-override-attribute');
  assert.deepEqual(after.attributedParty, {
    loginName: 'jdoe',
    displayName: 'J Doe',
  });
});

test('CROverrideEditor: a Case with no Responsible Party offers no quick-pick party on the attribute menu', () => {
  const { el } = makeEditor({
    attributeFailures: true,
    caseOverrides: { responsibleParty: '' },
  });
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'q1';
  sel._listeners['change'][0]({ target: sel });
  const valEl = findByClass(el, 'cr-override-value-control');
  valEl.value = 'No';
  valEl._listeners['change'][0]({ target: valEl });
  const menu = findByClass(el, 'cr-override-attribute');
  assert.equal(menu.responsibleParty, null);
});

test('CROverrideEditor: a single-choice Question draws its declared options and defaults blank when unanswered', () => {
  const { el, queue } = makeEditor({ caseOverrides: { answers: {} } });
  el.catalogue = /** @type {any} */ ([
    {
      id: 'sc',
      text: 'Channel?',
      responseType: 'single-choice',
      options: ['Phone', 'Email'],
      failureCriteria: 'Email',
      deprecated: false,
    },
  ]);
  el.connectedCallback();
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'sc';
  sel._listeners['change'][0]({ target: sel });
  const valEl = findByClass(el, 'cr-override-value-control');
  // Options come from the Question, not the yes-no-na tri-state.
  assert.deepEqual(
    valEl._children.map((/** @type {any} */ o) => o.value),
    ['', 'Phone', 'Email']
  );
  valEl.value = 'Phone';
  valEl._listeners['change'][0]({ target: valEl });
  const r = findByClass(el, 'cr-override-reasoning');
  r.value = 'Was actually phone.';
  (r._listeners['change'] || r._listeners['input'])[0]({ target: r });
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued[0].value[0].value, 'Phone');
});

test('CROverrideEditor: submitting with no Question chosen does nothing', () => {
  const { el, queue } = makeEditor();
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0);
});

test('CROverrideEditor: a choice Question and a select detail with no declared options degrade gracefully', () => {
  const { el, queue } = makeEditor({
    caseOverrides: { answers: {} },
    remediationFields: [{ key: 'cat', label: 'Category', type: 'select' }],
  });
  el.catalogue = /** @type {any} */ ([
    {
      id: 'sc2',
      text: 'Outcome?',
      responseType: 'single-choice',
      failureCriteria: 'Bad',
      deprecated: false,
    },
  ]);
  el.connectedCallback();
  const sel = findByClass(el, 'cr-override-question');
  sel.value = 'sc2';
  sel._listeners['change'][0]({ target: sel });
  const valEl = findByClass(el, 'cr-override-value-control');
  assert.deepEqual(
    valEl._children.map((/** @type {any} */ o) => o.value),
    [''],
    'empty option is offered'
  );
  valEl.value = 'Bad';
  valEl._listeners['change'][0]({ target: valEl });
  // The select detail with no options still renders (just the blank option).
  assert.ok(findByClass(el, 'cr-override-detail-cat'));
  const r = findByClass(el, 'cr-override-reasoning');
  r.value = 'Was bad.';
  (r._listeners['change'] || r._listeners['input'])[0]({ target: r });
  findByClass(el, 'cr-override-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued[0].value[0].value, 'Bad');
});

test('CROverrideEditor: a missing current user authors with an empty author stamp rather than throwing', () => {
  const { el, queue } = makeEditor();
  el.currentUser = null;
  el.connectedCallback();
  author(el, { answerKey: 'q2', value: 'Yes', reasoning: 'Fine.' });
  assert.equal(queue.enqueued[0].value[0].author, '');
});

// --- Provenance wiring ---

test('CROverrideEditor: stamps sourceCaseId when authored from a QA Check surface', () => {
  const { el, queue } = makeEditor();
  el.sourceCaseId = 'qa-example-review-7';
  el.connectedCallback();
  author(el, { answerKey: 'q2', value: 'Yes', reasoning: 'Fine.' });
  assert.equal(queue.enqueued[0].value[0].sourceCaseId, 'qa-example-review-7');
});
