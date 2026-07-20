// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';

installDom();
const { Question, renderSelectedRemediation } =
  await import('../src/components/sections/cora-question.js');

const YES_NO =
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition} */ ({
    id: 'q1',
    text: 'Compliant?',
    responseType: 'yes-no-na',
    deprecated: false,
  });
const MULTI =
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition} */ ({
    id: 'q2',
    text: 'Select all',
    responseType: 'multi-choice',
    options: ['A', 'B'],
    deprecated: false,
  });

/** @param {Node[]} nodes */
function rootOf(nodes) {
  const root = document.createElement('div');
  root.append(...nodes);
  return root;
}

test('Question returns no UI without a definition', () => {
  assert.deepEqual(
    Question({
      question: null,
      currentValue: '',
      access: 'edit',
      onAnswer() {},
    }),
    []
  );
});

test('Question renders selected single-choice state and reports edits', () => {
  /** @type {any[]} */
  const answers = [];
  const root = rootOf(
    Question({
      question: YES_NO,
      currentValue: 'No',
      access: 'edit',
      onAnswer: (answer) => answers.push(answer),
    })
  );
  assert.equal(
    root.querySelector('fieldset')?.getAttribute('role'),
    'radiogroup'
  );
  assert.equal(queryAllByRole(root, 'radio').length, 3);
  assert.equal(getByRole(root, 'radio', { name: 'No' }).checked, true);
  fireEvent(getByRole(root, 'radio', { name: 'Yes' }), 'change');
  assert.deepEqual(answers, [{ questionId: 'q1', value: 'Yes' }]);
});

test('Question ignores single-choice edits in read-only mode and non-string current values', () => {
  /** @type {any[]} */
  const answers = [];
  const root = rootOf(
    Question({
      question: YES_NO,
      currentValue: /** @type {any} */ (['Yes']),
      access: 'read-only',
      onAnswer: (answer) => answers.push(answer),
    })
  );
  const yes = getByRole(root, 'radio', { name: 'Yes' });
  assert.equal(yes.checked, false);
  assert.equal(yes.disabled, true);
  fireEvent(yes, 'change');
  assert.deepEqual(answers, []);
});

test('Question multi-choice adds and removes values while keeping N/A exclusive', () => {
  /** @type {any[]} */
  const answers = [];
  let root = rootOf(
    Question({
      question: MULTI,
      currentValue: ['A', 'B'],
      access: 'edit',
      onAnswer: (answer) => answers.push(answer),
    })
  );
  const na = getByRole(root, 'checkbox', { name: 'NA' });
  na.checked = true;
  fireEvent(na, 'change');
  root = rootOf(
    Question({
      question: MULTI,
      currentValue: ['NA'],
      access: 'edit',
      onAnswer: (answer) => answers.push(answer),
    })
  );
  const a = getByRole(root, 'checkbox', { name: 'A' });
  a.checked = true;
  fireEvent(a, 'change');
  const nextNa = getByRole(root, 'checkbox', { name: 'NA' });
  nextNa.checked = false;
  fireEvent(nextNa, 'change');
  assert.deepEqual(
    answers.map((answer) => answer.value),
    [['NA'], ['A'], []]
  );
});

test('Question multi-choice ignores read-only edits and non-array current values', () => {
  /** @type {any[]} */
  const answers = [];
  const root = rootOf(
    Question({
      question: MULTI,
      currentValue: /** @type {any} */ ('A'),
      access: 'read-only',
      onAnswer: (answer) => answers.push(answer),
    })
  );
  const a = getByRole(root, 'checkbox', { name: 'A' });
  assert.equal(a.checked, false);
  fireEvent(a, 'change');
  assert.deepEqual(answers, []);
});

test('Question gives long single-choice and outcome wording the stacked layout', () => {
  for (const responseType of ['single-choice', 'outcome']) {
    const [fieldset] = Question({
      question: /** @type {any} */ ({
        ...YES_NO,
        responseType,
        options: [
          'Short',
          'This option is deliberately longer than forty characters for layout',
        ],
      }),
      currentValue: '',
      access: 'edit',
      onAnswer() {},
    });
    assert.equal(
      /** @type {HTMLElement} */ (fieldset).className,
      'cora-question cora-question-options-long'
    );
  }
});

test('renderSelectedRemediation replaces content with selected actions and free-form text', () => {
  const container = document.createElement('div');
  renderSelectedRemediation(container, ['Retrain.', 'Coach.'], 'Escalate.');
  assert.match(
    container.textContent,
    /Selected remediationRetrain\.Coach\.Escalate\./
  );
  renderSelectedRemediation(container, [], '');
  assert.equal(container.childElementCount, 0);
});

test('renderSelectedRemediation handles actions-only and free-form-only displays', () => {
  const container = document.createElement('div');
  renderSelectedRemediation(container, ['Retrain.'], '');
  assert.equal(container.querySelectorAll('li').length, 1);
  renderSelectedRemediation(container, [], 'Escalate.');
  assert.equal(container.querySelectorAll('li').length, 0);
  assert.match(container.textContent, /Escalate/);
  renderSelectedRemediation(
    container,
    /** @type {any} */ (null),
    /** @type {any} */ (null)
  );
  assert.equal(container.childElementCount, 0);
});
