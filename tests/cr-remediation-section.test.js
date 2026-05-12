// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    /** @type {string} */
    this._tagName = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el._tagName = tag;
    return el;
  },
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };

// ===== IMPORTS (after stubs) =====
const { CRRemediationSection } = await import('../src/cr-remediation-section.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q-welcome',
    text: 'Greeted professionally?',
    category: 'Opening',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Refresh greeting training.'],
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: 'Needs identified?',
    category: 'Discovery',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Retrain agent.', 'Update script.'],
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Issue resolved?',
    responseType: 'yes-no-na',
    showWhen: { 'q-needs': { equals: 'Yes' } },
    failureCriteria: 'No',
    remediationActions: ['Escalate.'],
    deprecated: false,
  },
];

// ===== HELPERS =====

/**
 * @param {any} root
 * @param {string} cls
 * @returns {any}
 */
function findByClass(root, cls) {
  for (const c of root._children ?? []) {
    if (c.className === cls) return c;
    const nested = findByClass(c, cls);
    if (nested) return nested;
  }
  return null;
}

/**
 * @param {any} root
 * @param {string} cls
 * @returns {any[]}
 */
function findAllByClass(root, cls) {
  /** @type {any[]} */
  const out = [];
  function walk(/** @type {any} */ node) {
    for (const c of node._children ?? []) {
      if (c.className === cls) out.push(c);
      walk(c);
    }
  }
  walk(root);
  return out;
}

// ===== TESTS =====

test('CRRemediationSection: empty answers renders "No remediation required"', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {};
  el.connectedCallback();

  const empty = findByClass(el, 'cr-remediation-empty');
  assert.ok(empty);
  assert.equal(empty.textContent, 'No remediation required.');
});

test('CRRemediationSection: only passing answers renders empty state', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'Yes' } };
  el.connectedCallback();

  assert.ok(findByClass(el, 'cr-remediation-empty'));
});

test('CRRemediationSection: renders one item per failed answer with remediationActions', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {
    'q-welcome': { value: 'No' },
    'q-needs': { value: 'No' },
  };
  el.connectedCallback();

  const items = findAllByClass(el, 'cr-remediation-item');
  assert.equal(items.length, 2);
});

test('CRRemediationSection: renders question text, answer, and each remediation action', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const qText = findByClass(el, 'cr-remediation-question');
  assert.equal(qText.textContent, 'Needs identified?');

  const ansText = findByClass(el, 'cr-remediation-answer');
  assert.equal(ansText.textContent, 'Answer: No');

  const actions = findByClass(el, 'cr-remediation-actions');
  assert.equal(actions._children.length, 2);
  assert.deepEqual(
    actions._children.map((/** @type {any} */ li) => li.textContent),
    ['Retrain agent.', 'Update script.']
  );
});

test('CRRemediationSection: renders category when defined on QuestionDefinition', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const cat = findByClass(el, 'cr-remediation-category');
  assert.ok(cat);
  assert.equal(cat.textContent, 'Discovery');
});

test('CRRemediationSection: skips non-applicable failed questions', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  // q-resolve fails but is not applicable (q-needs !== Yes)
  el.answers = { 'q-needs': { value: 'No' }, 'q-resolve': { value: 'No' } };
  el.connectedCallback();

  const items = findAllByClass(el, 'cr-remediation-item');
  assert.equal(items.length, 1);
  // The single item should be q-needs, not q-resolve
  const qText = findByClass(items[0], 'cr-remediation-question');
  assert.equal(qText.textContent, 'Needs identified?');
});

test('CRRemediationSection: update() re-renders with new state', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();
  assert.equal(findAllByClass(el, 'cr-remediation-item').length, 1);

  el.update(CATALOGUE, { 'q-needs': { value: 'Yes' } });
  assert.equal(findAllByClass(el, 'cr-remediation-item').length, 0);
  assert.ok(findByClass(el, 'cr-remediation-empty'));
});

test('CRRemediationSection: multi-choice answer renders array as comma-joined', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-products',
      text: 'Products?',
      responseType: 'multi-choice',
      options: ['Account', 'Billing', 'Support'],
      failureCriteria: 'Billing',
      remediationActions: ['Refer to billing.'],
      deprecated: false,
    },
  ];
  const el = new CRRemediationSection();
  el.catalogue = cat;
  el.answers = { 'q-products': { value: ['Account', 'Billing'] } };
  el.connectedCallback();

  const ansText = findByClass(el, 'cr-remediation-answer');
  assert.equal(ansText.textContent, 'Answer: Account, Billing');
});

test('CRRemediationSection: skips failed questions without remediationActions', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q1', text: 'Q1', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
  const el = new CRRemediationSection();
  el.catalogue = cat;
  el.answers = { q1: { value: 'No' } };
  el.connectedCallback();

  assert.ok(findByClass(el, 'cr-remediation-empty'));
});

test('CRRemediationSection: _renderItem with no answer shows empty string via ?? fallback', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-missing',
    text: 'Missing answer?',
    responseType: 'yes-no-na',
    remediationActions: ['Do something'],
    deprecated: false,
  };
  const el = new CRRemediationSection();
  el.answers = {};
  const item = /** @type {any} */ (el)._renderItem(q);
  const answerEl = findByClass(item, 'cr-remediation-answer');
  assert.equal(answerEl.textContent, 'Answer: ');
});

test('CRRemediationSection: _renderItem with null remediationActions falls back to empty array', () => {
  // Exercises `q.remediationActions ?? []` when remediationActions is null
  const q = /** @type {any} */ ({
    id: 'q-null-actions',
    text: 'No actions?',
    responseType: 'yes-no-na',
    remediationActions: null,
    deprecated: false,
  });
  const el = new CRRemediationSection();
  el.answers = { 'q-null-actions': { value: 'No' } };
  const item = /** @type {any} */ (el)._renderItem(q);
  const actionsList = findByClass(item, 'cr-remediation-actions');
  assert.equal(actionsList._children.length, 0, 'null remediationActions falls back to [] → no action items');
});
