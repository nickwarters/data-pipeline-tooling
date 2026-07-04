// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass } from './_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { CORARemediationSection } =
  await import('../src/components/cora-remediation-section.js');

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

test('CORARemediationSection: empty answers renders "No failures"', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {};
  el.connectedCallback();

  const empty = findByClass(el, 'cora-remediation-empty');
  assert.ok(empty);
  assert.equal(empty.textContent, 'No failures.');
});

test('CORARemediationSection: only passing answers renders empty state', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'Yes' } };
  el.connectedCallback();

  assert.ok(findByClass(el, 'cora-remediation-empty'));
});

test('CORARemediationSection: lists a failed answer that has no remediationActions', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'No actions defined?',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.catalogue = cat;
  el.answers = { q1: { value: 'No' } };
  el.connectedCallback();

  const items = findAllByClass(el, 'cora-remediation-item');
  assert.equal(
    items.length,
    1,
    'a failure with zero remediation actions is still listed'
  );
  const qText = findByClass(items[0], 'cora-remediation-question');
  assert.equal(qText.textContent, 'No actions defined?');
});

test('CORARemediationSection: renders one item per failed answer with remediationActions', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {
    'q-welcome': { value: 'No' },
    'q-needs': { value: 'No' },
  };
  el.connectedCallback();

  const items = findAllByClass(el, 'cora-remediation-item');
  assert.equal(items.length, 2);
});

test('CORARemediationSection: renders question text and answer for a failed item', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const qText = findByClass(el, 'cora-remediation-question');
  assert.equal(qText.textContent, 'Needs identified?');

  const ansText = findByClass(el, 'cora-remediation-answer');
  assert.equal(ansText.textContent, 'Answer: No');
});

test('CORARemediationSection: read-only viewer shows only the selected remediation actions as text', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = false;
  // Only the second configured action (q-needs-ra-1) is selected on the Answer.
  el.answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [
        { id: 'q-needs-ra-1', text: 'Update script.', completed: false },
      ],
    },
  };
  el.connectedCallback();

  const actions = findByClass(el, 'cora-remediation-actions');
  assert.equal(
    actions._children.length,
    1,
    'only the selected action is shown'
  );
  assert.equal(actions._children[0].textContent, 'Update script.');
  assert.equal(
    findByClass(el, 'cora-remediation-action-checkbox'),
    null,
    'read-only viewer sees no checkboxes'
  );
});

test('CORARemediationSection: read-only viewer with no selected actions shows no actions list', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = false;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-actions'), null);
});

test('CORARemediationSection: editable viewer renders an unticked checkbox per configured action', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const boxes = findAllByClass(el, 'cora-remediation-action-checkbox');
  assert.equal(boxes.length, 2, 'one checkbox per configured action');
  assert.deepEqual(
    boxes.map((/** @type {any} */ b) => b.checked),
    [false, false],
    'actions default to unticked (not pre-applied)'
  );
});

test('CORARemediationSection: editable viewer pre-ticks actions already selected on the Answer', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [
        { id: 'q-needs-ra-1', text: 'Update script.', completed: false },
      ],
    },
  };
  el.connectedCallback();

  const boxes = findAllByClass(el, 'cora-remediation-action-checkbox');
  assert.deepEqual(
    boxes.map((/** @type {any} */ b) => b.checked),
    [false, true],
    'the selected action (q-needs-ra-1) is ticked'
  );
});

test('CORARemediationSection: ticking an action dispatches a bubbling cora-remediation-action', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-action', (/** @type {any} */ e) =>
    events.push(e)
  );

  const box = findAllByClass(el, 'cora-remediation-action-checkbox')[0];
  box.checked = true;
  box._fire('change', { target: box });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-needs',
    action: { id: 'q-needs-ra-0', text: 'Retrain agent.' },
    selected: true,
  });
});

test('CORARemediationSection: unticking a selected action dispatches selected:false', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [
        { id: 'q-needs-ra-0', text: 'Retrain agent.', completed: false },
      ],
    },
  };
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-action', (/** @type {any} */ e) =>
    events.push(e)
  );

  const box = findAllByClass(el, 'cora-remediation-action-checkbox')[0];
  box.checked = false;
  box._fire('change', { target: box });

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-needs',
    action: { id: 'q-needs-ra-0', text: 'Retrain agent.' },
    selected: false,
  });
});

// ===== Free-form remediation (issue #250) =====

/** @type {QuestionDefinition[]} */
const FREEFORM_CAT = [
  {
    id: 'q-free',
    text: 'Followed process?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Retrain agent.'],
    allowFreeFormRemediation: true,
    deprecated: false,
  },
];

test('CORARemediationSection: no free-form input unless allowFreeFormRemediation is set', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.canSelectRemediation = true;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-freeform-input'), null);
});

test('CORARemediationSection: editable viewer renders a free-form input when the question allows it', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = true;
  el.answers = {
    'q-free': { value: 'No', freeFormRemediation: 'Escalate to legal' },
  };
  el.connectedCallback();

  const input = findByClass(el, 'cora-remediation-freeform-input');
  assert.ok(input, 'free-form input rendered');
  assert.equal(
    input.value,
    'Escalate to legal',
    'pre-filled with the stored value'
  );
});

test('CORARemediationSection: editing free-form dispatches a bubbling cora-remediation-freeform', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = true;
  el.answers = { 'q-free': { value: 'No' } };
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-freeform', (/** @type {any} */ e) =>
    events.push(e)
  );

  const input = findByClass(el, 'cora-remediation-freeform-input');
  input.value = 'Refer to compliance';
  input._fire('change', { target: input });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-free',
    value: 'Refer to compliance',
  });
});

test('CORARemediationSection: read-only viewer shows captured free-form as text, no input', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = false;
  el.answers = {
    'q-free': { value: 'No', freeFormRemediation: 'Escalate to legal' },
  };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-freeform-input'), null);
  const value = findByClass(el, 'cora-remediation-freeform-value');
  assert.ok(value);
  assert.equal(value.textContent, 'Escalate to legal');
});

test('CORARemediationSection: read-only viewer with no free-form value renders nothing', () => {
  const el = new CORARemediationSection();
  el.catalogue = FREEFORM_CAT;
  el.canSelectRemediation = false;
  el.answers = { 'q-free': { value: 'No' } };
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-remediation-freeform-value'), null);
});

test('CORARemediationSection: renders category when defined on QuestionDefinition', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();

  const cat = findByClass(el, 'cora-remediation-category');
  assert.ok(cat);
  assert.equal(cat.textContent, 'Discovery');
});

test('CORARemediationSection: skips non-applicable failed questions', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  // q-resolve fails but is not applicable (q-needs !== Yes)
  el.answers = { 'q-needs': { value: 'No' }, 'q-resolve': { value: 'No' } };
  el.connectedCallback();

  const items = findAllByClass(el, 'cora-remediation-item');
  assert.equal(items.length, 1);
  // The single item should be q-needs, not q-resolve
  const qText = findByClass(items[0], 'cora-remediation-question');
  assert.equal(qText.textContent, 'Needs identified?');
});

test('CORARemediationSection: update() re-renders with new state', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-needs': { value: 'No' } };
  el.connectedCallback();
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 1);

  el.update(CATALOGUE, { 'q-needs': { value: 'Yes' } });
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 0);
  assert.ok(findByClass(el, 'cora-remediation-empty'));
});

test('CORARemediationSection: multi-choice answer renders array as comma-joined', () => {
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
  const el = new CORARemediationSection();
  el.catalogue = cat;
  el.answers = { 'q-products': { value: ['Account', 'Billing'] } };
  el.connectedCallback();

  const ansText = findByClass(el, 'cora-remediation-answer');
  assert.equal(ansText.textContent, 'Answer: Account, Billing');
});

test('CORARemediationSection: failed question without remediationActions renders no actions list', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'Q1',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.catalogue = cat;
  el.answers = { q1: { value: 'No' } };
  el.connectedCallback();

  // The failure is listed (failures view), but with no remediation actions list.
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 1);
  assert.equal(findByClass(el, 'cora-remediation-actions'), null);
});

test('CORARemediationSection: renders Attributed Party displayName read-only when attributeFailures is on', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'Greeted?',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.update(
    cat,
    {
      q1: {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
      },
    },
    true
  );

  const ap = findByClass(el, 'cora-remediation-attributed-party');
  assert.ok(ap, 'attributed party surface is rendered');
  assert.equal(ap.textContent, 'Attributed to: Jane Smith');
});

test('CORARemediationSection: does not render Attributed Party when attributeFailures is off', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'Greeted?',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.update(
    cat,
    {
      q1: {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
      },
    },
    false
  );

  assert.equal(findByClass(el, 'cora-remediation-attributed-party'), null);
});

test('CORARemediationSection: no Attributed Party surface when failure has none, even with attributeFailures on', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'Greeted?',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.update(cat, { q1: { value: 'No' } }, true);

  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 1);
  assert.equal(findByClass(el, 'cora-remediation-attributed-party'), null);
});

test('CORARemediationSection: _renderItem with no answer shows empty string via ?? fallback', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-missing',
    text: 'Missing answer?',
    responseType: 'yes-no-na',
    remediationActions: ['Do something'],
    deprecated: false,
  };
  const el = new CORARemediationSection();
  el.answers = {};
  const item = /** @type {any} */ (el)._renderItem(q);
  const answerEl = findByClass(item, 'cora-remediation-answer');
  assert.equal(answerEl.textContent, 'Answer: ');
});

test('CORARemediationSection: _renderItem with null remediationActions renders no actions list', () => {
  // Exercises the `q.remediationActions?.length` guard when remediationActions is null
  const q = /** @type {any} */ ({
    id: 'q-null-actions',
    text: 'No actions?',
    responseType: 'yes-no-na',
    remediationActions: null,
    deprecated: false,
  });
  const el = new CORARemediationSection();
  el.answers = { 'q-null-actions': { value: 'No' } };
  const item = /** @type {any} */ (el)._renderItem(q);
  const actionsList = findByClass(item, 'cora-remediation-actions');
  assert.equal(
    actionsList,
    null,
    'null remediationActions → no actions list rendered'
  );
});

// ===== Attributed Party: editable picker (canAttribute) =====

/** @type {QuestionDefinition[]} */
const FAIL_CAT = [
  {
    id: 'q1',
    text: 'Greeted?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
];

test('CORARemediationSection: read-only viewer (canAttribute off) shows display name, no attribute menu', () => {
  const el = new CORARemediationSection();
  el.client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  el.canAttribute = false;
  el.update(
    FAIL_CAT,
    {
      q1: {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
      },
    },
    true
  );

  assert.ok(
    findByClass(el, 'cora-remediation-attributed-party'),
    'displayName still shown read-only'
  );
  assert.equal(
    findByTag(el, 'cora-attribute-menu'),
    null,
    'no editable menu when not editable'
  );
});

test('CORARemediationSection: editable failure renders an attribute menu wired with client and responsibleParty', () => {
  const client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  const el = new CORARemediationSection();
  el.client = client;
  el.responsibleParty = { loginName: 'rparty', displayName: 'rparty' };
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, true);

  // The menu is now a plain function component rendered inline, so assert on
  // its rendered surface rather than a custom-element instance.
  assert.ok(
    findByClass(el, 'cora-attribute-trigger'),
    'attribute menu rendered for an editable failure'
  );
  const picker = findByTag(el, 'cora-people-picker');
  assert.ok(picker, 'menu embeds a people picker');
  assert.equal(picker.client, client, 'menu forwards the SharePointClient');
  assert.equal(
    findByClass(el, 'cora-attribute-chip'),
    null,
    'unattributed failure shows no chip'
  );
  const quick = findByClass(el, 'cora-attribute-responsible');
  assert.ok(quick, 'menu offers the Responsible Party quick-pick');
  assert.equal(quick.textContent, 'Responsible Party — rparty');
  // The standalone read-only line is replaced by the menu's own chip.
  assert.equal(findByClass(el, 'cora-remediation-attributed-party'), null);
});

test('CORARemediationSection: editable failure with an attribution passes the party to the menu', () => {
  const el = new CORARemediationSection();
  el.client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  el.canAttribute = true;
  el.update(
    FAIL_CAT,
    {
      q1: {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
      },
    },
    true
  );

  const chip = findByClass(el, 'cora-attribute-chip');
  assert.ok(chip, 'menu rendered its chip for the attributed party');
  assert.equal(chip.textContent, 'Jane Smith');
});

test('CORARemediationSection: editable surface is suppressed when attributeFailures is off', () => {
  const el = new CORARemediationSection();
  el.client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  assert.equal(
    findByTag(el, 'cora-attribute-menu'),
    null,
    'menu only appears when attributeFailures is on'
  );
});

test('CORARemediationSection: the menu onChange re-dispatches as bubbling cora-attribute with the question id', () => {
  const el = new CORARemediationSection();
  el.client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, true);

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-attribute', (/** @type {any} */ e) => events.push(e));

  // Picking someone in the embedded people picker invokes the menu's onChange.
  findByTag(el, 'cora-people-picker')._fire('cora-person-selected', {
    detail: { loginName: 'jsmith', displayName: 'Jane Smith' },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q1',
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
  });
});

test('CORARemediationSection: a null cora-attribute-change re-dispatches cora-attribute clearing the party', () => {
  const el = new CORARemediationSection();
  el.client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  el.canAttribute = true;
  el.update(
    FAIL_CAT,
    {
      q1: {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
      },
    },
    true
  );

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-attribute', (/** @type {any} */ e) => events.push(e));

  // Clearing the attribution invokes the menu's onChange with a null party.
  findByClass(el, 'cora-attribute-clear')._fire('click');

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    questionId: 'q1',
    attributedParty: null,
  });
});

// ===== Remediation Details capture surface (ADR-0017) =====

/** @type {import('../src/sharepoint-client.js').RemediationField[]} */
const DETAIL_FIELDS = [
  { key: 'rootCause', label: 'Root cause', type: 'text' },
  {
    key: 'severity',
    label: 'Severity',
    type: 'select',
    options: ['Low', 'Med', 'High'],
  },
];

test('CORARemediationSection: no Remediation Details surface when the Case Type declares no fields', () => {
  const el = new CORARemediationSection();
  el.remediationFields = [];
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  assert.equal(findByClass(el, 'cora-remediation-detail-field'), null);
});

test('CORARemediationSection: editable failure renders a labelled input per Remediation Detail field', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  const fields = findAllByClass(el, 'cora-remediation-detail-field');
  assert.equal(fields.length, 2, 'one row per declared field');
  const labels = findAllByClass(el, 'cora-remediation-detail-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(labels, ['Root cause', 'Severity']);

  const inputs = findAllByClass(el, 'cora-remediation-detail-input');
  assert.equal(inputs[0]._tagName, 'input', 'text field renders an input');
  assert.equal(inputs[1]._tagName, 'select', 'select field renders a select');
});

test('CORARemediationSection: select control offers an option per declared option plus a blank', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  const select = findAllByClass(el, 'cora-remediation-detail-input')[1];
  const optionValues = select._children.map((/** @type {any} */ o) => o.value);
  assert.deepEqual(optionValues, ['', 'Low', 'Med', 'High']);
});

test('CORARemediationSection: editable input pre-fills the captured value', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(
    FAIL_CAT,
    {
      q1: {
        value: 'No',
        remediationDetails: { rootCause: 'Rushed', severity: 'High' },
      },
    },
    false
  );

  const inputs = findAllByClass(el, 'cora-remediation-detail-input');
  assert.equal(inputs[0].value, 'Rushed');
  assert.equal(inputs[1].value, 'High');
});

test('CORARemediationSection: changing a Remediation Detail dispatches a bubbling cora-remediation-detail', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-detail', (/** @type {any} */ e) =>
    events.push(e)
  );

  const input = findAllByClass(el, 'cora-remediation-detail-input')[0];
  input.value = 'Agent rushed the call';
  input._fire('change', { target: input });

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q1',
    key: 'rootCause',
    value: 'Agent rushed the call',
  });
});

test('CORARemediationSection: read-only viewer sees captured values as text with no inputs', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = false;
  el.update(
    FAIL_CAT,
    {
      q1: {
        value: 'No',
        remediationDetails: { rootCause: 'Rushed', severity: 'High' },
      },
    },
    false
  );

  assert.equal(
    findByClass(el, 'cora-remediation-detail-input'),
    null,
    'no editable inputs when frozen'
  );
  const values = findAllByClass(el, 'cora-remediation-detail-value').map(
    (v) => v.textContent
  );
  assert.deepEqual(values, ['Root cause: Rushed', 'Severity: High']);
});

test('CORARemediationSection: read-only viewer omits fields with no captured value', () => {
  const el = new CORARemediationSection();
  el.remediationFields = DETAIL_FIELDS;
  el.canCaptureDetails = false;
  el.update(
    FAIL_CAT,
    { q1: { value: 'No', remediationDetails: { rootCause: 'Rushed' } } },
    false
  );

  const values = findAllByClass(el, 'cora-remediation-detail-value').map(
    (v) => v.textContent
  );
  assert.deepEqual(
    values,
    ['Root cause: Rushed'],
    'only captured fields are shown read-only'
  );
});

// ===== Issue Capture engine integration (ADR-0020) =====

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const CAPTURE_GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    collapsed: false,
    fields: [{ key: 'rootCause', label: 'Root cause', type: 'text' }],
  },
];

test('CORARemediationSection: renders a cora-capture-groups per failed answer when captureGroups declared', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.connectedCallback();
  const cg = findByTag(el, 'cora-capture-groups');
  assert.ok(cg);
  assert.equal(cg.groups, CAPTURE_GROUPS);
  assert.deepEqual(cg.capture, {});
  assert.equal(cg.canCapture, true);
});

test('CORARemediationSection: no cora-capture-groups when no captureGroups declared', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.captureGroups = [];
  el.connectedCallback();
  assert.equal(findByTag(el, 'cora-capture-groups'), null);
});

test('CORARemediationSection: passes the failed Answer capture into cora-capture-groups', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = {
    'q-welcome': { value: 'No', capture: { rootCause: 'Rushed' } },
  };
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.connectedCallback();
  const cg = findByTag(el, 'cora-capture-groups');
  assert.deepEqual(cg.capture, { rootCause: 'Rushed' });
});

test('CORARemediationSection: re-dispatches child cora-capture enriched with the question id', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.connectedCallback();
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-capture', (/** @type {any} */ e) => events.push(e));
  const cg = findByTag(el, 'cora-capture-groups');
  cg._fire('cora-capture', {
    type: 'cora-capture',
    detail: { fieldKey: 'rootCause', value: 'Rushed' },
    stopPropagation() {},
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    questionId: 'q-welcome',
    fieldKey: 'rootCause',
    value: 'Rushed',
  });
  assert.equal(events[0].bubbles, true);
});

test('CORARemediationSection: reuses the cora-capture-groups instance across re-renders', () => {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.answers = { 'q-welcome': { value: 'No' } };
  el.connectedCallback();
  const first = findByTag(el, 'cora-capture-groups');
  el.update(
    CATALOGUE,
    { 'q-welcome': { value: 'No', capture: { rootCause: 'x' } } },
    false
  );
  const second = findByTag(el, 'cora-capture-groups');
  assert.equal(
    first,
    second,
    'same instance reused so ephemeral collapse survives'
  );
});
