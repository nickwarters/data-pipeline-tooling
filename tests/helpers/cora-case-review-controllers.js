// @ts-check
import { installDom, StubEl, useElementClass } from '../_dom-stub.js';

installDom();

class RecordingEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {any[]} */
    this._updateArgs = [];
    this.scrolled = false;
  }
  update(/** @type {any[]} */ ...args) {
    this._updateArgs = args;
  }
  scrollIntoView() {
    this.scrolled = true;
  }
}

useElementClass(RecordingEl);

/** @type {any} */ (globalThis).HTMLButtonElement = StubEl;
const documentListeners = /** @type {any} */ (globalThis).document._listeners;

const { updateCaseReviewHeader } =
  await import('../../src/pages/cora-case-review/header-controller.js');
const { createCaseReviewNodeRegistry } =
  await import('../../src/pages/cora-case-review/node-registry.js');
const { bindCaseReviewTabs, buildCaseReviewTabs, updateCaseReviewTabs } =
  await import('../../src/pages/cora-case-review/tab-controller.js');
const { bindQuestionPanel, collectUnansweredQuestions, updateQuestionPanel } =
  await import('../../src/pages/cora-case-review/question-panel-controller.js');
const { bindRemediationPanel, updateRemediationPanel } =
  await import('../../src/pages/cora-case-review/remediation-controller.js');
const { updateSummaryNotesAppeal } =
  await import('../../src/pages/cora-case-review/summary-notes-appeal-controller.js');
const { updateAmendOutcome } =
  await import('../../src/pages/cora-case-review/amend-outcome-controller.js');
const { updateAppealReview } =
  await import('../../src/pages/cora-case-review/appeal-review-controller.js');
const { createConversationPanelBinding } =
  await import('../../src/pages/cora-case-review/conversation-controller.js');
const {
  bindCompletion,
  completeCase,
  hasRemediationActions,
  updateCompletion,
} = await import('../../src/pages/cora-case-review/completion-controller.js');
const { bindRemediationTracking, updateRemediationTracking } =
  await import('../../src/pages/cora-case-review/remediation-tracking-controller.js');

/** @type {import('../../src/sharepoint-client.js').QuestionDefinition[]} */
const QUESTIONS = [
  {
    id: 'q-a',
    text: 'A',
    questionGroup: 'Basics',
    responseType: 'yes-no-na',
    deprecated: false,
  },
  { id: 'q-b', text: 'B', responseType: 'yes-no-na', deprecated: false },
  {
    id: 'q-c',
    text: 'C',
    questionGroup: 'Basics',
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
  const questionsPanel = new RecordingEl();
  const questionList = new RecordingEl();
  const progress = new RecordingEl();
  const overrideEditor = new RecordingEl();
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
  const completeButton = new RecordingEl();
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
  const header = new RecordingEl();
  const banner = new RecordingEl();
  const toggle =
    opts.toggle === undefined ? new RecordingEl() : (opts.toggle ?? null);
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
  const tabs = new RecordingEl();
  const nodes = {
    tabs,
    details: new RecordingEl(),
    questionsPanel: new RecordingEl(),
    questionList: null,
    progress: null,
    overrideEditor: null,
    issues: new RecordingEl(),
    remediation: new RecordingEl(),
    summary: new RecordingEl(),
    notes: new RecordingEl(),
    appeal: new RecordingEl(),
    appealReview: new RecordingEl(),
    amendOutcome: new RecordingEl(),
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
          appealRequest: 'hidden',
          appealReview: 'hidden',
          amendOutcome: 'hidden',
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
 *   canSelectRemediation: boolean,
 * }>} [opts]
 */
function makeRemediationContext(opts = {}) {
  const remediation = new RecordingEl();
  const client = { id: 'client' };
  const answers = { 'q-a': { value: 'No' } };
  const captureGroups = [{ key: 'group-1', label: 'Group 1', fields: [] }];
  /** @type {any[]} */
  const captureCalls = [];
  /** @type {any[]} */
  const attributeCalls = [];
  /** @type {any[]} */
  const remediationActionCalls = [];
  /** @type {any[]} */
  const remediationFreeFormCalls = [];
  return {
    remediation,
    answers,
    captureGroups,
    client,
    captureCalls,
    attributeCalls,
    remediationActionCalls,
    remediationFreeFormCalls,
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
          canSelectRemediation: opts.canSelectRemediation ?? true,
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
        handleRemediationAction(
          /** @type {string} */ questionId,
          /** @type {any} */ action,
          /** @type {boolean} */ selected
        ) {
          remediationActionCalls.push({ questionId, action, selected });
        },
        handleRemediationFreeForm(
          /** @type {string} */ questionId,
          /** @type {string} */ value
        ) {
          remediationFreeFormCalls.push({ questionId, value });
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
  const summary = new RecordingEl();
  const notes = new RecordingEl();
  const appeal = new RecordingEl();
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
          appealRequest: opts.appealAccess ?? 'read-only',
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
  const conversation = new RecordingEl();
  const toggle = new RecordingEl();
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
        caseListOptions: { listName: 'Cases-ExampleReview' },
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

/**
 * @param {Partial<{ access: string, outcomeOptions: any[] }>} [opts]
 */
function makeAmendOutcomeContext(opts = {}) {
  const amendOutcome = new RecordingEl();
  const saveQueue = { id: 'queue' };
  const currentUser = { id: 'controls-1', displayName: 'Controls' };
  const outcomeOptions = opts.outcomeOptions ?? [
    { id: 'pass', wording: 'Pass' },
  ];
  const caseRow = {
    id: 'case-1',
    status: 'Completed',
    outcomeAtCompletion: 'fail',
  };
  return {
    amendOutcome,
    saveQueue,
    currentUser,
    outcomeOptions,
    caseRow,
    context: {
      viewModel: {
        caseRow,
        config: { outcomeOptions },
        currentUser,
        access: { amendOutcome: opts.access ?? 'edit' },
        saveQueue,
      },
      nodes: { amendOutcome },
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
  };
}

/**
 * @param {Partial<{ access: string, outcomeOptions: any[] }>} [opts]
 */
function makeAppealReviewContext(opts = {}) {
  const appealReview = new RecordingEl();
  const saveQueue = { id: 'queue' };
  const currentUser = { id: 'controls-1', displayName: 'Controls' };
  const outcomeOptions = opts.outcomeOptions ?? [
    { id: 'pass', wording: 'Pass' },
  ];
  const caseRow = {
    id: 'case-1',
    status: 'Completed',
    outcomeAtCompletion: 'fail',
    appeals: [],
  };
  return {
    appealReview,
    saveQueue,
    currentUser,
    outcomeOptions,
    caseRow,
    context: {
      viewModel: {
        caseRow,
        config: { outcomeOptions },
        currentUser,
        access: { appealReview: opts.access ?? 'edit' },
        saveQueue,
      },
      nodes: { appealReview },
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
  };
}

const ACTIONS_ANSWERS = {
  'q-a': {
    value: 'No',
    remediationActions: [{ id: 'ra-0', text: 'Retrain.', completed: false }],
  },
};

/**
 * @param {Partial<{ access: string, answers: Record<string, any>, statusCalls: any[] }>} [opts]
 */
function makeTrackingContext(opts = {}) {
  const tracking = new RecordingEl();
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

export {
  ACTIONS_ANSWERS,
  QUESTIONS,
  RecordingEl,
  StubEl,
  bindCaseReviewTabs,
  bindCompletion,
  bindQuestionPanel,
  bindRemediationPanel,
  bindRemediationTracking,
  buildCaseReviewTabs,
  collectUnansweredQuestions,
  completeCase,
  createCaseReviewNodeRegistry,
  createConversationPanelBinding,
  documentListeners,
  hasRemediationActions,
  installDom,
  makeAmendOutcomeContext,
  makeAppealReviewContext,
  makeCompletionContext,
  makeConversationContext,
  makeHeaderContext,
  makeQuestionContext,
  makeRemediationContext,
  makeSummaryNotesAppealContext,
  makeTabContext,
  makeTrackingContext,
  updateAmendOutcome,
  updateAppealReview,
  updateCaseReviewHeader,
  updateCaseReviewTabs,
  updateCompletion,
  updateQuestionPanel,
  updateRemediationPanel,
  updateRemediationTracking,
  updateSummaryNotesAppeal,
  useElementClass,
};
