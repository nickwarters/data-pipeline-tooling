// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installDom,
  ConnectingStubEl,
  useElementClass,
  findByClass,
  findAllByClass,
  findByTag,
} from './_dom-stub.js';

installDom();
// Real custom-element upgrade semantics: appending a registered cora-* element
// mounts it, so the cora-capture-groups internals (the <select> the Reviewer
// edits) exist and node identity across updates is observable (issue #308).
useElementClass(ConnectingStubEl, { registry: true });

// ===== IMPORTS (after stubs) =====
const { CORARemediationSection } =
  await import('./helpers/cora-remediation-section.js');
const { updateRemediationItem } =
  await import('../src/pages/cora-case-review/remediation-view.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q-welcome',
    text: 'Greeted professionally?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: 'Needs identified?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Issue resolved?',
    responseType: 'yes-no-na',
    showWhen: { 'q-needs': { equals: 'Yes' } },
    failureValues: ['No'],
    deprecated: false,
  },
];

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const CAPTURE_GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    collapsed: false,
    fields: [
      {
        key: 'rootCause',
        label: 'Root cause',
        type: 'select',
        options: ['Rushed', 'Training gap'],
      },
    ],
  },
];

/** @param {Record<string, any>} answers */
function connectedSection(answers) {
  const el = new CORARemediationSection();
  el.catalogue = CATALOGUE;
  el.answers = answers;
  el.captureGroups = CAPTURE_GROUPS;
  el.canCapture = true;
  el.connectedCallback();
  return el;
}

// Capability: in-place reconciliation of the failed-item list (issue #308).

test('a capture-value update keeps the cora-capture-groups element attached to the same li', () => {
  const el = connectedSection({ 'q-welcome': { value: 'No' } });
  const li = findByClass(el, 'cora-remediation-item');
  const cg = findByTag(el, 'cora-capture-groups');
  const select = findByTag(el, 'select');
  assert.ok(li && cg && select, 'item, capture element and select rendered');

  el.update(
    CATALOGUE,
    { 'q-welcome': { value: 'No', capture: { rootCause: 'Rushed' } } },
    false
  );

  assert.equal(findByClass(el, 'cora-remediation-item'), li, 'same <li>');
  assert.equal(
    findByTag(el, 'cora-capture-groups'),
    cg,
    'same cora-capture-groups instance'
  );
  assert.equal(cg.parentNode, li, 'capture element never left its <li>');
  assert.equal(
    findByTag(el, 'select'),
    select,
    'the <select> the Reviewer is editing survives the update'
  );
  assert.equal(
    select.value,
    'Rushed',
    'new value synced into the live control'
  );
});

test('the in-place update still refreshes the item content around the capture element', () => {
  const el = connectedSection({ 'q-welcome': { value: 'No' } });
  const li = findByClass(el, 'cora-remediation-item');

  el.update(
    CATALOGUE,
    {
      'q-welcome': {
        value: 'No',
        attributedParty: { loginName: 'bob', displayName: 'Bob' },
      },
    },
    true
  );
  // attributeFailures flipping is structural: the first update rebuilds. The
  // next value change on the same structure must patch in place.
  const li2 = findByClass(el, 'cora-remediation-item');
  const cg = findByTag(el, 'cora-capture-groups');
  el.update(
    CATALOGUE,
    {
      'q-welcome': {
        value: 'No',
        attributedParty: { loginName: 'ann', displayName: 'Ann' },
      },
    },
    true
  );

  assert.notEqual(li, li2, 'structural flag change rebuilt the list');
  assert.equal(findByClass(el, 'cora-remediation-item'), li2, 'same <li>');
  assert.equal(cg.parentNode, li2, 'capture element stays attached');
  assert.equal(
    findByClass(el, 'cora-remediation-attributed-party').textContent,
    'Attributed to: Ann',
    'read-only attribution text refreshed in place'
  );
});

test('items untouched by the change keep their DOM nodes entirely', () => {
  // The view model updates answers immutably: only the edited Answer gets a
  // new reference. The untouched Answer keeps its reference — and its DOM.
  const welcome = { value: 'No' };
  const el = connectedSection({
    'q-welcome': welcome,
    'q-needs': { value: 'No' },
  });
  const answersBefore = findAllByClass(el, 'cora-remediation-answer');
  assert.equal(answersBefore.length, 2);

  el.update(
    CATALOGUE,
    {
      'q-welcome': welcome,
      'q-needs': { value: 'No', capture: { rootCause: 'Rushed' } },
    },
    false
  );

  const answersAfter = findAllByClass(el, 'cora-remediation-answer');
  assert.equal(
    answersAfter[0],
    answersBefore[0],
    'the unchanged item is not touched at all'
  );
  assert.notEqual(
    answersAfter[1],
    answersBefore[1],
    'the edited item content is rebuilt'
  );
});

test('a change to the failed set still rebuilds the list correctly', () => {
  const el = connectedSection({
    'q-welcome': { value: 'No' },
    'q-needs': { value: 'No' },
  });
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 2);

  // q-needs passes, which makes q-resolve applicable — and it fails.
  el.update(
    CATALOGUE,
    {
      'q-welcome': { value: 'No' },
      'q-needs': { value: 'Yes' },
      'q-resolve': { value: 'No' },
    },
    false
  );
  const items = findAllByClass(el, 'cora-remediation-item');
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.getAttribute('key')),
    ['q-welcome', 'q-resolve'],
    'failed items carry stable question identities for morphing'
  );
  assert.deepEqual(
    items.map(
      (item) => findByClass(item, 'cora-remediation-question').textContent
    ),
    ['Greeted professionally?', 'Issue resolved?'],
    'the failed set follows applicability'
  );

  // Everything passes: back to the empty state.
  el.update(
    CATALOGUE,
    {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'Yes' },
      'q-resolve': { value: 'Yes' },
    },
    false
  );
  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 0);
  assert.ok(findByClass(el, 'cora-empty cora-remediation-empty'));
});

test('updateRemediationItem renders a complete item into an empty li', () => {
  // Defensive path: when the capture element is not attached to the li being
  // patched (e.g. the li was rebuilt externally), the item is built from
  // scratch — capture element appended in its slot — rather than throwing.
  /** @type {any} */
  const props = {
    catalogue: CATALOGUE,
    answers: { 'q-welcome': { value: 'No', capture: { rootCause: 'Rushed' } } },
    attributeFailures: false,
    client: null,
    responsibleParty: null,
    canAttribute: false,
    remediationFields: [],
    canCaptureDetails: false,
    captureGroups: CAPTURE_GROUPS,
    canCapture: true,
    captureEls: new Map(),
    canSelectRemediation: false,
    dispatchCapture() {},
    dispatchDetail() {},
    dispatchAttribute() {},
    dispatchRemediationAction() {},
    dispatchRemediationFreeForm() {},
  };
  const li = document.createElement('li');

  updateRemediationItem(props, li, CATALOGUE[0]);

  assert.equal(
    findByClass(li, 'cora-remediation-question').textContent,
    'Greeted professionally?'
  );
  const cg = findByTag(li, 'cora-capture-groups');
  assert.equal(cg.parentNode, li, 'capture element appended into its slot');
  assert.deepEqual(cg.capture, { rootCause: 'Rushed' });
});

test('an unchanged answers reference is a no-op patch', () => {
  const answers = { 'q-welcome': { value: 'No' } };
  const el = connectedSection(answers);
  const answerText = findByClass(el, 'cora-remediation-answer');

  el.update(CATALOGUE, answers, false);

  assert.equal(
    findByClass(el, 'cora-remediation-answer'),
    answerText,
    'nothing is rebuilt when no answer changed'
  );
});
