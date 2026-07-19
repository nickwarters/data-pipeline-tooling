// @ts-check
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findAllByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { createQuestionPanelView, questionGroupsOf } =
  await import('../src/pages/cora-case-review/question-panel-view.js');
const { morph } = await import('../src/core/morph.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @param {string} id @param {string} group @returns {QuestionDefinition} */
function question(id, group) {
  return {
    id,
    text: `Question ${id}`,
    questionGroup: group,
    responseType: 'yes-no-na',
    deprecated: false,
  };
}

function props(overrides = {}) {
  const catalogue = [question('q1', 'Identity'), question('q2', 'Conduct')];
  return {
    catalogue,
    questions: catalogue,
    answers: {},
    activeGroup: 'Identity',
    access: /** @type {const} */ ('edit'),
    heading: 'Questions',
    outcomeOptions: [],
    onAnswer() {},
    onGroupSelected() {},
    ...overrides,
  };
}

test('CASE-2 Questions view mounts only the active Question Group and reports progress', () => {
  const view = createQuestionPanelView();
  const node = view.render(
    props({ answers: { q1: { value: 'Yes' }, q2: { value: 'No' } } })
  );

  assert.deepEqual(questionGroupsOf(props().questions), [
    'Identity',
    'Conduct',
  ]);
  assert.equal(findAllByClass(node, 'cora-question-card').length, 1);
  assert.match(node.textContent, /Identity 1\/1/);
  assert.match(node.textContent, /Conduct 1\/1/);
  assert.match(node.textContent, /Question q1/);
  assert.doesNotMatch(node.textContent, /Question q2/);
});

test('CASE-2 Questions view memoises unchanged cards by Answer, applicability, labels, and access', () => {
  const view = createQuestionPanelView();
  const answer = { value: 'Yes' };
  const first = view.render(props({ answers: { q1: answer } }));
  const firstCard = findAllByClass(first, 'cora-question-card')[0];
  const second = view.render(props({ answers: { q1: answer } }));
  const secondCard = findAllByClass(second, 'cora-question-card')[0];

  assert.equal(secondCard, firstCard);
  assert.equal(view.cacheSize, 1);

  const changed = view.render(props({ answers: { q1: { value: 'No' } } }));
  assert.notEqual(findAllByClass(changed, 'cora-question-card')[0], firstCard);
  view.clear();
  assert.equal(view.cacheSize, 0);
});

test('CASE-2 answer re-renders preserve the focused native control without snapshots', () => {
  const view = createQuestionPanelView();
  const container = document.createElement('div');
  morph(container, view.render(props({ answers: { q1: { value: 'No' } } })));
  const input = container.querySelector('[data-focus-key="answer:q1:0"]');
  assert.ok(input);
  /** @type {HTMLElement} */ (input).focus();

  morph(container, view.render(props({ answers: { q1: { value: 'Yes' } } })));

  assert.equal(
    container.querySelector('[data-focus-key="answer:q1:0"]'),
    input
  );
  assert.equal(document.activeElement, input);
});

test('CASE-2 Questions view switches groups, evicts unmounted cards, and falls back from a stale group', () => {
  /** @type {string[]} */
  const selected = [];
  const view = createQuestionPanelView();
  const first = view.render(
    props({
      activeGroup: 'Missing',
      onGroupSelected: (/** @type {string} */ group) => selected.push(group),
    })
  );
  assert.equal(
    first
      .querySelector('.cora-question-group-panel')
      ?.getAttribute('data-question-group'),
    'Identity'
  );
  fireEvent(first.querySelectorAll('button')[1], 'click');
  assert.deepEqual(selected, ['Conduct']);

  const second = view.render(props({ activeGroup: 'Conduct' }));
  assert.match(second.textContent, /Question q2/);
  assert.doesNotMatch(second.textContent, /Question q1/);
  assert.equal(view.cacheSize, 1, 'the inactive group card was evicted');

  const empty = view.render(
    props({ catalogue: [], questions: [], activeGroup: '' })
  );
  assert.equal(findAllByClass(empty, 'cora-question-card').length, 0);

  const pendingCatalogue = view.render(
    props({ catalogue: [], questions: [question('q-new', 'New')] })
  );
  assert.match(pendingCatalogue.textContent, /New 0\/0/);
});

test('CASE-2 question cards dispatch single and exclusive multi-choice Answers', () => {
  /** @type {{questionId: string, value: string|string[]}[]} */
  const calls = [];
  const single = createQuestionPanelView().render(
    props({
      onAnswer: (
        /** @type {string} */ questionId,
        /** @type {string|string[]} */ value
      ) => calls.push({ questionId, value }),
    })
  );
  fireEvent(single.querySelectorAll('input')[0], 'change');

  const multiQuestion = {
    ...question('multi', 'Identity'),
    responseType: /** @type {const} */ ('multi-choice'),
    options: ['Email', 'Phone'],
  };
  const multi = createQuestionPanelView().render(
    props({
      catalogue: [multiQuestion],
      questions: [multiQuestion],
      answers: { multi: { value: ['Email'] } },
      onAnswer: (
        /** @type {string} */ questionId,
        /** @type {string|string[]} */ value
      ) => calls.push({ questionId, value }),
    })
  );
  const inputs = multi.querySelectorAll('input');
  inputs[0].checked = false;
  fireEvent(inputs[0], 'change');
  inputs[1].checked = true;
  fireEvent(inputs[1], 'change');
  const na = inputs[inputs.length - 1];
  assert.ok(na);
  na.checked = true;
  fireEvent(na, 'change');

  assert.deepEqual(calls, [
    { questionId: 'q1', value: 'Yes' },
    { questionId: 'multi', value: [] },
    { questionId: 'multi', value: ['Email', 'Phone'] },
    { questionId: 'multi', value: ['NA'] },
  ]);

  const unansweredMulti = createQuestionPanelView().render(
    props({
      catalogue: [multiQuestion],
      questions: [multiQuestion],
      answers: {},
    })
  );
  assert.equal(
    Array.from(unansweredMulti.querySelectorAll('input')).some(
      (input) => input.checked
    ),
    false
  );
});

test('CASE-2 question cards preserve remediation display and enforce read-only access', () => {
  /** @type {{questionId: string, value: string|string[]}[]} */
  const calls = [];
  const failing = {
    ...question('failed', 'Identity'),
    failureValues: ['No'],
  };
  const node = createQuestionPanelView().render(
    props({
      catalogue: [failing],
      questions: [failing],
      answers: {
        failed: {
          value: 'No',
          remediationActions: [
            { id: 'r1', text: 'Call the customer', completed: false },
          ],
          freeFormRemediation: 'Refund the fee',
        },
      },
      access: /** @type {const} */ ('read-only'),
      onAnswer: (
        /** @type {string} */ questionId,
        /** @type {string|string[]} */ value
      ) => calls.push({ questionId, value }),
    })
  );
  const input = node.querySelectorAll('input')[0];
  assert.equal(input.disabled, true);
  fireEvent(input, 'change');
  assert.deepEqual(calls, []);
  assert.match(node.textContent, /Call the customer/);
  assert.match(node.textContent, /Refund the fee/);

  const noRemediation = createQuestionPanelView().render(
    props({
      catalogue: [failing],
      questions: [failing],
      answers: { failed: { value: 'No' } },
    })
  );
  assert.equal(
    findAllByClass(noRemediation, 'cora-question-remediation').length,
    0
  );
});

test('CASE-2 real Questions view keeps the 500-question steady-state median within the five millisecond gate', () => {
  const catalogue = Array.from({ length: 500 }, (_, index) =>
    question(
      `q-${String(index + 1).padStart(3, '0')}`,
      `Group ${String(Math.floor(index / 25) + 1).padStart(2, '0')}`
    )
  );
  const view = createQuestionPanelView();
  const base = props({
    catalogue,
    questions: catalogue,
    activeGroup: 'Group 01',
  });
  view.render(base);

  const samples = [];
  for (let index = 0; index < 25; index += 1) {
    const started = performance.now();
    view.render({
      ...base,
      answers: { 'q-001': { value: index % 2 ? 'Yes' : 'No' } },
    });
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];

  assert.ok(
    median <= 5,
    `500-question group-scoped steady-state median was ${median.toFixed(3)} ms`
  );
});
