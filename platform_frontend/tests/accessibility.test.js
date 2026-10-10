// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { getByRole } from './helpers/semantic-dom.js';

installDom();

const { questionCardView } =
  await import('../src/pages/cora-case-review/question-panel-view.js');
const { StatusBanner } =
  await import('../src/components/base/cora-status-banner.js');
const { GeneralQuestions } =
  await import('../src/pages/cora-case-review/general-questions-view.js');
const { CaptureGroups } =
  await import('../src/components/sections/cora-capture-groups.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').CaptureField} CaptureField */

/** @param {Node[]} nodes */
function rootOf(nodes) {
  const root = document.createElement('div');
  root.append(...nodes);
  return root;
}

/** @type {CaptureField[]} */
const CAPTURE_FIELDS = [
  { key: 'summary', label: 'Root cause summary', type: 'text' },
  { key: 'detail', label: 'What happened', type: 'textarea' },
  { key: 'severity', label: 'Severity', type: 'select', options: ['High'] },
  { key: 'repeat', label: 'Repeat issue?', type: 'radio', options: ['Yes'] },
  { key: 'attributedTo', label: 'Attributed to', type: 'person' },
];

/** @param {QuestionDefinition} question @param {any} value */
function mountQuestion(question, value) {
  return /** @type {HTMLElement} */ (
    questionCardView({
      question,
      answer: { value },
      access: 'edit',
      onAnswer() {},
    }).querySelector('fieldset')
  );
}

test('Question: yes-no-na renders an accessible required radiogroup', () => {
  const fieldset = mountQuestion(
    /** @type {QuestionDefinition} */ ({
      id: 'q1',
      text: 'Q1?',
      responseType: 'yes-no-na',
      deprecated: false,
    }),
    ''
  );
  assert.equal(fieldset.getAttribute('role'), 'radiogroup');
  assert.equal(fieldset.getAttribute('aria-required'), 'true');
});

test('Question: single-choice uses radiogroup and multi-choice uses group', () => {
  const base = {
    id: 'q-choice',
    text: 'Choice?',
    options: ['A', 'B'],
    deprecated: false,
  };
  assert.equal(
    mountQuestion(
      /** @type {QuestionDefinition} */ ({
        ...base,
        responseType: 'single-choice',
      }),
      ''
    ).getAttribute('role'),
    'radiogroup'
  );
  assert.equal(
    mountQuestion(
      /** @type {QuestionDefinition} */ ({
        ...base,
        responseType: 'multi-choice',
      }),
      []
    ).getAttribute('role'),
    'group'
  );
});

test('Question: the fieldset carries the id its legend and label refer to', () => {
  const fieldset = mountQuestion(
    /** @type {QuestionDefinition} */ ({
      id: 'q-chan',
      text: 'Channel?',
      responseType: 'single-choice',
      options: ['Phone', 'Email'],
      deprecated: false,
    }),
    ''
  );
  assert.equal(fieldset.id, 'cora-q-q-chan');
});

test('Issue Capture: every field caption names its control', () => {
  const root = rootOf(
    CaptureGroups({
      groups: [{ key: 'g1', label: 'Root cause', fields: CAPTURE_FIELDS }],
      capture: {},
      canCapture: true,
      namePrefix: 'q1-',
      collapsed: new Map(),
      peopleSearch: {},
      onToggle() {},
      onCapture() {},
      onPersonQuery() {},
    })
  );

  assert.equal(
    getByRole(root, 'textbox', { name: 'Root cause summary' })._tagName,
    'input'
  );
  assert.equal(
    getByRole(root, 'textbox', { name: 'What happened' })._tagName,
    'textarea'
  );
  assert.ok(getByRole(root, 'combobox', { name: 'Severity' }));
  assert.ok(
    getByRole(root, 'combobox', { name: 'Search people for Attributed to' })
  );
  // A radio field is a set, so the caption names the set rather than any one
  // input; each input keeps its option's own name.
  const repeat = getByRole(root, 'group', { name: 'Repeat issue?' });
  assert.ok(getByRole(repeat, 'radio', { name: 'Yes' }));
});

test('General Questions: every field caption names its control', () => {
  const root = rootOf(
    GeneralQuestions({
      fields: [
        { key: 'notes', label: 'Reviewer notes', type: 'textarea' },
        {
          key: 'channel',
          label: 'Review channel',
          type: 'select',
          options: ['Phone'],
        },
        {
          key: 'second',
          label: 'Second checked?',
          type: 'radio',
          options: ['Yes'],
        },
      ],
      answers: {},
      access: 'edit',
      onAnswer() {},
    })
  );

  assert.ok(getByRole(root, 'textbox', { name: 'Reviewer notes' }));
  assert.ok(getByRole(root, 'combobox', { name: 'Review channel' }));
  const second = getByRole(root, 'group', { name: 'Second checked?' });
  assert.ok(getByRole(second, 'radio', { name: 'Yes' }));
});

test('StatusBanner: saving banner announces polite status', () => {
  const node = /** @type {any} */ (StatusBanner({ status: 'saving' }));
  assert.equal(node._attrs.role, 'status');
  assert.equal(node._attrs['aria-live'], 'polite');
});

test('StatusBanner: the conflict banner says what was changed elsewhere', () => {
  const node = /** @type {any} */ (
    StatusBanner({ status: 'conflict', conflictMessage: 'This form changed.' })
  );
  assert.equal(node._attrs.role, 'alert');
  assert.match(node.textContent, /This form changed\./);
});

test('Forms: every field caption names its control, in every panel layout', async () => {
  const { formSectionsView } =
    await import('../src/pages/forms/form-sections-view.js');
  const { FORM_PANEL_LAYOUTS } = await import('../form-types/contract.js');
  const { captureFieldTypeNames } =
    await import('../src/capture-fields/registry.js');
  /** The role each drawable field type's control takes, and how it is named. */
  const expected = {
    text: { role: 'textbox', name: (/** @type {string} */ l) => l },
    textarea: { role: 'textbox', name: (/** @type {string} */ l) => l },
    date: { role: 'textbox', name: (/** @type {string} */ l) => l },
    select: { role: 'combobox', name: (/** @type {string} */ l) => l },
    radio: { role: 'group', name: (/** @type {string} */ l) => l },
    person: {
      role: 'combobox',
      name: (/** @type {string} */ l) => `Search people for ${l}`,
    },
  };
  assert.deepEqual(
    Object.keys(expected).sort(),
    captureFieldTypeNames().sort(),
    'every type a Form can draw is checked'
  );
  const types = /** @type {Array<keyof typeof expected>} */ (
    Object.keys(expected)
  );
  const definition = /** @type {any} */ ({
    slug: 'all-fields',
    formName: 'All fields',
    description: '',
    listName: 'AllFields',
    sections: FORM_PANEL_LAYOUTS.map((layout) => ({
      sectionType: 'panel',
      panelName: layout,
      layout,
      fields: types.map((type) => ({
        type,
        label: `${layout} ${type}`,
        itemField: `${layout}-${type}`,
        choices: ['One'],
      })),
    })),
  });
  const root = rootOf(
    formSectionsView(
      definition,
      /** @type {any} */ ({ id: '1', etag: '', fields: {}, problems: [] }),
      {
        mode: 'edit',
        access: /** @type {any} */ ({ canEditField: () => true }),
        me: 'me',
        peopleSearch: {},
        onField() {},
        onPersonQuery() {},
      }
    )
  );
  for (const layout of FORM_PANEL_LAYOUTS) {
    for (const type of types) {
      const label = `${layout} ${type}`;
      const { role, name } = expected[type];
      // A set of radio buttons placed apart from its question is a radiogroup.
      const actualRole =
        type === 'radio' && layout === 'question-answer' ? 'radiogroup' : role;
      assert.ok(
        getByRole(root, actualRole, { name: name(label) }),
        `${label} is a ${actualRole} named "${name(label)}"`
      );
    }
  }
});
