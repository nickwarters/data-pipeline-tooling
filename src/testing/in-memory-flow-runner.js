// @ts-check

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../sharepoint-client.js').VersionedExport} VersionedExport */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

import { CaseReviewViewModel } from '../lib/case-review-view-model.js';
import { MockSharePointClient } from '../services/mock-sharepoint-client.js';
import { resolveCapabilities } from '../services/permissions.js';
import { SaveQueue } from '../services/save-queue.js';
import {
  completeCase,
  completionPatch,
} from '../pages/cora-case-review/completion-actions.js';
import {
  raiseAppeal,
  resolveAppeal,
} from '../pages/cora-case-review/appeal-actions.js';
import { loadCaseTypeConfig } from '../../case-types/manifest.js';

/**
 * @typedef {{
 * lists?: Record<string, CaseRow[]>,
 * questionDefinitions?: QuestionDefinition[],
 * personas?: Record<string, { groups: string[], userId?: string, displayName?: string }>,
 * people?: PersonResult[],
 * exportHashes?: Record<string, string>,
 * versionedExports?: Record<string, VersionedExport>
 * }} InMemoryListState
 *
 * @typedef {{
 * type: 'loadCasePage',
 * caseId: string,
 * caseType?: string,
 * currentUserId?: string,
 * capabilities?: Capabilities | null
 * } | {
 * type: 'allocateCase',
 * caseId: string,
 * caseType: string,
 * reviewerId: string
 * } | {
 * type: 'answer',
 * questionId: string,
 * value: string | string[]
 * } | {
 * type: 'captureIssue',
 * questionId: string,
 * fieldKey: string,
 * value: string
 * } | {
 * type: 'selectRemediationAction',
 * questionId: string,
 * action: { id: string, text: string },
 * selected?: boolean
 * } | {
 * type: 'freeFormRemediation',
 * questionId: string,
 * value: string
 * } | {
 * type: 'setActionStatus',
 * questionId: string,
 * fieldKey: string,
 * actionId: string,
 * status: 'pending' | 'complete' | 'cancelled',
 * cancelReason?: string
 * } | {
 * type: 'clickCompleteCase'
 * } | {
 * type: 'raiseAppeal',
 * actorId: string,
 * rationale: string,
 * citedAnswerKeys?: string[]
 * } | {
 * type: 'resolveAppeal',
 * actorId: string,
 * verdict: 'agreed' | 'rejected',
 * rationale: string,
 * outcome?: string,
 * justification?: string
 * } | {
 * type: 'flush'
 * }} FlowAction
 *
 * @typedef {{
 * persona?: string,
 * actions: FlowAction[]
 * }} FlowScenario
 *
 * @typedef {{
 * state: InMemoryListState,
 * scenario: FlowScenario
 * }} FlowFixture
 *
 * @typedef {{
 * client: MockSharePointClient,
 * saveQueue: SaveQueue,
 * viewModel: CaseReviewViewModel | null,
 * snapshot: () => { lists: Record<string, CaseRow[]> },
 * run: (actions: FlowAction[]) => Promise<{ lists: Record<string, CaseRow[]> }>
 * }} InMemoryFlowRunner
 */

const DEFAULT_PERSONAS = {
  reviewer: {
    userId: 'user-reviewer',
    displayName: 'Reviewer',
    groups: ['Reviewers'],
  },
};

/**
 * @param {InMemoryListState} state
 * @param {{ persona?: string }} [opts]
 */
export function createMockClientFromState(state, opts = {}) {
  return new MockSharePointClient({
    questionDefinitions: state.questionDefinitions ?? [],
    personas: state.personas ?? DEFAULT_PERSONAS,
    persona: opts.persona ?? 'reviewer',
    people: state.people ?? [],
    exportHashes: state.exportHashes ?? {},
    versionedExports: state.versionedExports ?? {},
    lists: state.lists ?? {},
  });
}

/**
 * @param {InMemoryListState} state
 * @param {{ persona?: string }} [opts]
 * @returns {InMemoryFlowRunner}
 */
export function createInMemoryFlowRunner(state, opts = {}) {
  const persona = opts.persona ?? 'reviewer';
  const client = createMockClientFromState(
    {
      ...state,
      personas: state.personas
        ? {
            ...state.personas,
            [persona]: state.personas[persona] ?? DEFAULT_PERSONAS.reviewer,
          }
        : DEFAULT_PERSONAS,
    },
    { persona }
  );
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  /** @type {CaseReviewViewModel | null} */
  let viewModel = null;

  /** @type {InMemoryFlowRunner} */
  const runner = {
    client,
    saveQueue,
    get viewModel() {
      return viewModel;
    },
    snapshot() {
      return client.snapshot();
    },
    async run(actions) {
      for (const action of actions) await runAction(action);
      if (viewModel) await saveQueue.flushCase(viewModel.caseId);
      return client.snapshot();
    },
  };

  /** @param {FlowAction} action */
  async function runAction(action) {
    switch (action.type) {
      case 'allocateCase':
        await allocateCase(action);
        return;
      case 'loadCasePage':
        viewModel = await loadCasePage(action);
        return;
      case 'answer':
        requirePage(action).handleAnswer(action.questionId, action.value);
        await flushCurrentCase();
        return;
      case 'captureIssue':
        requirePage(action).handleCapture(
          action.questionId,
          action.fieldKey,
          action.value
        );
        await flushCurrentCase();
        return;
      case 'selectRemediationAction':
        requirePage(action).handleRemediationAction(
          action.questionId,
          action.action,
          action.selected ?? true
        );
        await flushCurrentCase();
        return;
      case 'freeFormRemediation':
        requirePage(action).handleRemediationFreeForm(
          action.questionId,
          action.value
        );
        await flushCurrentCase();
        return;
      case 'setActionStatus':
        requirePage(action).handleActionStatus(
          action.questionId,
          action.fieldKey,
          action.actionId,
          action.status,
          action.cancelReason
        );
        await flushCurrentCase();
        return;
      case 'clickCompleteCase':
        await clickCompleteCase(requirePage(action));
        return;
      case 'raiseAppeal':
        await raiseCurrentAppeal(action);
        return;
      case 'resolveAppeal':
        await resolveCurrentAppeal(action);
        return;
      case 'flush':
        await flushCurrentCase();
        return;
      default:
        throw new Error(
          `Unsupported flow action: ${/** @type {any} */ (action).type}`
        );
    }
  }

  /** @param {Extract<FlowAction, { type: 'allocateCase' }>} action */
  async function allocateCase(action) {
    const config = await loadCaseTypeConfig(action.caseType);
    const opts = config.listName ? { listName: config.listName } : {};
    const row = await client.getCase(action.caseId, opts);
    if (!row)
      throw new Error(`Cannot allocate missing Case "${action.caseId}".`);
    const result = await client.patchCase(
      action.caseId,
      { assignedReviewer: action.reviewerId },
      row.etag,
      opts
    );
    if (!result.ok) {
      throw new Error(`Case allocation failed with status ${result.status}.`);
    }
  }

  /** @param {Extract<FlowAction, { type: 'loadCasePage' }>} action */
  async function loadCasePage(action) {
    const userGroups = await client.getCurrentUserGroups();
    const currentUser = await client.getCurrentUser();
    const vm = new CaseReviewViewModel({
      client,
      saveQueue,
      caseId: action.caseId,
      currentUserId: action.currentUserId ?? currentUser.id,
      capabilities:
        action.capabilities === undefined
          ? resolveCapabilities(userGroups)
          : action.capabilities,
      caseType: action.caseType ?? null,
    });
    await vm.load();
    if (vm.error.get())
      throw new Error(vm.error.get() ?? 'Case failed to load.');
    if (vm.accessDenied.get()) throw new Error('Case access denied.');
    return vm;
  }

  async function flushCurrentCase() {
    if (viewModel) await saveQueue.flushCase(viewModel.caseId);
  }

  /** @param {Extract<FlowAction, { type: 'raiseAppeal' }>} action */
  async function raiseCurrentAppeal(action) {
    const vm = requirePage(action);
    if (vm.access.appealRequest !== 'edit') {
      throw new Error('Current actor cannot raise an Appeal.');
    }
    if (!vm.caseRow)
      throw new Error('Cannot raise before the Case has loaded.');
    const result = raiseAppeal({
      caseRow: vm.caseRow,
      appellant: action.actorId,
      rationale: action.rationale,
      citedAnswerKeys: action.citedAnswerKeys ?? [],
      id: `flow-appeal-${Date.now()}`,
      at: new Date().toISOString(),
    });
    vm.caseRow = result.caseRow;
    saveQueue.enqueue(vm.caseId, 'appeals', result.appeals);
    await flushCurrentCase();
  }

  /** @param {Extract<FlowAction, { type: 'resolveAppeal' }>} action */
  async function resolveCurrentAppeal(action) {
    const vm = requirePage(action);
    if (vm.access.appealReview !== 'edit') {
      throw new Error('Current actor cannot resolve an Appeal.');
    }
    const appeal = /** @type {import('../sharepoint-client.js').Appeal} */ (
      (vm.caseRow?.appeals ?? []).find(
        (candidate) => candidate.state !== 'resolved'
      )
    );
    if (!vm.caseRow || !appeal) {
      throw new Error('Cannot resolve without an open Appeal.');
    }
    const result = resolveAppeal({
      caseRow: vm.caseRow,
      appealId: appeal.id,
      verdict: action.verdict,
      rationale: action.rationale,
      resolver: action.actorId,
      at: new Date().toISOString(),
      outcome: action.outcome,
      justification: action.justification,
    });
    vm.caseRow = result.caseRow;
    if (result.transactional) {
      saveQueue.enqueueFields(vm.caseId, result.fields);
    } else {
      saveQueue.enqueue(vm.caseId, 'appeals', result.fields.appeals);
    }
    await flushCurrentCase();
  }

  /**
   * @param {FlowAction} action
   * @returns {CaseReviewViewModel}
   */
  function requirePage(action) {
    if (!viewModel) {
      throw new Error(
        `Cannot run "${action.type}" before a loadCasePage action.`
      );
    }
    return viewModel;
  }

  return runner;
}

/** @param {CaseReviewViewModel} vm */
async function clickCompleteCase(vm) {
  if (!vm.caseRow || !vm.config || !vm.machine) {
    throw new Error('Cannot complete before the Case page has loaded.');
  }

  const patchFields = completionPatch({
    machine: vm.machine,
    caseRow: vm.caseRow,
    answers: vm.answersSignal.get(),
    allAnswered: vm.allAnswered.get(),
    computeOutcome: vm.config.computeOutcome,
    exportHash: vm.exportHash,
  });

  await completeCase({
    caseId: vm.caseRow.id,
    client: vm.client,
    saveQueue: vm.saveQueue,
    patchFields,
    caseListOptions: vm.caseListOptions,
  });
}

/**
 * @param {FlowFixture} fixture
 * @returns {Promise<{ lists: Record<string, CaseRow[]> }>}
 */
export async function runFlowFixture(fixture) {
  const runner = createInMemoryFlowRunner(fixture.state, {
    persona: fixture.scenario.persona,
  });
  return await runner.run(fixture.scenario.actions);
}
