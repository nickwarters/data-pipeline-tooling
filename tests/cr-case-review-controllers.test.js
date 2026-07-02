// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

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
    this.disabled = false;
    this.hidden = false;
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
/** @type {Record<string, Function[]>} */
const documentListeners = {};
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
    (documentListeners[type] ??= []).push(fn);
  },
  removeEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
    documentListeners[type] = (documentListeners[type] ?? []).filter(
      (listener) => listener !== fn
    );
  },
};

const { updateCaseReviewHeader } =
  await import('../src/pages/cr-case-review/header-controller.js');
const { createCaseReviewNodeRegistry } =
  await import('../src/pages/cr-case-review/node-registry.js');
const { bindCaseReviewTabs, buildCaseReviewTabs, updateCaseReviewTabs } =
  await import('../src/pages/cr-case-review/tab-controller.js');
const { bindQuestionPanel, collectUnansweredQuestions, updateQuestionPanel } =
  await import('../src/pages/cr-case-review/question-panel-controller.js');
const { bindRemediationPanel, updateRemediationPanel } =
  await import('../src/pages/cr-case-review/remediation-controller.js');
const { updateSummaryNotesAppeal } =
  await import('../src/pages/cr-case-review/summary-notes-appeal-controller.js');
const { createConversationPanelBinding } =
  await import('../src/pages/cr-case-review/conversation-controller.js');
const {
  bindCompletion,
  completeCase,
  hasRemediationActions,
  updateCompletion,
} = await import('../src/pages/cr-case-review/completion-controller.js');
const { bindRemediationTracking, updateRemediationTracking } =
  await import('../src/pages/cr-case-review/remediation-tracking-controller.js');

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
 * @param {Partial<{
 *   allAnswered: boolean,
 *   canComplete: boolean,
 *   canCompleteRemediation: boolean,
 *   transitionToCompleted: Function | null,
 *   transitionToActionsInProgress: Function | null,
 *   transitionToFinalComplete: Function,
 *   responsibleParty: string | null,
 *   answers: Record<string, any>,
 *   completeCase: Function,
 * }>} [opts]
 */
function makeCompletionContext(opts = {}) {
  const completeButton = new StubEl();
  completeButton.disabled = false;
  completeButton.hidden = false;
  const patchFromTransition = {
    status: 'Completed',
    completedAt: 'transition-date',
  };
  const patchFromActionsTransition = {
    status: 'Actions In Progress',
    reportableAt: 'reportable-date',
  };
  /** @type {any[]} */
  const completeCalls = [];
  const client = { id: 'client' };
  const saveQueue = { id: 'queue' };
  const transitionToCompleted =
    opts.transitionToCompleted === undefined
      ? () => patchFromTransition
      : opts.transitionToCompleted;
  const transitionToActionsInProgress =
    opts.transitionToActionsInProgress === undefined
      ? () => patchFromActionsTransition
      : opts.transitionToActionsInProgress;
  const answers = opts.answers ?? { 'q-a': { value: 'Yes' } };
  return {
    completeButton,
    completeCalls,
    patchFromTransition,
    patchFromActionsTransition,
    context: {
      viewModel: {
        caseRow: {
          id: 'case-1',
          title: 'Case One',
          assignedReviewer: 'Alex Reviewer',
          responsibleParty:
            opts.responsibleParty === undefined
              ? 'rp@example.com'
              : opts.responsibleParty,
        },
        config: {
          computeOutcome: () => ({ outcome: 'pass' }),
        },
        answersSignal: { get: () => answers },
        exportHash: 'hash-1',
        machine: {
          canComplete: opts.canComplete ?? true,
          canCompleteRemediation: opts.canCompleteRemediation ?? false,
          transitionToFinalComplete:
            opts.transitionToFinalComplete ??
            (() => ({ status: 'Completed', completedAt: 'final-date' })),
          ...(transitionToCompleted ? { transitionToCompleted } : {}),
          ...(transitionToActionsInProgress
            ? { transitionToActionsInProgress }
            : {}),
        },
        allAnswered: { get: () => opts.allAnswered ?? true },
        client,
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
        banner: null,
        conversationToggle: null,
        header: null,
        completeButton,
      },
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase:
        opts.completeCase ??
        (async (
          /** @type {string} */ caseId,
          /** @type {any} */ clientArg,
          /** @type {any} */ saveQueueArg,
          /** @type {any} */ patchFields
        ) => {
          completeCalls.push({
            caseId,
            client: clientArg,
            saveQueue: saveQueueArg,
            patchFields,
          });
        }),
      toggleConversationPanel: () => {},
    },
    client,
    saveQueue,
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

/**
 * @param {Partial<{
 *   access: Record<string, string>,
 *   activeTab: string,
 * }>} [opts]
 */
function makeTabContext(opts = {}) {
  const tabs = new StubEl();
  const nodes = {
    tabs,
    details: new StubEl(),
    questionsPanel: new StubEl(),
    questionList: null,
    progress: null,
    overrideEditor: null,
    issues: new StubEl(),
    remediation: new StubEl(),
    summary: new StubEl(),
    notes: new StubEl(),
    appeal: new StubEl(),
    conversation: null,
    sourceCase: null,
    banner: null,
    conversationToggle: null,
    header: null,
    completeButton: null,
  };
  /** @type {string[]} */
  const activeTabSets = [];
  return {
    tabs,
    nodes,
    activeTabSets,
    context: {
      viewModel: {
        access: opts.access ?? {
          details: 'read-only',
          questions: 'edit',
          issues: 'edit',
          remediation: 'hidden',
          summary: 'read-only',
          notes: 'edit',
          appeal: 'hidden',
        },
        activeTab: {
          get: () => opts.activeTab ?? 'questions',
          set: (/** @type {string} */ id) => activeTabSets.push(id),
        },
      },
      nodes,
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
  };
}

/**
 * @param {Partial<{
 *   responsibleParty: string | null,
 *   attributeFailures: boolean,
 *   canAttribute: boolean,
 *   canCapture: boolean,
 * }>} [opts]
 */
function makeRemediationContext(opts = {}) {
  const remediation = new StubEl();
  const client = { id: 'client' };
  const answers = { 'q-a': { value: 'No' } };
  const captureGroups = [{ key: 'group-1', label: 'Group 1', fields: [] }];
  /** @type {any[]} */
  const captureCalls = [];
  /** @type {any[]} */
  const attributeCalls = [];
  return {
    remediation,
    answers,
    captureGroups,
    client,
    captureCalls,
    attributeCalls,
    context: {
      viewModel: {
        caseRow: {
          id: 'case-1',
          title: 'Case One',
          assignedReviewer: 'Alex Reviewer',
          responsibleParty:
            opts.responsibleParty === undefined
              ? 'rp@example.com'
              : opts.responsibleParty,
        },
        catalogue: QUESTIONS,
        config: {
          captureGroups,
          attributeFailures: opts.attributeFailures ?? true,
        },
        answersSignal: { get: () => answers },
        machine: {
          canAttribute: opts.canAttribute ?? true,
          canCapture: opts.canCapture ?? true,
        },
        client,
        handleCapture(
          /** @type {string} */ questionId,
          /** @type {string} */ fieldKey,
          /** @type {any} */ value
        ) {
          captureCalls.push({ questionId, fieldKey, value });
        },
        handleAttribute(
          /** @type {string} */ questionId,
          /** @type {any} */ attributedParty
        ) {
          attributeCalls.push({ questionId, attributedParty });
        },
      },
      nodes: {
        tabs: null,
        details: null,
        questionsPanel: null,
        questionList: null,
        progress: null,
        overrideEditor: null,
        issues: remediation,
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
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
  };
}

/**
 * @param {Partial<{
 *   notesAccess: string,
 *   appealAccess: string,
 *   roles: string[],
 *   allAnswered: boolean,
 * }>} [opts]
 */
function makeSummaryNotesAppealContext(opts = {}) {
  const summary = new StubEl();
  const notes = new StubEl();
  const appeal = new StubEl();
  const saveQueue = { id: 'queue' };
  const client = { id: 'client' };
  const currentUser = { id: 'user-1', displayName: 'QA Reviewer' };
  const answers = { 'q-a': { value: 'No' } };
  const summarySections = ['details', 'questions'];
  const captureGroups = [{ key: 'group-1', label: 'Group 1', fields: [] }];
  const remediationFields = [{ key: 'detail', label: 'Detail' }];
  const computeOutcome = () => ({ outcome: 'fail' });
  const caseRow = {
    id: 'case-1',
    title: 'Case One',
    assignedReviewer: 'Alex Reviewer',
    notes: 'Reviewer notes',
    caseJustification: 'Because evidence',
    answers,
  };
  return {
    summary,
    notes,
    appeal,
    saveQueue,
    client,
    currentUser,
    answers,
    summarySections,
    captureGroups,
    remediationFields,
    computeOutcome,
    caseRow,
    context: {
      viewModel: {
        caseRow,
        catalogue: QUESTIONS,
        config: {
          captureGroups,
          attributeFailures: true,
          remediationFields,
          computeOutcome,
        },
        answersSignal: { get: () => answers },
        allAnswered: { get: () => opts.allAnswered ?? true },
        currentUser,
        access: {
          notes: opts.notesAccess ?? 'edit',
          appeal: opts.appealAccess ?? 'read-only',
        },
        summarySections,
        saveQueue,
        client,
      },
      nodes: {
        tabs: null,
        details: null,
        questionsPanel: null,
        questionList: null,
        progress: null,
        overrideEditor: null,
        remediation: null,
        summary,
        notes,
        appeal,
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
  };
}

/**
 * @param {Partial<{
 *   canToggleConversation: boolean,
 *   conversationHidden: boolean,
 *   conversationAccess: string,
 * }>} [opts]
 */
function makeConversationContext(opts = {}) {
  documentListeners.keydown = [];
  const conversation = new StubEl();
  const toggle = new StubEl();
  const saveQueue = { id: 'queue' };
  const client = { id: 'client' };
  const currentUser = { id: 'user-1', displayName: 'Alex Reviewer' };
  const conversationMessages = [{ body: 'Message one' }];
  /** @type {number} */
  let toggleCalls = 0;
  return {
    conversation,
    toggle,
    saveQueue,
    client,
    currentUser,
    conversationMessages,
    get toggleCalls() {
      return toggleCalls;
    },
    context: {
      viewModel: {
        caseRow: {
          id: 'case-1',
          title: 'Case One',
          assignedReviewer: 'Alex Reviewer',
          conversation: conversationMessages,
        },
        currentUser,
        access: {
          conversation: opts.conversationAccess ?? 'edit',
        },
        conversationHidden: {
          get: () => opts.conversationHidden ?? true,
        },
        machine: {
          canToggleConversation: opts.canToggleConversation ?? true,
        },
        client,
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
        conversation,
        sourceCase: null,
        banner: null,
        conversationToggle:
          opts.canToggleConversation === false ? null : toggle,
        header: null,
        completeButton: null,
      },
      displayMode: (/** @type {any} */ mode) =>
        mode === 'override' ? 'read-only' : mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {
        toggleCalls += 1;
      },
    },
  };
}

test('CaseReviewNodeRegistry: creates and reuses the long-lived page nodes currently cached by CRCaseReview', () => {
  const registry = createCaseReviewNodeRegistry();
  const first = registry.ensure();
  const firstNodes = {
    tabs: first.tabs,
    details: first.details,
    questionsPanel: first.questionsPanel,
    questionList: first.questionList,
    progress: first.progress,
    issues: first.issues,
    remediation: first.remediation,
    summary: first.summary,
    notes: first.notes,
    appeal: first.appeal,
    conversation: first.conversation,
    banner: first.banner,
    conversationToggle: first.conversationToggle,
    header: first.header,
    completeButton: first.completeButton,
  };

  assert.equal(firstNodes.tabs?.tagName, 'CR-TABS');
  assert.equal(firstNodes.details?.tagName, 'CR-CASE-DETAILS');
  assert.equal(firstNodes.questionsPanel?.tagName, 'SECTION');
  assert.equal(firstNodes.questionList?.tagName, 'CR-QUESTION-LIST');
  assert.equal(firstNodes.progress?.tagName, 'CR-SECTION-PROGRESS');
  assert.equal(firstNodes.issues?.tagName, 'CR-REMEDIATION-SECTION');
  assert.equal(firstNodes.remediation?.tagName, 'CR-REMEDIATION-TRACKING');
  assert.equal(firstNodes.summary?.tagName, 'CR-SUMMARY');
  assert.equal(firstNodes.notes?.tagName, 'CR-NOTES');
  assert.equal(firstNodes.appeal?.tagName, 'CR-APPEAL');
  assert.equal(firstNodes.conversation?.tagName, 'CR-CONVERSATION');
  assert.equal(firstNodes.banner?.tagName, 'CR-STATUS-BANNER');
  assert.equal(firstNodes.conversationToggle?.tagName, 'BUTTON');
  assert.equal(
    firstNodes.conversationToggle?.className,
    'cr-conversation-toggle-btn'
  );
  assert.equal(firstNodes.header?.tagName, 'HEADER');
  assert.equal(firstNodes.completeButton?.tagName, 'BUTTON');
  assert.equal(firstNodes.completeButton?.className, 'cr-complete-btn');

  assert.equal(registry.ensure(), registry);
  assert.equal(registry.tabs, firstNodes.tabs);
  assert.equal(registry.details, firstNodes.details);
  assert.equal(registry.questionsPanel, firstNodes.questionsPanel);
  assert.equal(registry.questionList, firstNodes.questionList);
  assert.equal(registry.progress, firstNodes.progress);
  assert.equal(registry.issues, firstNodes.issues);
  assert.equal(registry.remediation, firstNodes.remediation);
  assert.equal(registry.summary, firstNodes.summary);
  assert.equal(registry.notes, firstNodes.notes);
  assert.equal(registry.appeal, firstNodes.appeal);
  assert.equal(registry.conversation, firstNodes.conversation);
  assert.equal(registry.banner, firstNodes.banner);
  assert.equal(registry.conversationToggle, firstNodes.conversationToggle);
  assert.equal(registry.header, firstNodes.header);
  assert.equal(registry.completeButton, firstNodes.completeButton);
});

test('CaseReviewTabController: maps section access into tabs in the current order', () => {
  const { context } = makeTabContext({
    access: {
      details: 'read-only',
      questions: 'hidden',
      issues: 'edit',
      remediation: 'read-only',
      summary: 'read-only',
      notes: 'hidden',
      appeal: 'edit',
    },
  });

  assert.deepEqual(buildCaseReviewTabs(/** @type {any} */ (context)), [
    { id: 'details', label: 'Details', hidden: false },
    { id: 'questions', label: 'Review', hidden: true },
    { id: 'issues', label: 'Issues', hidden: false },
    { id: 'remediation', label: 'Remediation', hidden: false },
    { id: 'summary', label: 'Summary', hidden: false },
    { id: 'notes', label: 'Notes', hidden: true },
    { id: 'appeal', label: 'Appeal', hidden: false },
  ]);
});

test('updateCaseReviewTabs: assigns selected tab and panel nodes', () => {
  const { context, tabs, nodes } = makeTabContext({ activeTab: 'summary' });

  updateCaseReviewTabs(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (tabs).selected, 'summary');
  assert.deepEqual(
    /** @type {any} */ (tabs).tabs.map(
      (/** @type {any} */ tab) => `${tab.id}:${tab.label}:${tab.hidden}`
    ),
    [
      'details:Details:false',
      'questions:Review:false',
      'issues:Issues:false',
      'remediation:Remediation:true',
      'summary:Summary:false',
      'notes:Notes:false',
      'appeal:Appeal:true',
    ]
  );
  assert.deepEqual(/** @type {any} */ (tabs).panels, {
    details: nodes.details,
    questions: nodes.questionsPanel,
    issues: nodes.issues,
    remediation: nodes.remediation,
    summary: nodes.summary,
    notes: nodes.notes,
    appeal: nodes.appeal,
  });
});

test('bindCaseReviewTabs: forwards cr-tab-change ids to activeTab', () => {
  const { context, tabs, activeTabSets } = makeTabContext();

  bindCaseReviewTabs(/** @type {any} */ (context));
  tabs._listeners['cr-tab-change'][0]({ detail: { id: 'notes' } });

  assert.deepEqual(activeTabSets, ['notes']);
});

test('bindQuestionPanel: forwards answer and jump events to the view model and visible questions', () => {
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

  bindQuestionPanel(/** @type {any} */ (context));

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

test('bindRemediationPanel: forwards capture and attribution events', () => {
  const { context, remediation, captureCalls, attributeCalls } =
    makeRemediationContext();

  bindRemediationPanel(/** @type {any} */ (context));
  remediation._listeners['cr-capture'][0]({
    detail: { questionId: 'q-a', fieldKey: 'detail', value: 'Needs work' },
  });
  const attributedParty = {
    loginName: 'person@example.com',
    displayName: 'Person Example',
  };
  remediation._listeners['cr-attribute'][0]({
    detail: { questionId: 'q-b', attributedParty },
  });

  assert.deepEqual(captureCalls, [
    { questionId: 'q-a', fieldKey: 'detail', value: 'Needs work' },
  ]);
  assert.deepEqual(attributeCalls, [{ questionId: 'q-b', attributedParty }]);
});

test('updateRemediationPanel: assigns Issues tab properties without changing capture behavior', () => {
  const { context, remediation, client, answers, captureGroups } =
    makeRemediationContext({
      responsibleParty: 'owner@example.com',
      canAttribute: false,
      canCapture: true,
      attributeFailures: false,
    });

  updateRemediationPanel(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (remediation).client, client);
  assert.equal(/** @type {any} */ (remediation).canAttribute, false);
  assert.deepEqual(/** @type {any} */ (remediation).responsibleParty, {
    loginName: 'owner@example.com',
    displayName: 'owner@example.com',
  });
  assert.equal(/** @type {any} */ (remediation).captureGroups, captureGroups);
  assert.equal(/** @type {any} */ (remediation).canCapture, true);
  assert.equal(/** @type {any} */ (remediation).catalogue, QUESTIONS);
  assert.equal(/** @type {any} */ (remediation).answers, answers);
  assert.equal(/** @type {any} */ (remediation).attributeFailures, false);
  assert.deepEqual(remediation._updateArgs, [QUESTIONS, answers, false]);
});

test('updateRemediationPanel: forwards null Responsible Party as null quick-pick', () => {
  const { context, remediation } = makeRemediationContext({
    responsibleParty: null,
  });

  updateRemediationPanel(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (remediation).responsibleParty, null);
});

test('updateSummaryNotesAppeal: assigns Summary, Notes, and Appeal tab props', () => {
  const {
    context,
    summary,
    notes,
    appeal,
    saveQueue,
    client,
    currentUser,
    answers,
    summarySections,
    captureGroups,
    remediationFields,
    computeOutcome,
    caseRow,
  } = makeSummaryNotesAppealContext();

  updateSummaryNotesAppeal(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (summary).caseRow, caseRow);
  assert.equal(/** @type {any} */ (summary).catalogue, QUESTIONS);
  assert.equal(/** @type {any} */ (summary).summarySections, summarySections);
  assert.equal(/** @type {any} */ (summary).captureGroups, captureGroups);
  assert.deepEqual(summary._updateArgs, [computeOutcome, answers, true]);

  assert.equal(/** @type {any} */ (notes).notes, 'Reviewer notes');
  assert.equal(
    /** @type {any} */ (notes).caseJustification,
    'Because evidence'
  );
  assert.equal(/** @type {any} */ (notes).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (notes).caseId, 'case-1');
  assert.equal(/** @type {any} */ (notes).access, 'edit');

  assert.equal(/** @type {any} */ (appeal).caseRow, caseRow);
  assert.equal(/** @type {any} */ (appeal).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (appeal).caseId, 'case-1');
  assert.equal(/** @type {any} */ (appeal).access, 'read-only');
  assert.equal(/** @type {any} */ (appeal).currentUser, currentUser);
  assert.equal(/** @type {any} */ (appeal).catalogue, QUESTIONS);
  assert.equal(/** @type {any} */ (appeal).answers, answers);
});

test('createConversationPanelBinding: preserves click and Alt+C conversation toggling', () => {
  const setup = makeConversationContext({
    conversationHidden: false,
    conversationAccess: 'override',
  });
  const { context, conversation, toggle, saveQueue, client, currentUser } =
    setup;
  const controller = createConversationPanelBinding();

  controller.bind(/** @type {any} */ (context));
  controller.update(/** @type {any} */ (context));
  toggle._listeners.click[0]();
  documentListeners.keydown[0]({ altKey: true, code: 'KeyC' });
  documentListeners.keydown[0]({ altKey: false, code: 'KeyC' });

  assert.equal(setup.toggleCalls, 2);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(
    toggle.getAttribute('aria-label'),
    'Toggle conversation panel (⌥C / Alt+C)'
  );
  assert.equal(toggle.textContent, 'Conversation');
  assert.equal(/** @type {any} */ (conversation).client, client);
  assert.equal(/** @type {any} */ (conversation).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (conversation).caseId, 'case-1');
  assert.equal(/** @type {any} */ (conversation).currentUser, currentUser);
  assert.equal(/** @type {any} */ (conversation).access, 'read-only');
  assert.equal(/** @type {any} */ (conversation).hidden, false);
  assert.deepEqual(/** @type {any} */ (conversation)._messages, [
    { body: 'Message one' },
  ]);
  assert.equal(
    /** @type {any} */ (conversation)._messages ===
      /** @type {any} */ (context).viewModel.caseRow.conversation,
    false
  );
});

test('createConversationPanelBinding: removes document-level listeners on disconnect', () => {
  const setup = makeConversationContext();
  const controller = createConversationPanelBinding();

  controller.bind(/** @type {any} */ (setup.context));
  const handler = controller.keydownHandler;
  assert.ok(handler);
  assert.equal(documentListeners.keydown.includes(handler), true);

  controller.disconnect();

  assert.equal(controller.keydownHandler, null);
  assert.equal(documentListeners.keydown.includes(handler), false);
});

test('updateCompletion: preserves completion button visibility and label', () => {
  const visible = makeCompletionContext({
    allAnswered: true,
    canComplete: true,
  });
  updateCompletion(/** @type {any} */ (visible.context));
  assert.equal(visible.completeButton.hidden, false);
  assert.equal(visible.completeButton.textContent, 'Complete Case');

  const unanswered = makeCompletionContext({
    allAnswered: false,
    canComplete: true,
  });
  updateCompletion(/** @type {any} */ (unanswered.context));
  assert.equal(unanswered.completeButton.hidden, true);

  const blocked = makeCompletionContext({
    allAnswered: true,
    canComplete: false,
  });
  updateCompletion(/** @type {any} */ (blocked.context));
  assert.equal(blocked.completeButton.hidden, true);
});

test('bindCompletion: disables during submit, uses transition patch, and re-enables', async () => {
  /** @type {(value?: unknown) => void} */
  let resolveSubmit = () => {};
  const { context, completeButton, completeCalls, patchFromTransition } =
    makeCompletionContext({
      completeCase: (
        /** @type {string} */ caseId,
        /** @type {any} */ client,
        /** @type {any} */ saveQueue,
        /** @type {any} */ patchFields
      ) =>
        new Promise((resolve) => {
          completeCalls.push({ caseId, client, saveQueue, patchFields });
          resolveSubmit = resolve;
        }),
    });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeButton.disabled, true);
  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields, patchFromTransition);

  resolveSubmit();
  await Promise.resolve();
  assert.equal(completeButton.disabled, false);
});

test('bindCompletion: falls back to default completion patch when no transition exists', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    transitionToCompleted: null,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields.status, 'Completed');
  assert.equal(typeof completeCalls[0].patchFields.completedAt, 'string');
});

const ACTIONS_ANSWERS = {
  'q-a': {
    value: 'No',
    remediationActions: [{ id: 'ra-0', text: 'Retrain.', completed: false }],
  },
};

test('hasRemediationActions: true iff an Answer carries ≥1 Remediation Action', () => {
  assert.equal(
    hasRemediationActions(
      /** @type {any} */ ({ answersSignal: { get: () => ACTIONS_ANSWERS } })
    ),
    true
  );
  assert.equal(
    hasRemediationActions(
      /** @type {any} */ ({
        answersSignal: { get: () => ({ 'q-a': { value: 'Yes' } }) },
      })
    ),
    false
  );
  assert.equal(
    hasRemediationActions(/** @type {any} */ ({})),
    false,
    'no answers signal ⇒ no actions'
  );
});

test('updateCompletion: button reads "Send Actions" when the Case carries Remediation Actions (ADR-0023)', () => {
  const withActions = makeCompletionContext({
    allAnswered: true,
    canComplete: true,
    answers: ACTIONS_ANSWERS,
  });
  updateCompletion(/** @type {any} */ (withActions.context));
  assert.equal(withActions.completeButton.hidden, false);
  assert.equal(withActions.completeButton.textContent, 'Send Actions');
});

test('bindCompletion: routes down the actions path (transitionToActionsInProgress) when actions exist', () => {
  const { context, completeButton, completeCalls, patchFromActionsTransition } =
    makeCompletionContext({ answers: ACTIONS_ANSWERS });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(
    completeCalls[0].patchFields,
    patchFromActionsTransition,
    'the Send Actions transition supplies the reportable PATCH'
  );
});

test('bindCompletion: no-actions path uses transitionToCompleted', () => {
  const { context, completeButton, completeCalls, patchFromTransition } =
    makeCompletionContext();

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields, patchFromTransition);
});

test('bindCompletion: actions path falls back to default patch when the transition is absent', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    answers: ACTIONS_ANSWERS,
    transitionToActionsInProgress: null,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields.status, 'Completed');
  assert.equal(typeof completeCalls[0].patchFields.completedAt, 'string');
});

test('updateCompletion: hidden until the Responsible Party is set at the bottom of Issues (ADR-0024)', () => {
  const noRp = makeCompletionContext({
    allAnswered: true,
    canComplete: true,
    responsibleParty: null,
  });
  updateCompletion(/** @type {any} */ (noRp.context));
  assert.equal(noRp.completeButton.hidden, true, 'no RP ⇒ button hidden');
});

test('updateCompletion: on the actions path the button reappears as "Complete Case" once tracking is complete', () => {
  const ready = makeCompletionContext({
    allAnswered: false,
    canComplete: false,
    canCompleteRemediation: true,
  });
  updateCompletion(/** @type {any} */ (ready.context));
  assert.equal(ready.completeButton.hidden, false);
  assert.equal(ready.completeButton.textContent, 'Complete Case');
});

test('bindCompletion: final-complete path uses transitionToFinalComplete (ADR-0024)', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    canCompleteRemediation: true,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.deepEqual(completeCalls[0].patchFields, {
    status: 'Completed',
    completedAt: 'final-date',
  });
});

/**
 * @param {Partial<{ access: string, answers: Record<string, any>, statusCalls: any[] }>} [opts]
 */
function makeTrackingContext(opts = {}) {
  const tracking = new StubEl();
  const answers = opts.answers ?? {
    'q-a': {
      value: 'No',
      capture: { acts: [{ id: 'a1', text: 'x', status: 'pending' }] },
    },
  };
  const captureGroups = [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'acts', label: 'Acts', type: 'actions' }],
    },
  ];
  /** @type {any[]} */
  const statusCalls = [];
  return {
    tracking,
    statusCalls,
    context: {
      viewModel: {
        caseRow: { id: 'case-1' },
        catalogue: QUESTIONS,
        config: { captureGroups },
        answersSignal: { get: () => answers },
        access: { remediation: opts.access ?? 'edit' },
        machine: { reportable: true },
        handleActionStatus(
          /** @type {string} */ questionId,
          /** @type {string} */ fieldKey,
          /** @type {string} */ actionId,
          /** @type {string} */ status,
          /** @type {string} */ cancelReason
        ) {
          statusCalls.push({
            questionId,
            fieldKey,
            actionId,
            status,
            cancelReason,
          });
        },
      },
      nodes: { remediation: tracking },
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
  };
}

test('bindRemediationTracking: forwards cr-action-status to the view model', () => {
  const { context, tracking, statusCalls } = makeTrackingContext();
  bindRemediationTracking(/** @type {any} */ (context));
  tracking._listeners['cr-action-status'][0]({
    detail: {
      questionId: 'q-a',
      fieldKey: 'acts',
      actionId: 'a1',
      status: 'cancelled',
      cancelReason: 'dup',
    },
  });
  assert.deepEqual(statusCalls, [
    {
      questionId: 'q-a',
      fieldKey: 'acts',
      actionId: 'a1',
      status: 'cancelled',
      cancelReason: 'dup',
    },
  ]);
});

test('bindRemediationTracking: no-ops when the tracking node is absent', () => {
  const { context } = makeTrackingContext();
  context.nodes.remediation = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    bindRemediationTracking(/** @type {any} */ (context))
  );
});

test('updateRemediationTracking: assigns captureGroups, canResolve, and updates', () => {
  const { context, tracking } = makeTrackingContext({ access: 'edit' });
  updateRemediationTracking(/** @type {any} */ (context));
  assert.equal(/** @type {any} */ (tracking).canResolve, true);
  assert.deepEqual(/** @type {any} */ (tracking).captureGroups, [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'acts', label: 'Acts', type: 'actions' }],
    },
  ]);
  assert.equal(tracking._updateArgs[0], QUESTIONS);
});

test('updateRemediationTracking: read-only viewer cannot resolve; no-ops without a node', () => {
  const { context, tracking } = makeTrackingContext({ access: 'read-only' });
  updateRemediationTracking(/** @type {any} */ (context));
  assert.equal(/** @type {any} */ (tracking).canResolve, false);

  const bare = makeTrackingContext();
  bare.context.nodes.remediation = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    updateRemediationTracking(/** @type {any} */ (bare.context))
  );
});

test('completeCase: flushes queued saves, patches with the stored ETag, and navigates on success', async () => {
  /** @type {any[]} */
  const patchCalls = [];
  const client = {
    patchCase(
      /** @type {string} */ caseId,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      patchCalls.push({ caseId, fields, etag });
      return Promise.resolve({ ok: true, status: 200 });
    },
  };
  const saveQueue = {
    flushCase: async () => true,
    getEtag: () => 'etag-1',
  };
  /** @type {any} */ (globalThis).location = { hash: '' };

  await completeCase({
    caseId: 'case-1',
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ (saveQueue),
    patchFields: { status: 'Completed' },
  });

  assert.deepEqual(patchCalls, [
    {
      caseId: 'case-1',
      fields: { status: 'Completed' },
      etag: 'etag-1',
    },
  ]);
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/dashboard');
});

test('completeCase: does not patch when required collaborators or flush success are missing', async () => {
  let patchCount = 0;
  const client = {
    patchCase() {
      patchCount++;
      return Promise.resolve({ ok: true, status: 200 });
    },
  };
  const saveQueue = {
    flushCase: async () => false,
    getEtag: () => 'etag-1',
  };

  await completeCase({
    caseId: 'case-1',
    client: null,
    saveQueue: /** @type {any} */ (saveQueue),
    patchFields: null,
  });
  await completeCase({
    caseId: 'case-1',
    client: /** @type {any} */ (client),
    saveQueue: null,
    patchFields: null,
  });
  await completeCase({
    caseId: 'case-1',
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ (saveQueue),
    patchFields: null,
  });

  assert.equal(patchCount, 0);
});

test('updateCaseReviewHeader: preserves title, reviewer, conversation toggle placement, and banner wiring', () => {
  const { context, header, banner, toggle, saveQueue } = makeHeaderContext();

  updateCaseReviewHeader(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (banner).saveQueue, saveQueue);
  assert.equal(header._children.length, 3);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
  assert.equal(header._children[2], toggle);
});

test('updateCaseReviewHeader: omits the conversation toggle when the machine disallows it', () => {
  const { context, header, toggle } = makeHeaderContext({
    canToggleConversation: false,
  });

  updateCaseReviewHeader(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.ok(!header._children.includes(/** @type {StubEl} */ (toggle)));
});

test('updateCaseReviewHeader: tolerates a missing conversation toggle node', () => {
  const { context, header } = makeHeaderContext({ toggle: null });

  updateCaseReviewHeader(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
});
