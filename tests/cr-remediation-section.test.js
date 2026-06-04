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
    /** @type {Record<string, string>} */
    this._attrs = {};
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
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach(h => h(e));
    return true;
  }
  /** @param {string} ev fire a listener as if the user triggered it */
  _fire(/** @type {string} */ ev, /** @type {any} */ payload) {
    (this._listeners[ev] ?? []).forEach(h => h(payload));
  }
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
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
(/** @type {any} */ (globalThis)).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs) =====
const { CRRemediationSection } = await import('../src/components/cr-remediation-section.js');

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

/**
 * @param {any} root
 * @param {string} tag
 * @returns {any}
 */
function findByTag(root, tag) {
  for (const c of root._children ?? []) {
    if (c._tagName === tag) return c;
    const nested = findByTag(c, tag);
    if (nested) return nested;
  }
  return null;
}

// ===== TESTS =====

test('CRRemediationSection: empty answers renders "No failures"', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {};
  el.connectedCallback();

  const empty = findByClass(el, 'cr-remediation-empty');
  assert.ok(empty);
  assert.equal(empty.textContent, 'No failures.');
});

test('CRRemediationSection: only passing answers renders empty state', () => {
  const el = new CRRemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'Yes' } };
  el.connectedCallback();

  assert.ok(findByClass(el, 'cr-remediation-empty'));
});

test('CRRemediationSection: lists a failed answer that has no remediationActions', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q1', text: 'No actions defined?', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
  const el = new CRRemediationSection();
  el.catalogue = cat;
  el.answers = { q1: { value: 'No' } };
  el.connectedCallback();

  const items = findAllByClass(el, 'cr-remediation-item');
  assert.equal(items.length, 1, 'a failure with zero remediation actions is still listed');
  const qText = findByClass(items[0], 'cr-remediation-question');
  assert.equal(qText.textContent, 'No actions defined?');
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

test('CRRemediationSection: failed question without remediationActions renders no actions list', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q1', text: 'Q1', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
  const el = new CRRemediationSection();
  el.catalogue = cat;
  el.answers = { q1: { value: 'No' } };
  el.connectedCallback();

  // The failure is listed (failures view), but with no remediation actions list.
  assert.equal(findAllByClass(el, 'cr-remediation-item').length, 1);
  assert.equal(findByClass(el, 'cr-remediation-actions'), null);
});

test('CRRemediationSection: renders Attributed Party displayName read-only when attributeFailures is on', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q1', text: 'Greeted?', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
  const el = new CRRemediationSection();
  el.update(cat, { q1: { value: 'No', attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' } } }, true);

  const ap = findByClass(el, 'cr-remediation-attributed-party');
  assert.ok(ap, 'attributed party surface is rendered');
  assert.equal(ap.textContent, 'Attributed to: Jane Smith');
});

test('CRRemediationSection: does not render Attributed Party when attributeFailures is off', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q1', text: 'Greeted?', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
  const el = new CRRemediationSection();
  el.update(cat, { q1: { value: 'No', attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' } } }, false);

  assert.equal(findByClass(el, 'cr-remediation-attributed-party'), null);
});

test('CRRemediationSection: no Attributed Party surface when failure has none, even with attributeFailures on', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q1', text: 'Greeted?', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
  const el = new CRRemediationSection();
  el.update(cat, { q1: { value: 'No' } }, true);

  assert.equal(findAllByClass(el, 'cr-remediation-item').length, 1);
  assert.equal(findByClass(el, 'cr-remediation-attributed-party'), null);
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

test('CRRemediationSection: _renderItem with null remediationActions renders no actions list', () => {
  // Exercises the `q.remediationActions?.length` guard when remediationActions is null
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
  assert.equal(actionsList, null, 'null remediationActions → no actions list rendered');
});

// ===== Attributed Party: editable picker (canAttribute) =====

/** @type {QuestionDefinition[]} */
const FAIL_CAT = [
  { id: 'q1', text: 'Greeted?', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
];

test('CRRemediationSection: read-only viewer (canAttribute off) shows display name, no attribute menu', () => {
  const el = new CRRemediationSection();
  el.client = /** @type {any} */ ({ async searchPeople() { return []; } });
  el.canAttribute = false;
  el.update(FAIL_CAT, { q1: { value: 'No', attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' } } }, true);

  assert.ok(findByClass(el, 'cr-remediation-attributed-party'), 'displayName still shown read-only');
  assert.equal(findByTag(el, 'cr-attribute-menu'), null, 'no editable menu when not editable');
});

test('CRRemediationSection: editable failure renders an attribute menu wired with client and responsibleParty', () => {
  const client = /** @type {any} */ ({ async searchPeople() { return []; } });
  const el = new CRRemediationSection();
  el.client = client;
  el.responsibleParty = { loginName: 'rparty', displayName: 'rparty' };
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, true);

  const menu = findByTag(el, 'cr-attribute-menu');
  assert.ok(menu, 'attribute menu rendered for an editable failure');
  assert.equal(menu.client, client, 'menu receives the SharePointClient');
  assert.equal(menu.attributedParty, null, 'unattributed failure passes null to the menu');
  assert.deepEqual(menu.responsibleParty, { loginName: 'rparty', displayName: 'rparty' }, 'menu receives the Responsible Party quick-pick');
  // The standalone read-only line is replaced by the menu's own chip.
  assert.equal(findByClass(el, 'cr-remediation-attributed-party'), null);
});

test('CRRemediationSection: editable failure with an attribution passes the party to the menu', () => {
  const el = new CRRemediationSection();
  el.client = /** @type {any} */ ({ async searchPeople() { return []; } });
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No', attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' } } }, true);

  const menu = findByTag(el, 'cr-attribute-menu');
  assert.ok(menu, 'menu rendered');
  assert.deepEqual(menu.attributedParty, { loginName: 'jsmith', displayName: 'Jane Smith' });
});

test('CRRemediationSection: editable surface is suppressed when attributeFailures is off', () => {
  const el = new CRRemediationSection();
  el.client = /** @type {any} */ ({ async searchPeople() { return []; } });
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  assert.equal(findByTag(el, 'cr-attribute-menu'), null, 'menu only appears when attributeFailures is on');
});

test('CRRemediationSection: menu cr-attribute-change re-dispatches as bubbling cr-attribute with the question id', () => {
  const el = new CRRemediationSection();
  el.client = /** @type {any} */ ({ async searchPeople() { return []; } });
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, true);

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-attribute', (/** @type {any} */ e) => events.push(e));

  const menu = findByTag(el, 'cr-attribute-menu');
  menu._fire('cr-attribute-change', { detail: { attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' } } });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q1',
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
  });
});

test('CRRemediationSection: a null cr-attribute-change re-dispatches cr-attribute clearing the party', () => {
  const el = new CRRemediationSection();
  el.client = /** @type {any} */ ({ async searchPeople() { return []; } });
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No', attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' } } }, true);

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-attribute', (/** @type {any} */ e) => events.push(e));

  findByTag(el, 'cr-attribute-menu')._fire('cr-attribute-change', { detail: { attributedParty: null } });

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, { questionId: 'q1', attributedParty: null });
});
