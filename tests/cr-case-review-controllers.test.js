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
const { createCaseReviewNodeRegistry } =
  await import('../src/pages/cr-case-review/node-registry.js');
const { CaseReviewTabController, buildCaseReviewTabs } =
  await import('../src/pages/cr-case-review/tab-controller.js');
const { QuestionPanelController, collectUnansweredQuestions } =
  await import('../src/pages/cr-case-review/question-panel-controller.js');
const { CompletionController, completeCase } =
  await import('../src/pages/cr-case-review/completion-controller.js');

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
 *   transitionToCompleted: Function | null,
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
  /** @type {any[]} */
  const completeCalls = [];
  const client = { id: 'client' };
  const saveQueue = { id: 'queue' };
  const transitionToCompleted =
    opts.transitionToCompleted === undefined
      ? () => patchFromTransition
      : opts.transitionToCompleted;
  return {
    completeButton,
    completeCalls,
    patchFromTransition,
    context: {
      viewModel: {
        caseRow: {
          id: 'case-1',
          title: 'Case One',
          assignedReviewer: 'Alex Reviewer',
        },
        config: {
          computeOutcome: () => ({ outcome: 'pass' }),
        },
        answersSignal: { get: () => ({ 'q-a': { value: 'Yes' } }) },
        exportHash: 'hash-1',
        machine: {
          canComplete: opts.canComplete ?? true,
          ...(transitionToCompleted ? { transitionToCompleted } : {}),
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
          remediation: 'edit',
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

test('CaseReviewNodeRegistry: creates and reuses the long-lived page nodes currently cached by CRCaseReview', () => {
  const registry = createCaseReviewNodeRegistry();
  const first = registry.ensure();
  const firstNodes = {
    tabs: first.tabs,
    details: first.details,
    questionsPanel: first.questionsPanel,
    questionList: first.questionList,
    progress: first.progress,
    overrideEditor: first.overrideEditor,
    remediation: first.remediation,
    summary: first.summary,
    notes: first.notes,
    appeal: first.appeal,
    conversation: first.conversation,
    sourceCase: first.sourceCase,
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
  assert.equal(firstNodes.overrideEditor?.tagName, 'CR-OVERRIDE-EDITOR');
  assert.equal(firstNodes.remediation?.tagName, 'CR-REMEDIATION-SECTION');
  assert.equal(firstNodes.summary?.tagName, 'CR-SUMMARY');
  assert.equal(firstNodes.notes?.tagName, 'CR-NOTES');
  assert.equal(firstNodes.appeal?.tagName, 'CR-APPEAL');
  assert.equal(firstNodes.conversation?.tagName, 'CR-CONVERSATION');
  assert.equal(firstNodes.sourceCase?.tagName, 'CR-SOURCE-CASE');
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
  assert.equal(registry.overrideEditor, firstNodes.overrideEditor);
  assert.equal(registry.remediation, firstNodes.remediation);
  assert.equal(registry.summary, firstNodes.summary);
  assert.equal(registry.notes, firstNodes.notes);
  assert.equal(registry.appeal, firstNodes.appeal);
  assert.equal(registry.conversation, firstNodes.conversation);
  assert.equal(registry.sourceCase, firstNodes.sourceCase);
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
      remediation: 'edit',
      summary: 'read-only',
      notes: 'hidden',
      appeal: 'edit',
    },
  });

  assert.deepEqual(buildCaseReviewTabs(/** @type {any} */ (context)), [
    { id: 'details', label: 'Details', hidden: false },
    { id: 'questions', label: 'Review', hidden: true },
    { id: 'remediation', label: 'Issues', hidden: false },
    { id: 'summary', label: 'Summary', hidden: false },
    { id: 'notes', label: 'Notes', hidden: true },
    { id: 'appeal', label: 'Appeal', hidden: false },
  ]);
});

test('CaseReviewTabController: assigns selected tab and panel nodes', () => {
  const { context, tabs, nodes } = makeTabContext({ activeTab: 'summary' });

  new CaseReviewTabController().update(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (tabs).selected, 'summary');
  assert.deepEqual(
    /** @type {any} */ (tabs).tabs.map(
      (/** @type {any} */ tab) => `${tab.id}:${tab.label}:${tab.hidden}`
    ),
    [
      'details:Details:false',
      'questions:Review:false',
      'remediation:Issues:false',
      'summary:Summary:false',
      'notes:Notes:false',
      'appeal:Appeal:true',
    ]
  );
  assert.deepEqual(/** @type {any} */ (tabs).panels, {
    details: nodes.details,
    questions: nodes.questionsPanel,
    remediation: nodes.remediation,
    summary: nodes.summary,
    notes: nodes.notes,
    appeal: nodes.appeal,
  });
});

test('CaseReviewTabController: forwards cr-tab-change ids to activeTab', () => {
  const { context, tabs, activeTabSets } = makeTabContext();

  new CaseReviewTabController().bind(/** @type {any} */ (context));
  tabs._listeners['cr-tab-change'][0]({ detail: { id: 'notes' } });

  assert.deepEqual(activeTabSets, ['notes']);
});

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

test('CompletionController: preserves completion button visibility and label', () => {
  const visible = makeCompletionContext({
    allAnswered: true,
    canComplete: true,
  });
  new CompletionController().update(/** @type {any} */ (visible.context));
  assert.equal(visible.completeButton.hidden, false);
  assert.equal(visible.completeButton.textContent, 'Complete Case');

  const unanswered = makeCompletionContext({
    allAnswered: false,
    canComplete: true,
  });
  new CompletionController().update(/** @type {any} */ (unanswered.context));
  assert.equal(unanswered.completeButton.hidden, true);

  const blocked = makeCompletionContext({
    allAnswered: true,
    canComplete: false,
  });
  new CompletionController().update(/** @type {any} */ (blocked.context));
  assert.equal(blocked.completeButton.hidden, true);
});

test('CompletionController: disables during submit, uses transition patch, and re-enables', async () => {
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

  new CompletionController().bind(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeButton.disabled, true);
  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields, patchFromTransition);

  resolveSubmit();
  await Promise.resolve();
  assert.equal(completeButton.disabled, false);
});

test('CompletionController: falls back to default completion patch when no transition exists', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    transitionToCompleted: null,
  });

  new CompletionController().bind(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields.status, 'Completed');
  assert.equal(typeof completeCalls[0].patchFields.completedAt, 'string');
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
