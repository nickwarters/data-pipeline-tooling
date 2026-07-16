// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAQuestionList, QuestionList, currentGroupVerdict } =
  await import('../src/components/collections/cora-question-list.js');

test('QuestionList: composes question hosts in catalogue order', () => {
  const questions = [
    {
      id: 'q2',
      text: 'Second first',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
    {
      id: 'q1',
      text: 'First second',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const elements = QuestionList({
    questions,
    answers: {},
    access: 'edit',
  });

  assert.deepEqual(
    elements.map((qEl) => qEl.question?.id),
    ['q2', 'q1']
  );
});

test('QuestionList: reuses existing question hosts by id', () => {
  const questions = [
    {
      id: 'q1',
      text: 'First',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
    {
      id: 'q2',
      text: 'Second',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const initial = QuestionList({
    questions,
    answers: {},
    access: 'edit',
  });
  const updated = QuestionList({
    questions,
    answers: { q1: { value: 'No' } },
    access: 'read-only',
    existing: initial,
  });

  assert.equal(updated[0], initial[0]);
  assert.equal(updated[1], initial[1]);
  assert.equal(updated[0].currentValue, 'No');
  assert.equal(updated[0].access, 'read-only');
});

test('QuestionList: defaults unanswered multi-choice questions to an empty array', () => {
  const [element] = QuestionList({
    questions: [
      {
        id: 'q-multi',
        text: 'Products?',
        responseType: /** @type {const} */ ('multi-choice'),
        options: ['A', 'B'],
        deprecated: false,
      },
    ],
    answers: {},
    access: 'edit',
  });

  assert.deepEqual(element.currentValue, []);
});

test('CORAQuestionList: renders questions in the provided catalogue order', () => {
  const questions = [
    {
      id: 'q2',
      text: 'Second first',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
    {
      id: 'q1',
      text: 'First second',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const el = new CORAQuestionList();
  el.update(questions, {});

  assert.deepEqual(
    el.questionElements.map((qEl) => qEl.question?.id),
    ['q2', 'q1']
  );
});

test('QuestionList: composed question hosts dispatch answer events', () => {
  const el = new CORAQuestionList();
  el.update(
    [
      {
        id: 'q1',
        text: 'First',
        responseType: /** @type {const} */ ('yes-no-na'),
        deprecated: false,
      },
    ],
    {}
  );

  /** @type {unknown} */
  let detail;
  el.questionElements[0].dispatchEvent = (event) => {
    detail = /** @type {CustomEvent} */ (event).detail;
    return true;
  };

  const input = /** @type {any} */ (
    el.questionElements[0].querySelector('[data-focus-key="answer:q1:1"]')
  );
  input._listeners.change[0]({
    target: input,
  });

  assert.deepEqual(detail, { questionId: 'q1', value: 'No' });
});

// ===== TWO-LEVEL GROUPING + GROUP VERDICT (#390) =====

const GROUPED_QUESTIONS = /** @type {any[]} */ ([
  {
    id: 'g1',
    text: 'G1',
    category: 'Handling',
    questionGroup: 'Acknowledgement',
    responseType: 'outcome',
    options: ['Pass', 'Fail'],
    optionOutcomes: { Pass: 'pass', Fail: 'fail' },
    deprecated: false,
  },
  {
    id: 'g2',
    text: 'G2',
    category: 'Handling',
    questionGroup: 'Acknowledgement',
    responseType: 'yes-no-na',
    deprecated: false,
  },
  {
    id: 'g3',
    text: 'G3',
    category: 'Treatment',
    questionGroup: 'Resolution',
    responseType: 'yes-no-na',
    deprecated: false,
  },
]);

const OUTCOMES = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

/** @param {Partial<any>} [props] */
function mountGrouped(props = {}) {
  const el = new CORAQuestionList();
  el.questions = GROUPED_QUESTIONS;
  el.answers = {};
  Object.assign(el, props);
  el.connectedCallback();
  return el;
}

test('CORAQuestionList: renders category headings with nested group headings', () => {
  const el = mountGrouped();
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const classNames = children.map((c) => c.className ?? '');
  assert.deepEqual(classNames, [
    'cora-question-category-heading',
    'cora-question-group-heading',
    '', // g1 host
    '', // g2 host
    'cora-question-category-heading',
    'cora-question-group-heading',
    '', // g3 host
  ]);
  assert.equal(children[0].textContent, 'Handling');
  assert.equal(children[1]._children[0].textContent, 'Acknowledgement');
});

test('CORAQuestionList: no category on any question → no category headings', () => {
  const el = mountGrouped({
    questions: GROUPED_QUESTIONS.map((q) => {
      const { category: _drop, ...rest } = q;
      return rest;
    }),
  });
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  assert.ok(
    !children.some((c) => c.className === 'cora-question-category-heading')
  );
  assert.equal(
    children.filter((c) => c.className === 'cora-question-group-heading')
      .length,
    2
  );
});

test('CORAQuestionList: flat questions render no headings at all', () => {
  const el = mountGrouped({
    questions: [
      { id: 'p1', text: 'P1', responseType: 'yes-no-na', deprecated: false },
    ],
  });
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  assert.equal(children.length, 1);
});

test('CORAQuestionList: heading nodes are reused across updates (no churn)', () => {
  const el = mountGrouped();
  const first = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  el.update(GROUPED_QUESTIONS, { g2: { value: 'Yes' } });
  const second = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  assert.equal(first[0], second[0]);
  assert.equal(first[1], second[1]);
});

test('CORAQuestionList: configured group shows a verdict control listing outcomes + N/A', () => {
  const el = mountGrouped({
    questionGroups: { Acknowledgement: { allowBulkOutcome: true } },
    outcomeOptions: OUTCOMES,
  });
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const ackHeading = children[1];
  const verdict = ackHeading._verdictSelect;
  assert.ok(verdict, 'configured group should carry a verdict select');
  const optionValues = verdict._children.map((/** @type {any} */ o) => o.value);
  assert.deepEqual(optionValues, ['', 'Pass', 'Fail', 'NA']);
  // The unconfigured group shows no control.
  const resHeading = children[5];
  assert.equal(resHeading._verdictSelect, undefined);
});

test('CORAQuestionList: read-only access shows no verdict control', () => {
  const el = mountGrouped({
    access: 'read-only',
    questionGroups: { Acknowledgement: { allowBulkOutcome: true } },
    outcomeOptions: OUTCOMES,
  });
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  assert.equal(children[1]._verdictSelect, undefined);
});

test('CORAQuestionList: selecting a verdict dispatches cora-group-verdict', () => {
  const el = mountGrouped({
    questionGroups: { Acknowledgement: { allowBulkOutcome: true } },
    outcomeOptions: OUTCOMES,
  });
  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (/** @type {any} */ e) => {
    events.push(e);
    return true;
  };
  const verdict = /** @type {any} */ (el)._children[1]._verdictSelect;
  verdict._listeners['change'][0]({ target: { value: 'Fail' } });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'cora-group-verdict');
  assert.deepEqual(events[0].detail, {
    group: 'Acknowledgement',
    value: 'Fail',
  });
});

test('CORAQuestionList: selecting the placeholder dispatches nothing', () => {
  const el = mountGrouped({
    questionGroups: { Acknowledgement: { allowBulkOutcome: true } },
    outcomeOptions: OUTCOMES,
  });
  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (/** @type {any} */ e) => {
    events.push(e);
    return true;
  };
  const verdict = /** @type {any} */ (el)._children[1]._verdictSelect;
  verdict._listeners['change'][0]({ target: { value: '' } });
  assert.equal(events.length, 0);
});

test('currentGroupVerdict: shared outcome answer across the group is reflected', () => {
  const group = GROUPED_QUESTIONS.filter(
    (q) => q.questionGroup === 'Acknowledgement'
  );
  assert.equal(currentGroupVerdict(group, { g1: { value: 'Fail' } }), 'Fail');
});

test('currentGroupVerdict: unanswered or divergent outcome answers show no verdict', () => {
  const two = /** @type {any[]} */ ([
    { id: 'o1', responseType: 'outcome', deprecated: false },
    { id: 'o2', responseType: 'outcome', deprecated: false },
  ]);
  assert.equal(currentGroupVerdict(two, {}), '');
  assert.equal(
    currentGroupVerdict(two, { o1: { value: 'Pass' }, o2: { value: 'Fail' } }),
    ''
  );
  assert.equal(currentGroupVerdict(two, { o1: { value: ['x'] } }), '');
});

test('currentGroupVerdict: a group with no outcome-type questions shows no verdict', () => {
  const group = /** @type {any[]} */ ([
    { id: 'y1', responseType: 'yes-no-na', deprecated: false },
  ]);
  assert.equal(currentGroupVerdict(group, { y1: { value: 'Yes' } }), '');
});

test('CORAQuestionList: verdict select value tracks the shared group answer', () => {
  const el = mountGrouped({
    questionGroups: { Acknowledgement: { allowBulkOutcome: true } },
    outcomeOptions: OUTCOMES,
  });
  el.update(GROUPED_QUESTIONS, { g1: { value: 'Pass' } });
  const verdict = /** @type {any} */ (el)._children[1]._verdictSelect;
  assert.equal(verdict.value, 'Pass');
});
