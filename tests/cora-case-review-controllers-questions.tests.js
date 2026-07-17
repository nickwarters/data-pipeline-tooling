// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireEvent } from './helpers/semantic-dom.js';
import {
  QUESTIONS,
  RecordingEl,
  bindQuestionPanel,
  collectUnansweredQuestions,
  makeQuestionContext,
  updateQuestionPanel,
} from './helpers/cora-case-review-controllers.js';

// Capability: question-panel binding and rendering.

test('bindQuestionPanel: forwards answer and jump events to the view model and visible questions', () => {
  const { context, questionsPanel, questionList, answerCalls } =
    makeQuestionContext();
  const generalQuestionEl = new RecordingEl();
  /** @type {any} */ (generalQuestionEl).question = { id: 'q-b' };
  const unansweredQuestionEl = new RecordingEl();
  /** @type {any} */ (unansweredQuestionEl).question = {
    id: 'q-c',
    questionGroup: 'Basics',
  };
  const answeredQuestionEl = new RecordingEl();
  /** @type {any} */ (answeredQuestionEl).question = {
    id: 'q-a',
    questionGroup: 'Basics',
  };
  /** @type {any} */ (questionList).questionElements = [
    answeredQuestionEl,
    generalQuestionEl,
    unansweredQuestionEl,
  ];

  bindQuestionPanel(/** @type {any} */ (context));

  questionsPanel._listeners['cora-answer'][0]({
    detail: { questionId: 'q-a', value: 'No' },
  });
  questionsPanel._listeners['cora-group-jump'][0]({
    detail: { group: 'General' },
  });
  questionsPanel._listeners['cora-jump-unanswered'][0]();

  assert.deepEqual(answerCalls, [{ questionId: 'q-a', value: 'No' }]);
  assert.equal(generalQuestionEl.scrolled, true);
  assert.equal(unansweredQuestionEl.scrolled, false);
  assert.equal(answeredQuestionEl.scrolled, false);
});

test('collectUnansweredQuestions: preserves empty string and empty array behavior', () => {
  const unanswered = collectUnansweredQuestions({
    questions: QUESTIONS,
    answers: {
      'q-a': { value: 'Yes' },
      'q-b': { value: '' },
      'q-c': { value: [] },
    },
    catalogue: QUESTIONS,
  });

  assert.deepEqual(
    unanswered.map((q) => q.id),
    ['q-b', 'q-c']
  );
});

test('updateQuestionPanel: assigns question list and progress props', () => {
  const { context, questionsPanel, questionList, progress } =
    makeQuestionContext();

  updateQuestionPanel(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (questionList).access, 'edit');
  assert.equal(/** @type {any} */ (questionList).questions, QUESTIONS);
  assert.equal(questionList._updateArgs[0], QUESTIONS);
  assert.equal(progress._updateArgs.length, 2);
  assert.deepEqual(
    progress._updateArgs[1].map(
      (
        /** @type {import('../src/sharepoint-client.js').QuestionDefinition} */ q
      ) => q.id
    ),
    ['q-b', 'q-c']
  );
  assert.equal(questionsPanel._children.length, 3);
  assert.equal(questionsPanel._children[0].textContent, 'Questions');
  assert.equal(questionsPanel._children[1], questionList);
  assert.equal(questionsPanel._children[2], progress);
});

test('updateQuestionPanel: a sectionLabels override renames the Questions panel heading', () => {
  const { context, questionsPanel } = makeQuestionContext();
  /** @type {any} */ (context.viewModel).config.sectionLabels = {
    questions: 'Assessment',
  };

  updateQuestionPanel(/** @type {any} */ (context));

  assert.equal(questionsPanel._children[0].textContent, 'Assessment');
});

test('bindQuestionPanel: cora-group-verdict writes to applicable outcome-type questions only', () => {
  const outcomeQuestions = [
    {
      id: 'q-out-1',
      questionGroup: 'Basics',
      responseType: 'outcome',
      deprecated: false,
    },
    {
      id: 'q-out-2',
      questionGroup: 'Basics',
      responseType: 'outcome',
      deprecated: false,
    },
    {
      id: 'q-yn',
      questionGroup: 'Basics',
      responseType: 'yes-no-na',
      deprecated: false,
    },
    {
      id: 'q-other-group',
      questionGroup: 'Other',
      responseType: 'outcome',
      deprecated: false,
    },
  ];
  const { context, questionsPanel, answerCalls } = makeQuestionContext({
    questions: /** @type {any} */ (outcomeQuestions),
  });

  bindQuestionPanel(/** @type {any} */ (context));
  fireEvent(questionsPanel, 'cora-group-verdict', {
    detail: { group: 'Basics', value: 'Fail' },
  });

  assert.deepEqual(answerCalls, [
    { questionId: 'q-out-1', value: 'Fail' },
    { questionId: 'q-out-2', value: 'Fail' },
  ]);
});

test('bindQuestionPanel: a N/A group verdict also writes only outcome-type questions', () => {
  const outcomeQuestions = [
    {
      id: 'q-out',
      questionGroup: 'G',
      responseType: 'outcome',
      deprecated: false,
    },
    {
      id: 'q-multi',
      questionGroup: 'G',
      responseType: 'multi-choice',
      deprecated: false,
    },
  ];
  const { context, questionsPanel, answerCalls } = makeQuestionContext({
    questions: /** @type {any} */ (outcomeQuestions),
  });

  bindQuestionPanel(/** @type {any} */ (context));
  fireEvent(questionsPanel, 'cora-group-verdict', {
    detail: { group: 'G', value: 'NA' },
  });

  assert.deepEqual(answerCalls, [{ questionId: 'q-out', value: 'NA' }]);
});

test('bindQuestionPanel: an ungrouped outcome question answers to the General verdict', () => {
  const outcomeQuestions = [
    { id: 'q-loose', responseType: 'outcome', deprecated: false },
  ];
  const { context, questionsPanel, answerCalls } = makeQuestionContext({
    questions: /** @type {any} */ (outcomeQuestions),
  });

  bindQuestionPanel(/** @type {any} */ (context));
  fireEvent(questionsPanel, 'cora-group-verdict', {
    detail: { group: 'General', value: 'Pass' },
  });

  assert.deepEqual(answerCalls, [{ questionId: 'q-loose', value: 'Pass' }]);
});
