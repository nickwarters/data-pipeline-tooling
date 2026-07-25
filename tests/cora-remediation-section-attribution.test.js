// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
import {
  CORARemediationSection,
  findByTag,
  FAIL_CAT,
  findByClass,
  findAllByClass,
} from './helpers/cora-remediation-section.js';

// Capability: failure attribution.

test('CORARemediationSection: renders Attributed Party displayName read-only when attributeFailures is on', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q1',
      text: 'Greeted?',
      responseType: 'yes-no-na',
      failureValues: ['No'],
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
      failureValues: ['No'],
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
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const el = new CORARemediationSection();
  el.update(cat, { q1: { value: 'No' } }, true);

  assert.equal(findAllByClass(el, 'cora-remediation-item').length, 1);
  assert.equal(findByClass(el, 'cora-remediation-attributed-party'), null);
});

test('CORARemediationSection: read-only viewer (canAttribute off) shows display name, no attribute menu', () => {
  const el = new CORARemediationSection();
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
    findByClass(el, 'cora-attribute-menu'),
    null,
    'no editable menu when not editable'
  );
});

test('CORARemediationSection: editable failure renders a controlled attribute menu with responsibleParty', () => {
  const el = new CORARemediationSection();
  el.responsibleParty = { loginName: 'rparty', displayName: 'rparty' };
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, true);

  // The menu is now a plain function component rendered inline, so assert on
  // its rendered surface rather than a custom-element instance.
  assert.ok(
    findByClass(el, 'cora-attribute-title'),
    'attribute menu rendered inline for an editable failure'
  );
  assert.equal(findByTag(el, 'cora-people-picker'), null);
  assert.ok(
    el.querySelector('[role="combobox"]'),
    'menu renders the picker directly'
  );
  assert.equal(
    findByClass(el, 'cora-attribute-current'),
    null,
    'unattributed failure shows no current-party chip'
  );
  const quick = findByClass(el, 'cora-attribute-responsible');
  assert.ok(quick, 'menu offers the Responsible Party quick-pick');
  assert.equal(quick.textContent, 'Responsible Party — rparty');
  // The standalone read-only line is replaced by the menu's own chip.
  assert.equal(findByClass(el, 'cora-remediation-attributed-party'), null);
});

test('CORARemediationSection: editable failure with an attribution passes the party to the menu', () => {
  const el = new CORARemediationSection();
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

  const chip = findByClass(el, 'cora-attribute-current');
  assert.ok(chip, 'menu named the attributed party inline');
  assert.equal(chip.textContent, 'Jane Smith');
});

test('CORARemediationSection: editable surface is suppressed when attributeFailures is off', () => {
  const el = new CORARemediationSection();
  el.canAttribute = true;
  el.update(FAIL_CAT, { q1: { value: 'No' } }, false);

  assert.equal(
    findByClass(el, 'cora-attribute-menu'),
    null,
    'menu only appears when attributeFailures is on'
  );
});

test('CORARemediationSection: the menu quick-pick re-dispatches as bubbling cora-attribute with the question id', () => {
  const el = new CORARemediationSection();
  el.canAttribute = true;
  el.responsibleParty = { loginName: 'jsmith', displayName: 'Jane Smith' };
  el.update(FAIL_CAT, { q1: { value: 'No' } }, true);

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-attribute', (/** @type {any} */ e) =>
    events.push(e)
  );

  findByClass(el, 'cora-attribute-responsible')._fire('click');

  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.deepEqual(events[0].detail, {
    questionId: 'q1',
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
  });
});

test('CORARemediationSection: clear re-dispatches cora-attribute with a null party', () => {
  const el = new CORARemediationSection();
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
  el.addEventListener('cora-attribute', (/** @type {any} */ e) =>
    events.push(e)
  );

  // Clearing the attribution invokes the menu's controlled clear callback.
  findByClass(el, 'cora-attribute-clear')._fire('click');

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    questionId: 'q1',
    attributedParty: null,
  });
});
