// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCapture,
  captureDisplayText,
  isEmptyCaptureValue,
  unfilledRequiredCapture,
  validateCaptureGroups,
  findCaptureField,
  visibleCaptureFields,
} from '../src/evaluators/issue-capture.js';

/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */
/** @typedef {import('../src/sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../src/sharepoint-client.js').CaptureField} CaptureField */

/**
 * `applyCapture` for the cases that name a declared field, so a `null` return
 * is the test failing rather than a result to assert on.
 *
 * @param {Answer} answer
 * @param {CaptureGroup[]} groups
 * @param {string} fieldKey
 * @param {any} value
 * @returns {Answer}
 */
function captured(answer, groups, fieldKey, value) {
  const next = applyCapture(answer, groups, fieldKey, value);
  assert.ok(next, `expected a write for the declared field "${fieldKey}"`);
  return next;
}

/** @type {CaptureField} */
const TEXT_FIELD = { key: 'rootCause', label: 'Root cause', type: 'text' };
/** @type {CaptureField} */
const TEXTAREA_FIELD = { key: 'detail', label: 'Detail', type: 'textarea' };
/** @type {CaptureField} */
const SELECT_FIELD = {
  key: 'severity',
  label: 'Severity',
  type: 'select',
  options: ['Low', 'Med', 'High'],
};
/** @type {CaptureField} */
const RADIO_FIELD = {
  key: 'repeat',
  label: 'Repeat?',
  type: 'radio',
  options: ['Yes', 'No'],
};
/** @type {CaptureField} */
const PERSON_FIELD = {
  key: 'attributedTo',
  label: 'Attributed to',
  type: 'person',
};

const PERSON = { loginName: 'corp\\jsmith', displayName: 'Jane Smith' };

/**
 * One group holding one field of every type, none conditional — so these
 * exercise the per-field write rules with nothing to prune.
 *
 * @type {CaptureGroup[]}
 */
const TYPED_GROUPS = [
  {
    key: 'g1',
    label: 'Group one',
    fields: [
      TEXT_FIELD,
      TEXTAREA_FIELD,
      SELECT_FIELD,
      RADIO_FIELD,
      PERSON_FIELD,
    ],
  },
];

/**
 * @param {Answer} answer
 * @param {string} fieldKey
 * @param {any} value
 */
const typedCapture = (answer, fieldKey, value) =>
  captured(answer, TYPED_GROUPS, fieldKey, value);

test('applyCapture: records a text value into Answer.capture', () => {
  const out = typedCapture({ value: 'No' }, 'rootCause', 'Agent rushed');
  assert.deepEqual(out.capture, { rootCause: 'Agent rushed' });
  assert.equal(out.value, 'No', 'the rest of the Answer is preserved');
});

test('applyCapture: records a textarea value', () => {
  const out = typedCapture({ value: 'No' }, 'detail', 'Long form notes');
  assert.deepEqual(out.capture, { detail: 'Long form notes' });
});

test('applyCapture: accepts a select value that is one of the options', () => {
  const out = typedCapture({ value: 'No' }, 'severity', 'High');
  assert.deepEqual(out.capture, { severity: 'High' });
});

test('applyCapture: accepts a radio value that is one of the options', () => {
  const out = typedCapture({ value: 'No' }, 'repeat', 'Yes');
  assert.deepEqual(out.capture, { repeat: 'Yes' });
});

test('applyCapture: rejects a select value that is not one of the options', () => {
  assert.throws(
    () => typedCapture({ value: 'No' }, 'severity', 'Critical'),
    /Critical/,
    'an out-of-range select value must be rejected at capture time'
  );
});

test('applyCapture: rejects a radio value that is not one of the options', () => {
  assert.throws(
    () => typedCapture({ value: 'No' }, 'repeat', 'Maybe'),
    /Maybe/
  );
});

test('applyCapture: merges with existing capture rather than replacing it', () => {
  const out = typedCapture(
    { value: 'No', capture: { rootCause: 'Rushed' } },
    'severity',
    'High'
  );
  assert.deepEqual(out.capture, { rootCause: 'Rushed', severity: 'High' });
});

test('applyCapture: clearing a value removes its key', () => {
  const out = typedCapture(
    { value: 'No', capture: { rootCause: 'Rushed', severity: 'High' } },
    'rootCause',
    ''
  );
  assert.deepEqual(out.capture, { severity: 'High' });
});

test('applyCapture: clearing the last value drops capture entirely', () => {
  const out = typedCapture(
    { value: 'No', capture: { rootCause: 'Rushed' } },
    'rootCause',
    ''
  );
  assert.equal('capture' in out, false);
  assert.equal(out.value, 'No');
});

test('applyCapture: clearing an empty select value is allowed (not validated)', () => {
  const out = typedCapture({ value: 'No' }, 'severity', '');
  assert.equal('capture' in out, false);
});

test('applyCapture: stores a person value verbatim', () => {
  const out = typedCapture({ value: 'No' }, 'attributedTo', PERSON);
  assert.deepEqual(out.capture, { attributedTo: PERSON });
});

test('applyCapture: rejects a person write that is not two non-empty names', () => {
  for (const bad of [
    'Jane Smith',
    { loginName: 'corp\\jsmith' },
    { loginName: 'corp\\jsmith', displayName: '' },
    { loginName: '', displayName: 'Jane Smith' },
    { loginName: 1, displayName: 2 },
  ]) {
    assert.throws(
      () => typedCapture({ value: 'No' }, 'attributedTo', bad),
      /attributedTo/,
      `a malformed person write must be rejected, naming the field: ${JSON.stringify(bad)}`
    );
  }
});

test('applyCapture: rejects an object written to a string-typed field', () => {
  assert.throws(
    () => typedCapture({ value: 'No' }, 'rootCause', PERSON),
    /rootCause/
  );
});

test('applyCapture: clearing a person value removes its key', () => {
  const out = typedCapture(
    { value: 'No', capture: { attributedTo: PERSON, severity: 'High' } },
    'attributedTo',
    null
  );
  assert.deepEqual(out.capture, { severity: 'High' });
});

test('applyCapture: clearing the last person value drops capture entirely', () => {
  const out = typedCapture(
    { value: 'No', capture: { attributedTo: PERSON } },
    'attributedTo',
    undefined
  );
  assert.equal('capture' in out, false);
});

test('isEmptyCaptureValue: only an absent value or empty text is nothing recorded', () => {
  assert.equal(isEmptyCaptureValue(undefined), true);
  assert.equal(isEmptyCaptureValue(null), true);
  assert.equal(isEmptyCaptureValue(''), true);
  assert.equal(isEmptyCaptureValue('Rushed'), false);
  assert.equal(isEmptyCaptureValue(PERSON), false);
});

test('captureDisplayText: a person reads as their display name', () => {
  assert.equal(captureDisplayText(PERSON), 'Jane Smith');
});

test('captureDisplayText: a bare string on a person field still reads back', () => {
  // Before person fields were built, the control fell through to a text box and
  // wrote a plain string, so a Case saved then holds one under a person key.
  assert.equal(captureDisplayText('Jane Smith'), 'Jane Smith');
  assert.equal(captureDisplayText(undefined), '');
  assert.equal(captureDisplayText(/** @type {any} */ ([{ id: 'a' }])), '');
});

test('validateCaptureGroups: passes when all field keys are unique across groups', () => {
  const groups = [
    {
      key: 'g1',
      label: 'Group 1',
      fields: [{ key: 'a', label: 'A', type: /** @type {const} */ ('text') }],
    },
    {
      key: 'g2',
      label: 'Group 2',
      fields: [{ key: 'b', label: 'B', type: /** @type {const} */ ('text') }],
    },
  ];
  assert.doesNotThrow(() => validateCaptureGroups(groups));
});

test('validateCaptureGroups: throws when a field key is duplicated across groups', () => {
  const groups = [
    {
      key: 'g1',
      label: 'Group 1',
      fields: [{ key: 'dup', label: 'A', type: /** @type {const} */ ('text') }],
    },
    {
      key: 'g2',
      label: 'Group 2',
      fields: [{ key: 'dup', label: 'B', type: /** @type {const} */ ('text') }],
    },
  ];
  assert.throws(() => validateCaptureGroups(groups), /dup/);
});

test('validateCaptureGroups: tolerates an absent captureGroups declaration', () => {
  assert.doesNotThrow(() => validateCaptureGroups(undefined));
});

test('findCaptureField: returns the field with the given key from any group', () => {
  const groups = [
    {
      key: 'g1',
      label: 'G1',
      fields: [{ key: 'a', label: 'A', type: /** @type {const} */ ('text') }],
    },
    {
      key: 'g2',
      label: 'G2',
      fields: [
        {
          key: 'b',
          label: 'B',
          type: /** @type {const} */ ('select'),
          options: ['x'],
        },
      ],
    },
  ];
  assert.equal(findCaptureField(groups, 'b')?.label, 'B');
});

test('findCaptureField: returns undefined for an unknown key', () => {
  assert.equal(findCaptureField([], 'nope'), undefined);
});

// --- intra-group visibility -------------------------------------------------

/** @type {CaptureField[]} */
const CONDITIONAL_FIELDS = [
  { key: 'origin', label: 'Origin', type: 'select', options: ['Sales', 'Ops'] },
  {
    key: 'salesTeam',
    label: 'Sales team',
    type: 'text',
    showWhen: { origin: { equals: 'Sales' } },
  },
  {
    key: 'escalation',
    label: 'Escalation',
    type: 'text',
    showWhen: {
      $and: [
        { origin: { in: ['Sales', 'Ops'] } },
        { salesTeam: { answered: true } },
      ],
    },
  },
  {
    key: 'eitherWay',
    label: 'Either way',
    type: 'text',
    showWhen: {
      $or: [{ origin: { equals: 'Ops' } }, { salesTeam: { answered: true } }],
    },
  },
];

/** @param {Record<string, any>} capture */
function visibleKeys(capture) {
  return visibleCaptureFields(CONDITIONAL_FIELDS, capture).map((f) => f.key);
}

test('visibleCaptureFields: a field with no showWhen is always visible', () => {
  assert.deepEqual(visibleKeys({}), ['origin']);
});

test('visibleCaptureFields: a sibling value reveals and hides its dependants', () => {
  assert.deepEqual(visibleKeys({ origin: 'Sales' }), ['origin', 'salesTeam']);
  assert.deepEqual(visibleKeys({ origin: 'Ops' }), ['origin', 'eitherWay']);
  assert.deepEqual(visibleKeys({ origin: 'Sales', salesTeam: 'North' }), [
    'origin',
    'salesTeam',
    'escalation',
    'eitherWay',
  ]);
});

test('visibleCaptureFields: a person sibling contributes its display name', () => {
  /** @type {CaptureField[]} */
  const fields = [
    { key: 'attributedTo', label: 'Attributed to', type: 'person' },
    {
      key: 'why',
      label: 'Why them?',
      type: 'text',
      showWhen: { attributedTo: { answered: true } },
    },
  ];
  assert.deepEqual(
    visibleCaptureFields(fields, {}).map((f) => f.key),
    ['attributedTo']
  );
  assert.deepEqual(
    visibleCaptureFields(fields, { attributedTo: PERSON }).map((f) => f.key),
    ['attributedTo', 'why']
  );
});

// --- applyCapture -----------------------------------------------------------

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const CONDITIONAL_GROUPS = [
  { key: 'g1', label: 'Group one', fields: CONDITIONAL_FIELDS },
];

test('applyCapture: a value that hides a sibling drops the sibling in the same write', () => {
  const answer = {
    value: 'No',
    capture: {
      origin: 'Sales',
      salesTeam: 'North',
      escalation: 'Yes',
      eitherWay: 'Noted',
    },
  };
  const next = captured(answer, CONDITIONAL_GROUPS, 'origin', 'Ops');
  assert.deepEqual(next.capture, { origin: 'Ops', eitherWay: 'Noted' });
});

test('applyCapture: pruning cascades, because hiding can only ever hide more', () => {
  const answer = {
    value: 'No',
    capture: { origin: 'Sales', salesTeam: 'North', escalation: 'Yes' },
  };
  // Clearing the origin hides salesTeam, whose disappearance in turn hides
  // escalation — one write, both gone.
  const next = captured(answer, CONDITIONAL_GROUPS, 'origin', '');
  assert.equal('capture' in next, false);
});

test('applyCapture: a hidden field starts empty when it becomes visible again', () => {
  /** @type {Answer} */
  let answer = { value: 'No' };
  answer = captured(answer, CONDITIONAL_GROUPS, 'origin', 'Sales');
  answer = captured(answer, CONDITIONAL_GROUPS, 'salesTeam', 'North');
  answer = captured(answer, CONDITIONAL_GROUPS, 'origin', 'Ops');
  answer = captured(answer, CONDITIONAL_GROUPS, 'origin', 'Sales');
  assert.equal(answer.capture?.salesTeam, undefined);
});

test('applyCapture: a value a field cannot hold is still rejected', () => {
  assert.throws(
    () =>
      applyCapture({ value: 'No' }, CONDITIONAL_GROUPS, 'origin', 'Nowhere'),
    /origin/
  );
});

test('applyCapture: a stored key no group declares is left alone', () => {
  const next = captured(
    { value: 'No', capture: { legacyKey: 'kept' } },
    CONDITIONAL_GROUPS,
    'origin',
    'Ops'
  );
  assert.equal(next.capture?.legacyKey, 'kept');
});

test('applyCapture: writing to a key no group declares is no write at all', () => {
  assert.equal(
    applyCapture({ value: 'No' }, CONDITIONAL_GROUPS, 'noSuchField', 'x'),
    null,
    'an undeclared field must be distinguishable from an unchanged Answer'
  );
});

// --- the required-capture completion gate -----------------------------------

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const REQUIRED_GROUPS = [
  {
    key: 'g1',
    label: 'Group one',
    fields: [
      { key: 'origin', label: 'Origin', type: 'select', options: ['Sales'] },
      {
        key: 'salesTeam',
        label: 'Sales team',
        type: 'text',
        required: true,
        showWhen: { origin: { equals: 'Sales' } },
      },
    ],
  },
];

/** @type {any[]} */
const REQUIRED_CATALOGUE = [
  {
    id: 'q1',
    text: 'One',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

test('unfilledRequiredCapture: only a visible, empty required field on a failure blocks', () => {
  const blocked = unfilledRequiredCapture(
    REQUIRED_CATALOGUE,
    { q1: { value: 'No', capture: { origin: 'Sales' } } },
    REQUIRED_GROUPS
  );
  assert.equal(blocked, true);

  assert.equal(
    unfilledRequiredCapture(
      REQUIRED_CATALOGUE,
      { q1: { value: 'No', capture: { origin: 'Sales', salesTeam: 'North' } } },
      REQUIRED_GROUPS
    ),
    false,
    'filling it clears the gate'
  );
  assert.equal(
    unfilledRequiredCapture(
      REQUIRED_CATALOGUE,
      { q1: { value: 'No' } },
      REQUIRED_GROUPS
    ),
    false,
    'a field hidden by its showWhen is not required'
  );
  assert.equal(
    unfilledRequiredCapture(
      REQUIRED_CATALOGUE,
      { q1: { value: 'Yes', capture: { origin: 'Sales' } } },
      REQUIRED_GROUPS
    ),
    false,
    'a passing Answer has no Issue to capture against'
  );
  assert.equal(
    unfilledRequiredCapture(REQUIRED_CATALOGUE, { q1: { value: 'No' } }, []),
    false,
    'a Case Type with no capture groups gates nothing'
  );
});

test('unfilledRequiredCapture: an inapplicable failed Question never blocks', () => {
  /** @type {any[]} */
  const catalogue = [
    ...REQUIRED_CATALOGUE,
    {
      id: 'q2',
      text: 'Two',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      showWhen: { q1: { equals: 'Yes' } },
      deprecated: false,
    },
  ];
  assert.equal(
    unfilledRequiredCapture(
      catalogue,
      {
        q1: { value: 'No', capture: { origin: 'Sales', salesTeam: 'North' } },
        q2: { value: 'No', capture: { origin: 'Sales' } },
      },
      REQUIRED_GROUPS
    ),
    false
  );
});
