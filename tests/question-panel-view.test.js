// @ts-check
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findAllByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { createQuestionPanelView, questionGroupsOf } =
  await import('../src/pages/cora-case-review/question-panel-view.js');
const { render } = await import('../src/core/render.js');

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
    onGroupOutcome() {},
    ...overrides,
  };
}

test('Questions view mounts every applicable Question Group in one grouped list', () => {
  const questionsView = createQuestionPanelView();
  const node = questionsView.view(
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

test('Questions view renders a Question Group progress side panel that tracks answered/total', () => {
  const questionsView = createQuestionPanelView();
  const node = questionsView.view(props({ answers: { q1: { value: 'Yes' } } }));

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
  const advanced = questionsView.view(
    props({ answers: { q1: { value: 'Yes' }, q2: { value: 'No' } } })
  );
  const advancedRows = advanced.querySelectorAll('.cora-group-progress-row');
  assert.match(advancedRows[1].textContent, /1\/1/);
  assert.ok(advancedRows[1].className.includes('complete'));
});

test('progress side panel jumps to a group and to the next unanswered question', () => {
  const questionsView = createQuestionPanelView();
  const node = questionsView.view(props({ answers: { q1: { value: 'Yes' } } }));

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

test('jump-to-next-unanswered is inert when every question is answered', () => {
  const questionsView = createQuestionPanelView();
  const node = questionsView.view(
    props({ answers: { q1: { value: 'Yes' }, q2: { value: 'No' } } })
  );
  // No unanswered card exists; the handler must no-op without throwing.
  assert.doesNotThrow(() =>
    fireEvent(node.querySelector('.cora-jump-unanswered-btn'), 'click')
  );
});

test('Questions view renders category headings above their Question Groups when declared', () => {
  const catalogue = [
    { ...question('q1', 'Identity'), category: 'Onboarding' },
    { ...question('q2', 'Conduct'), category: 'Onboarding' },
    { ...question('q3', 'Closure'), category: 'Exit' },
  ];
  const node = createQuestionPanelView().view(
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

test('Questions view stacks only sentence-length single-choice and Outcome options', () => {
  for (const responseType of ['single-choice', 'outcome']) {
    const longChoice = {
      ...question(`long-${responseType}`, 'Identity'),
      responseType,
      options: [
        'Short',
        'This option is deliberately longer than forty characters for layout',
      ],
    };
    const node = createQuestionPanelView().view(
      props({ catalogue: [longChoice], questions: [longChoice] })
    );

    assert.equal(
      node.querySelector('fieldset')?.className,
      'cora-question cora-question-options-long'
    );
  }

  const baseChoice = {
    ...question('short-choice', 'Identity'),
    responseType: /** @type {const} */ ('single-choice'),
  };
  const shortChoice = {
    ...baseChoice,
    options: ['A', 'B'],
  };
  const shortNode = createQuestionPanelView().view(
    props({ catalogue: [shortChoice], questions: [shortChoice] })
  );
  assert.equal(shortNode.querySelector('fieldset')?.className, 'cora-question');
});

test('Questions view memoises unchanged cards by rendered inputs', () => {
  const questionsView = createQuestionPanelView();
  const answer = { value: 'Yes' };
  const first = questionsView.view(props({ answers: { q1: answer } }));
  const firstCard = findAllByClass(first, 'cora-question-card')[0];
  const second = questionsView.view(props({ answers: { q1: answer } }));
  const secondCard = findAllByClass(second, 'cora-question-card')[0];

  assert.equal(secondCard, firstCard);
  assert.equal(questionsView.cacheSize, 2);

  const changed = questionsView.view(
    props({ answers: { q1: { value: 'No' } } })
  );
  assert.notEqual(findAllByClass(changed, 'cora-question-card')[0], firstCard);
  questionsView.clear();
  assert.equal(questionsView.cacheSize, 0);
});

test('Questions view evicts cached cards for questions that become inapplicable', () => {
  const questionsView = createQuestionPanelView();
  const catalogue = [question('q1', 'Identity'), question('q2', 'Conduct')];
  questionsView.view(props({ catalogue, questions: catalogue }));
  assert.equal(questionsView.cacheSize, 2);

  // q2 no longer applicable → its card is dropped from the memo cache.
  questionsView.view(props({ catalogue, questions: [catalogue[0]] }));
  assert.equal(questionsView.cacheSize, 1);
});

test('answer re-renders preserve the focused native control without snapshots', () => {
  const questionsView = createQuestionPanelView();
  const container = document.createElement('div');
  render(
    container,
    questionsView.view(props({ answers: { q1: { value: 'No' } } }))
  );
  const input = container.querySelector('[data-focus-key="answer:q1:0"]');
  assert.ok(input);
  /** @type {HTMLElement} */ (input).focus();

  render(
    container,
    questionsView.view(props({ answers: { q1: { value: 'Yes' } } }))
  );

  assert.equal(
    container.querySelector('[data-focus-key="answer:q1:0"]'),
    input
  );
  assert.equal(document.activeElement, input);
});

test('question cards dispatch single and exclusive multi-choice Answers', () => {
  /** @type {{questionId: string, value: string|string[]}[]} */
  const calls = [];
  const single = createQuestionPanelView().view(
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
  const multi = createQuestionPanelView().view(
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

  const unansweredMulti = createQuestionPanelView().view(
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

test('question cards preserve remediation display and enforce read-only access', () => {
  /** @type {{questionId: string, value: string|string[]}[]} */
  const calls = [];
  const failing = {
    ...question('failed', 'Identity'),
    failureValues: ['No'],
  };
  const node = createQuestionPanelView().view(
    props({
      catalogue: [failing],
      questions: [failing],
      answers: {
        failed: {
          value: 'No',
          remediationActions: [{ id: 'r1', text: 'Call the customer' }],
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

  const noRemediation = createQuestionPanelView().view(
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

test('real Questions view answers one of 500 Questions by rebuilding one card, not the list', (t) => {
  const catalogue = Array.from({ length: 500 }, (_, index) =>
    question(
      `q-${String(index + 1).padStart(3, '0')}`,
      `Group ${String(Math.floor(index / 25) + 1).padStart(2, '0')}`
    )
  );
  const base = props({ catalogue, questions: catalogue });

  // The deterministic half of the contract: answering `q-001` rebuilds that one
  // card and reuses the node of every other Question in the bank.
  const questionsView = createQuestionPanelView();
  const before = findAllByClass(questionsView.view(base), 'cora-question-card');
  const after = findAllByClass(
    questionsView.view({ ...base, answers: { 'q-001': { value: 'Yes' } } }),
    'cora-question-card'
  );
  assert.equal(before.length, 500);
  assert.equal(after.length, 500);
  assert.notEqual(after[0], before[0], 'the answered card is rebuilt');
  const reused = after.filter((card, index) => card === before[index]);
  assert.equal(reused.length, 499, 'every untouched card keeps its node');

  // The timing half is a *ratio*, not a wall-clock budget. What memoisation
  // buys is that answering one Question rebuilds one card instead of 500, so
  // the honest regression signal is "an answer costs a fraction of a cold
  // render" — and a fraction is the same number on a fast laptop and a loaded
  // CI box. The absolute 5 ms budget this replaced measured the hardware as
  // much as the code: the same failure mode already fixed in
  // tests/question-bank-slice.test.js.
  //
  // A cold render — fresh view, fresh memo, every card built — is the cost of
  // no memoisation at all, i.e. exactly what a regression here would look like.
  const coldSamples = [];
  for (let index = 0; index < 20; index += 1) {
    const coldView = createQuestionPanelView();
    const started = performance.now();
    coldView.view(base);
    if (index >= 5) coldSamples.push(performance.now() - started);
  }

  const answerSamples = [];
  for (let index = 0; index < 60; index += 1) {
    const next = {
      ...base,
      answers: { 'q-001': { value: index % 2 ? 'Yes' : 'No' } },
    };
    const started = performance.now();
    questionsView.view(next);
    if (index >= 10) answerSamples.push(performance.now() - started);
  }

  /** @param {number[]} values */
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const answerMedian = median(answerSamples);
  const coldMedian = median(coldSamples);
  const ratio = answerMedian / coldMedian;
  t.diagnostic(
    `500-question answer median ${answerMedian.toFixed(2)} ms vs cold ${coldMedian.toFixed(2)} ms (${(ratio * 100).toFixed(2)}%)`
  );
  // Memoised, an answer measures 2-3% of a cold render — the residue is the
  // per-render work that is not memoised (group progress, the unanswered
  // filter, the group anchors). With the card memo defeated it measures
  // 87-99%. 20% sits ~7x above the observed value and ~4x below the mildest
  // observed regression, which is about as evenly as the two can be split.
  assert.ok(
    ratio <= 0.2,
    `answering one of 500 Questions cost ${(ratio * 100).toFixed(2)}% of a full rebuild (${answerMedian.toFixed(2)} ms vs ${coldMedian.toFixed(2)} ms) — memoisation is not holding`
  );
});

// --- Group Outcome ----------------------------------------------------------

/** @param {string} id @param {string} group @returns {QuestionDefinition} */
function outcomeQuestion(id, group) {
  return {
    id,
    text: `Question ${id}`,
    questionGroup: group,
    responseType: 'outcome',
    options: ['Good', 'Poor'],
    deprecated: false,
  };
}

/** @param {any} overrides */
function outcomeProps(overrides = {}) {
  const catalogue = [
    outcomeQuestion('o1', 'Alpha'),
    outcomeQuestion('o2', 'Alpha'),
    question('q1', 'Beta'),
  ];
  return props({
    catalogue,
    questions: catalogue,
    questionGroups: { Alpha: { allowBulkOutcome: true } },
    ...overrides,
  });
}

/** @param {any} props */
function outcomeControls(props) {
  return findAllByClass(
    createQuestionPanelView().view(props),
    'cora-group-outcome'
  );
}

test('a Question Group renders no outcome control unless the Case Type opts it in', () => {
  assert.equal(
    outcomeControls(outcomeProps({ questionGroups: undefined })).length,
    0
  );
  assert.equal(
    outcomeControls(outcomeProps({ questionGroups: { Alpha: {} } })).length,
    0,
    'a named group that did not ask for bulk marking gets no control'
  );
  assert.equal(
    outcomeControls(
      outcomeProps({
        questionGroups: { Alpha: {} },
        allowBulkOutcome: true,
      })
    ).length,
    1,
    'a named group that states nothing falls back to the Case Type, rather than reading as an opt-out'
  );
});

test('a Case Type can opt every Question Group in at once', () => {
  const catalogue = [
    outcomeQuestion('o1', 'Alpha'),
    outcomeQuestion('o2', 'Beta'),
  ];
  assert.equal(
    outcomeControls(
      outcomeProps({
        catalogue,
        questions: catalogue,
        questionGroups: undefined,
        allowBulkOutcome: true,
      })
    ).length,
    2
  );
});

test('a Question Group can opt out of a Case Type that opted every group in', () => {
  const catalogue = [
    outcomeQuestion('o1', 'Alpha'),
    outcomeQuestion('o2', 'Beta'),
  ];
  const controls = outcomeControls(
    outcomeProps({
      catalogue,
      questions: catalogue,
      questionGroups: { Beta: { allowBulkOutcome: false } },
      allowBulkOutcome: true,
    })
  );

  assert.equal(controls.length, 1);
  assert.equal(
    controls[0].getAttribute('aria-label'),
    'Group outcome for Alpha',
    'the group that did not opt out is the one that keeps its control'
  );
});

test('the outcome control renders once, in the opted-in group heading only', () => {
  const node = createQuestionPanelView().view(outcomeProps());
  const headings = Array.from(
    node.querySelectorAll('.cora-question-group-heading')
  );

  assert.equal(findAllByClass(node, 'cora-group-outcome').length, 1);
  assert.equal(headings[0].getAttribute('data-qgroup'), 'Alpha');
  assert.equal(findAllByClass(headings[0], 'cora-group-outcome').length, 1);
  assert.equal(
    findAllByClass(headings[1], 'cora-group-outcome').length,
    0,
    'a sibling group is unaffected'
  );
});

test('a Reviewer who cannot edit gets no outcome control', () => {
  assert.equal(
    outcomeControls(outcomeProps({ access: 'read-only' })).length,
    0
  );
});

test('an opted-in group with no Outcome Question gets no outcome control', () => {
  const catalogue = [question('q1', 'Alpha')];
  assert.equal(
    outcomeControls(outcomeProps({ catalogue, questions: catalogue })).length,
    0
  );
});

test('choosing a wording reports one outcome for that group', () => {
  /** @type {any[]} */
  const calls = [];
  const node = createQuestionPanelView().view(
    outcomeProps({
      onGroupOutcome: (/** @type {any[]} */ ...args) => calls.push(args),
    })
  );
  const select = findAllByClass(node, 'cora-group-outcome')[0];

  select.value = 'Poor';
  fireEvent(select, 'change');

  assert.deepEqual(calls, [['Alpha', 'Poor']]);
});
