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
    access: /** @type {const} */ ('edit'),
    heading: 'Questions',
    onAnswer() {},
    ...overrides,
  };
}

test('CASE-2 Questions view mounts every applicable Question Group in one grouped list', () => {
  const view = createQuestionPanelView();
  const node = view.render(
    props({ answers: { q1: { value: 'Yes' }, q2: { value: 'No' } } })
  );

  assert.deepEqual(questionGroupsOf(props().questions), [
    'Identity',
    'Conduct',
  ]);
  // Both groups' cards render together — this is a scrolling list, not tabs.
  assert.equal(findAllByClass(node, 'cora-question-card').length, 2);
  assert.match(node.textContent, /Question q1/);
  assert.match(node.textContent, /Question q2/);
  // Each Question Group gets a heading acting as a scroll anchor.
  const groupHeadings = Array.from(
    node.querySelectorAll('.cora-question-group-heading')
  );
  assert.equal(groupHeadings.length, 2);
  assert.deepEqual(
    groupHeadings.map((el) => el.getAttribute('data-qgroup')),
    ['Identity', 'Conduct']
  );
});

test('CASE-2 Questions view renders a Question Group progress side panel that tracks answered/total', () => {
  const view = createQuestionPanelView();
  const node = view.render(props({ answers: { q1: { value: 'Yes' } } }));

  const panel = node.querySelector('.cora-group-progress');
  assert.ok(panel, 'the sticky progress side panel is present');
  const rows = node.querySelectorAll('.cora-group-progress-row');
  assert.equal(rows.length, 2);
  // Identity answered (1/1) is marked complete; Conduct (0/1) is not.
  assert.match(rows[0].textContent, /Identity/);
  assert.match(rows[0].textContent, /1\/1/);
  assert.ok(rows[0].className.includes('complete'));
  assert.match(rows[1].textContent, /Conduct/);
  assert.match(rows[1].textContent, /0\/1/);
  assert.ok(!rows[1].className.includes('complete'));

  // The panel updates as the review progresses.
  const advanced = view.render(
    props({ answers: { q1: { value: 'Yes' }, q2: { value: 'No' } } })
  );
  const advancedRows = advanced.querySelectorAll('.cora-group-progress-row');
  assert.match(advancedRows[1].textContent, /1\/1/);
  assert.ok(advancedRows[1].className.includes('complete'));
});

test('CASE-2 progress side panel jumps to a group and to the next unanswered question', () => {
  const view = createQuestionPanelView();
  const node = view.render(props({ answers: { q1: { value: 'Yes' } } }));

  // Clicking a group row scrolls its anchor into view; clicking "Jump to next
  // unanswered" scrolls the first unanswered card into view.
  const conductAnchor = /** @type {any} */ (
    Array.from(node.querySelectorAll('.cora-question-group-heading')).find(
      (el) => el.getAttribute('data-qgroup') === 'Conduct'
    )
  );
  const conductCard = /** @type {any} */ (
    node.querySelectorAll('.cora-question-card')[1]
  );
  let anchorScrolled = false;
  let cardScrolled = false;
  conductAnchor.scrollIntoView = () => {
    anchorScrolled = true;
  };
  conductCard.scrollIntoView = () => {
    cardScrolled = true;
  };

  fireEvent(node.querySelectorAll('.cora-group-progress-row')[1], 'click');
  assert.equal(anchorScrolled, true, 'group row jumps to the group anchor');

  fireEvent(node.querySelector('.cora-jump-unanswered-btn'), 'click');
  assert.equal(
    cardScrolled,
    true,
    'jump-unanswered scrolls the first unanswered card'
  );
});

test('CASE-2 jump-to-next-unanswered is inert when every question is answered', () => {
  const view = createQuestionPanelView();
  const node = view.render(
    props({ answers: { q1: { value: 'Yes' }, q2: { value: 'No' } } })
  );
  // No unanswered card exists; the handler must no-op without throwing.
  assert.doesNotThrow(() =>
    fireEvent(node.querySelector('.cora-jump-unanswered-btn'), 'click')
  );
});

test('CASE-2 Questions view renders category headings above their Question Groups when declared', () => {
  const catalogue = [
    { ...question('q1', 'Identity'), category: 'Onboarding' },
    { ...question('q2', 'Conduct'), category: 'Onboarding' },
    { ...question('q3', 'Closure'), category: 'Exit' },
  ];
  const node = createQuestionPanelView().render(
    props({ catalogue, questions: catalogue })
  );
  const categories = Array.from(
    node.querySelectorAll('.cora-question-category-heading')
  );
  assert.deepEqual(
    categories.map((el) => el.textContent),
    ['Onboarding', 'Exit']
  );
});

test('CASE-2 Questions view stacks only sentence-length single-choice and Outcome options', () => {
  for (const responseType of ['single-choice', 'outcome']) {
    const longChoice = {
      ...question(`long-${responseType}`, 'Identity'),
      responseType,
      options: [
        'Short',
        'This option is deliberately longer than forty characters for layout',
      ],
    };
    const node = createQuestionPanelView().render(
      props({ catalogue: [longChoice], questions: [longChoice] })
    );

    assert.equal(
      node.querySelector('fieldset')?.className,
      'cora-question cora-question-options-long'
    );
  }

  const longChoice = {
    ...question('short-choice', 'Identity'),
    responseType: /** @type {const} */ ('single-choice'),
  };
  const shortChoice = {
    ...longChoice,
    options: ['A', 'B'],
  };
  const shortNode = createQuestionPanelView().render(
    props({ catalogue: [shortChoice], questions: [shortChoice] })
  );
  assert.equal(shortNode.querySelector('fieldset')?.className, 'cora-question');
});

test('CASE-2 Questions view memoises unchanged cards by rendered inputs', () => {
  const view = createQuestionPanelView();
  const answer = { value: 'Yes' };
  const first = view.render(props({ answers: { q1: answer } }));
  const firstCard = findAllByClass(first, 'cora-question-card')[0];
  const second = view.render(props({ answers: { q1: answer } }));
  const secondCard = findAllByClass(second, 'cora-question-card')[0];

  assert.equal(secondCard, firstCard);
  assert.equal(view.cacheSize, 2);

  const changed = view.render(props({ answers: { q1: { value: 'No' } } }));
  assert.notEqual(findAllByClass(changed, 'cora-question-card')[0], firstCard);
  view.clear();
  assert.equal(view.cacheSize, 0);
});

test('CASE-2 Questions view evicts cached cards for questions that become inapplicable', () => {
  const view = createQuestionPanelView();
  const catalogue = [question('q1', 'Identity'), question('q2', 'Conduct')];
  view.render(props({ catalogue, questions: catalogue }));
  assert.equal(view.cacheSize, 2);

  // q2 no longer applicable → its card is dropped from the memo cache.
  view.render(props({ catalogue, questions: [catalogue[0]] }));
  assert.equal(view.cacheSize, 1);
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
  const base = props({ catalogue, questions: catalogue });
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
    `500-question grouped steady-state median was ${median.toFixed(3)} ms`
  );
});
