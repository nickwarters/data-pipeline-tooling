// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.textContent = '';
    this.className = '';
    this.tagName = '';
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {any[]} */
    this._updateArgs = [];
    this.scrolled = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...children) {
    this._children = children;
  }
  appendChild(/** @type {StubEl} */ child) {
    this._children.push(child);
    return child;
  }
  setAttribute(/** @type {string} */ key, /** @type {string} */ value) {
    this._attrs[key] = value;
  }
  getAttribute(/** @type {string} */ key) {
    return this._attrs[key] ?? null;
  }
  addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
    (this._listeners[type] ??= []).push(fn);
  }
  update(/** @type {any[]} */ ...args) {
    this._updateArgs = args;
  }
  scrollIntoView() {
    this.scrolled = true;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).HTMLButtonElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
};

const { CaseReviewHeaderController } =
  await import('../src/pages/cr-case-review/header-controller.js');
const { QuestionPanelController, collectUnansweredQuestions } =
  await import('../src/pages/cr-case-review/question-panel-controller.js');

/** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
const QUESTIONS = [
  {
    id: 'q-a',
    text: 'A',
    category: 'Basics',
    responseType: 'yes-no-na',
    deprecated: false,
  },
  { id: 'q-b', text: 'B', responseType: 'yes-no-na', deprecated: false },
  {
    id: 'q-c',
    text: 'C',
    category: 'Basics',
    responseType: 'multi-choice',
    deprecated: false,
  },
];

/**
 * @param {Partial<{
 *   access: string,
 *   answers: Record<string, any>,
 *   questions: any[],
 * }>} [opts]
 */
function makeQuestionContext(opts = {}) {
  const questionsPanel = new StubEl();
  const questionList = new StubEl();
  const progress = new StubEl();
  const overrideEditor = new StubEl();
  const saveQueue = { id: 'queue' };
  const client = { id: 'client' };
  /** @type {Array<{ questionId: string, value: string | string[] }>} */
  const answerCalls = [];
  const answers = opts.answers ?? {
    'q-a': { value: 'Yes' },
    'q-b': { value: '' },
    'q-c': { value: [] },
  };
  const questions = opts.questions ?? QUESTIONS;
  return {
    questionsPanel,
    questionList,
    progress,
    overrideEditor,
    answerCalls,
    context: {
      viewModel: {
        caseRow: {
          id: 'case-1',
          title: 'Case One',
          assignedReviewer: 'Alex Reviewer',
        },
        catalogue: QUESTIONS,
        config: {
          attributeFailures: true,
          remediationFields: [{ key: 'detail', label: 'Detail' }],
          computeOutcome: () => ({ outcome: 'pass' }),
        },
        answersSignal: { get: () => answers },
        applicableQuestions: { get: () => questions },
        currentUser: { id: 'user-1', displayName: 'Alex' },
        access: { questions: opts.access ?? 'edit' },
        client,
        saveQueue,
        handleAnswer(
          /** @type {string} */ questionId,
          /** @type {string | string[]} */ value
        ) {
          answerCalls.push({ questionId, value });
        },
      },
      nodes: {
        tabs: null,
        details: null,
        questionsPanel,
        questionList,
        progress,
        overrideEditor,
        remediation: null,
        summary: null,
        notes: null,
        appeal: null,
        conversation: null,
        sourceCase: null,
        banner: null,
        conversationToggle: null,
        header: null,
        completeButton: null,
      },
      displayMode: (/** @type {any} */ mode) =>
        mode === 'override' ? 'read-only' : mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
    saveQueue,
    client,
  };
}

/**
 * @param {{ canToggleConversation?: boolean, toggle?: StubEl | null }} [opts]
 */
function makeHeaderContext(opts = {}) {
  const header = new StubEl();
  const banner = new StubEl();
  const toggle =
    opts.toggle === undefined ? new StubEl() : (opts.toggle ?? null);
  const saveQueue = { id: 'queue' };
  return {
    header,
    banner,
    toggle,
    context: {
      viewModel: {
        caseRow: {
          id: 'case-1',
          title: 'Case One',
          assignedReviewer: 'Alex Reviewer',
        },
        machine: {
          canToggleConversation: opts.canToggleConversation ?? true,
        },
        saveQueue,
      },
      nodes: {
        tabs: null,
        details: null,
        questionsPanel: null,
        questionList: null,
        progress: null,
        overrideEditor: null,
        remediation: null,
        summary: null,
        notes: null,
        appeal: null,
        conversation: null,
        sourceCase: null,
        banner,
        conversationToggle: toggle,
        header,
        completeButton: null,
      },
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
    saveQueue,
  };
}

test.todo(
  'CaseReviewNodeRegistry: creates the same long-lived page nodes currently cached by CRCaseReview'
);
// TODO(issue-198): Assert each expected custom element/button/header is created
// once and reused across renders so behavior remains stable while removing
// private element caching from the page class.

test.todo(
  'CaseReviewTabController: maps section access into visible tabs in the current order'
);
// TODO(issue-198): Cover details, Review, Issues, Summary, Notes, and Appeal tab
// descriptors; assert hidden sections are omitted and activeTab receives
// cr-tab-change ids.

test('QuestionPanelController: forwards answer and jump events to the view model and visible questions', () => {
  const { context, questionsPanel, questionList, answerCalls } =
    makeQuestionContext();
  const generalQuestionEl = new StubEl();
  /** @type {any} */ (generalQuestionEl).question = { id: 'q-b' };
  const unansweredQuestionEl = new StubEl();
  /** @type {any} */ (unansweredQuestionEl).question = {
    id: 'q-c',
    category: 'Basics',
  };
  const answeredQuestionEl = new StubEl();
  /** @type {any} */ (answeredQuestionEl).question = {
    id: 'q-a',
    category: 'Basics',
  };
  /** @type {any} */ (questionList).questionElements = [
    answeredQuestionEl,
    generalQuestionEl,
    unansweredQuestionEl,
  ];

  new QuestionPanelController().bind(/** @type {any} */ (context));

  questionsPanel._listeners['cr-answer'][0]({
    detail: { questionId: 'q-a', value: 'No' },
  });
  questionsPanel._listeners['cr-section-jump'][0]({
    detail: { section: 'General' },
  });
  questionsPanel._listeners['cr-jump-unanswered'][0]();

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

test('QuestionPanelController: assigns question list and progress props', () => {
  const { context, questionsPanel, questionList, progress } =
    makeQuestionContext();

  new QuestionPanelController().update(/** @type {any} */ (context));

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

test('QuestionPanelController: configures the override editor only in override mode', () => {
  const { context, questionsPanel, overrideEditor, saveQueue, client } =
    makeQuestionContext({ access: 'override' });

  new QuestionPanelController().update(/** @type {any} */ (context));

  assert.equal(questionsPanel._children[3], overrideEditor);
  assert.equal(/** @type {any} */ (overrideEditor).caseId, 'case-1');
  assert.equal(/** @type {any} */ (overrideEditor).access, 'override');
  assert.equal(/** @type {any} */ (overrideEditor).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (overrideEditor).client, client);
  assert.equal(/** @type {any} */ (overrideEditor).attributeFailures, true);
});

test.todo(
  'RemediationPanelController: forwards capture and attribution events'
);
// TODO(issue-198): Verify cr-capture and cr-attribute event details are passed
// unchanged to handleCapture and handleAttribute.

test.todo(
  'RemediationPanelController: assigns Issues tab properties without changing capture behavior'
);
// TODO(issue-198): Cover responsibleParty shaping, captureGroups, canCapture,
// canAttribute, catalogue, answers, and attributeFailures update arguments.

test.todo(
  'SummaryNotesAppealController: assigns Summary, Notes, and Appeal tab props'
);
// TODO(issue-198): Assert computeOutcome/allAnswered are sent to Summary, Notes
// receives queue/case/access fields, and Appeal receives qaReviewer/correction
// context.

test.todo(
  'ConversationPanelController: preserves click and Alt+C conversation toggling'
);
// TODO(issue-198): Assert the toggle button and document keydown path call the
// same view-model toggle method and keep aria-expanded in sync.

test.todo(
  'ConversationPanelController: removes document-level listeners on disconnect'
);
// TODO(issue-198): Assert the controller unregisters keyboard handlers to avoid
// leaking shortcuts after CRCaseReview is disconnected.

test.todo(
  'CompletionController: preserves completion button visibility and transition patch behavior'
);
// TODO(issue-198): Assert the button hides unless all questions are answered and
// completion is allowed, disables during submit, uses transitionToCompleted when
// present, and re-enables after completion settles.

test.todo(
  'completeCase: flushes queued saves, patches with the stored ETag, and navigates on success'
);
// TODO(issue-198): Move existing _completeCase coverage to this public seam and
// include the no-client, no-queue, failed-flush, and failed-patch paths.

test.todo(
  'SourceCaseController: assigns QA Check source case props without changing override provenance'
);
// TODO(issue-198): Assert cr-source-case receives the resolved source case data,
// current user, client, saveQueue, override access, and sourceCaseId.

test('CaseReviewHeaderController: preserves title, reviewer, conversation toggle placement, and banner wiring', () => {
  const { context, header, banner, toggle, saveQueue } = makeHeaderContext();

  new CaseReviewHeaderController().update(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (banner).saveQueue, saveQueue);
  assert.equal(header._children.length, 3);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
  assert.equal(header._children[2], toggle);
});

test('CaseReviewHeaderController: omits the conversation toggle when the machine disallows it', () => {
  const { context, header, toggle } = makeHeaderContext({
    canToggleConversation: false,
  });

  new CaseReviewHeaderController().update(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.ok(!header._children.includes(/** @type {StubEl} */ (toggle)));
});

test('CaseReviewHeaderController: tolerates a missing conversation toggle node', () => {
  const { context, header } = makeHeaderContext({ toggle: null });

  new CaseReviewHeaderController().update(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
});
