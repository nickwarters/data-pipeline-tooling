// @ts-check

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../src/sharepoint-client.js').VersionedExport} VersionedExport */
/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

import { CaseLoader } from '../src/lib/case-loader.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { resolveCapabilities } from '../src/services/permissions.js';
import { SaveQueue } from '../src/services/save-queue.js';
import {
  completeCase,
  completionPatch,
} from '../src/pages/cora-case-review/completion-actions.js';
import { openAppealOf } from '../src/pages/cora-case-review/appeal-actions.js';
import { createAppealEffects } from '../src/pages/cora-case-review/appeal-effects.js';
import {
  answerEdited,
  issueCaptured,
  remediationActionToggled,
  remediationFreeFormEdited,
  remediationRequiredSet,
  remediationResolved,
} from '../src/pages/cora-case-review/answer-actions.js';
import { allApplicableAnswered } from '../src/evaluators/applicability-evaluator.js';
import { loadCaseTypeConfig } from '../case-types/manifest.js';

/**
 * @typedef {{
 * lists?: Record<string, CaseRow[]>,
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
 * capabilities?: Capabilities
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
 * type: 'setRemediationRequired',
 * questionId: string,
 * required: 'yes' | 'no'
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
 * type: 'setRemediationStatus',
 * questionId: string,
 * status: 'complete' | 'partial' | 'cancelled' | '',
 * details?: string
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
 * caseLoader: CaseLoader | null,
 * answers: Record<string, import('../src/sharepoint-client.js').Answer>,
 * caseRow: CaseRow | null,
 * navigations: string[],
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
  /** @type {CaseLoader | null} */
  let caseLoader = null;
  /**
   * The runner stands in for the store: it is the single Answer owner, exactly
   * as the route is in the browser. The loader hands its Answers over
   * once, and every later edit goes through one writer.
   * @type {Record<string, import('../src/sharepoint-client.js').Answer>}
   */
  let answers = {};
  /**
   * The Case Row, owned here for the same reason: the loader hands it
   * over once and the Appeal/amend transitions read and replace this copy, so
   * `CaseLoader.caseRow` is written only by `load()`.
   * @type {CaseRow | null}
   */
  let caseRow = null;
  /**
   * Where the app would have navigated. The runner has no `location`, and the
   * action it drives no longer sniffs for one: `completeCase` takes the
   * navigation as a callback, so the harness records it and a flow can assert
   * that completing a Case leaves the Case page rather than merely tolerating
   * that it tried.
   * @type {string[]}
   */
  const navigations = [];

  /** @param {Record<string, import('../src/sharepoint-client.js').Answer> | null} next */
  function editAnswers(next) {
    if (next === null || !caseLoader) return;
    answers = next;
    saveQueue.enqueue(caseLoader.caseId, 'answers', answers);
  }

  /** @type {InMemoryFlowRunner} */
  const runner = {
    client,
    saveQueue,
    get caseLoader() {
      return caseLoader;
    },
    get answers() {
      return answers;
    },
    get caseRow() {
      return caseRow;
    },
    get navigations() {
      return [...navigations];
    },
    snapshot() {
      return client.snapshot();
    },
    async run(actions) {
      for (const action of actions) await runAction(action);
      if (caseLoader) await saveQueue.flushCase(caseLoader.caseId);
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
        caseLoader = await loadCasePage(action);
        answers = caseLoader.answers;
        caseRow = caseLoader.caseRow;
        return;
      case 'answer': {
        const loader = requirePage(action);
        editAnswers(
          answerEdited({
            answers,
            catalogue: loader.catalogue,
            questionId: action.questionId,
            value: action.value,
            canEdit: loader.access.questions === 'edit',
          })
        );
        await flushCurrentCase();
        return;
      }
      case 'captureIssue': {
        const loader = requirePage(action);
        editAnswers(
          issueCaptured({
            answers,
            captureGroups: loader.config?.captureGroups ?? [],
            questionId: action.questionId,
            fieldKey: action.fieldKey,
            value: action.value,
            canEditIssues: loader.machine?.canEditIssues ?? false,
          })
        );
        await flushCurrentCase();
        return;
      }
      case 'setRemediationRequired': {
        const loader = requirePage(action);
        editAnswers(
          remediationRequiredSet({
            answers,
            questionId: action.questionId,
            required: action.required,
            canEditIssues: loader.machine?.canEditIssues ?? false,
          })
        );
        await flushCurrentCase();
        return;
      }
      case 'selectRemediationAction': {
        const loader = requirePage(action);
        editAnswers(
          remediationActionToggled({
            answers,
            questionId: action.questionId,
            action: action.action,
            selected: action.selected ?? true,
            canEditIssues: loader.machine?.canEditIssues ?? false,
          })
        );
        await flushCurrentCase();
        return;
      }
      case 'freeFormRemediation': {
        const loader = requirePage(action);
        editAnswers(
          remediationFreeFormEdited({
            answers,
            questionId: action.questionId,
            value: action.value,
            canEditIssues: loader.machine?.canEditIssues ?? false,
          })
        );
        await flushCurrentCase();
        return;
      }
      case 'setRemediationStatus': {
        const loader = requirePage(action);
        editAnswers(
          remediationResolved({
            answers,
            questionId: action.questionId,
            status: action.status,
            details: action.details,
            canResolve: loader.access.remediation === 'edit',
          })
        );
        await flushCurrentCase();
        return;
      }
      case 'clickCompleteCase': {
        const applied = await clickCompleteCase(
          requirePage(action),
          caseRow,
          answers,
          (hash) => navigations.push(hash)
        );
        if (applied && caseRow) caseRow = { ...caseRow, ...applied };
        return;
      }
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
    const loader = new CaseLoader({
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
    await loader.load();
    if (loader.error) throw new Error(loader.error);
    if (loader.accessDenied) throw new Error('Case access denied.');
    return loader;
  }

  async function flushCurrentCase() {
    if (caseLoader) await saveQueue.flushCase(caseLoader.caseId);
  }

  /**
   * The route's own Appeal persistence, driven headlessly. The runner
   * used to carry a second copy of it — the same clock and id stamping, the
   * same transactional/append fork onto the SaveQueue — which meant the flow
   * suite could pass while the real page wrote something else.
   *
   * @param {CaseLoader} loader
   * @param {string} actorId who the transition is attributed to
   */
  function appealEffectsFor(loader, actorId) {
    return {
      snapshot: { currentUser: { id: actorId } },
      effects: createAppealEffects({
        saveQueue,
        caseId: () => loader.caseId,
        dispatch: ({ snapshot }) => {
          caseRow = snapshot.caseRow;
        },
        newId: (prefix) => `flow-${prefix}-${Date.now()}`,
      }),
    };
  }

  /** @param {Extract<FlowAction, { type: 'raiseAppeal' }>} action */
  async function raiseCurrentAppeal(action) {
    const loader = requirePage(action);
    if (loader.access.appealRequest !== 'edit') {
      throw new Error('Current actor cannot raise an Appeal.');
    }
    if (!caseRow) throw new Error('Cannot raise before the Case has loaded.');
    const { effects, snapshot } = appealEffectsFor(loader, action.actorId);
    effects.raise({
      caseRow,
      snapshot,
      rationale: action.rationale,
      citedAnswerKeys: action.citedAnswerKeys ?? [],
    });
    await flushCurrentCase();
  }

  /** @param {Extract<FlowAction, { type: 'resolveAppeal' }>} action */
  async function resolveCurrentAppeal(action) {
    const loader = requirePage(action);
    if (loader.access.appealReview !== 'edit') {
      throw new Error('Current actor cannot resolve an Appeal.');
    }
    const appeal = openAppealOf(caseRow);
    if (!caseRow || !appeal) {
      throw new Error('Cannot resolve without an open Appeal.');
    }
    const { effects, snapshot } = appealEffectsFor(loader, action.actorId);
    effects.resolve({
      caseRow,
      snapshot,
      resolution: {
        appealId: appeal.id,
        verdict: action.verdict,
        rationale: action.rationale,
        outcome: action.outcome,
        justification: action.justification,
      },
    });
    await flushCurrentCase();
  }

  /**
   * @param {FlowAction} action
   * @returns {CaseLoader}
   */
  function requirePage(action) {
    if (!caseLoader) {
      throw new Error(
        `Cannot run "${action.type}" before a loadCasePage action.`
      );
    }
    return caseLoader;
  }

  return runner;
}

/**
 * Completing a Case persists lifecycle fields that the route now folds back into
 * its store as a Case Row patch — it no longer relies on `completeCase`
 * navigating to the dashboard to make the stale row unobservable. The runner has
 * no browser to navigate: it records the navigation rather than performing it,
 * so a flow may keep acting on the Case afterwards. It returns the persisted
 * patch and the caller applies it, which is how the runner-owned row stays the
 * row as stored.
 *
 * @param {CaseLoader} loader
 * @param {CaseRow | null} caseRow The runner-owned Case Row.
 * @param {Record<string, import('../src/sharepoint-client.js').Answer>} answers
 * @param {(hash: string) => void} navigate Recorder standing in for the browser
 *   seam.
 * @returns {Promise<Partial<CaseRow> | null>} The applied fields, or `null` if
 *   the transition was not permitted or the write failed.
 */
async function clickCompleteCase(loader, caseRow, answers, navigate) {
  if (!caseRow || !loader.config || !loader.machine) {
    throw new Error('Cannot complete before the Case page has loaded.');
  }

  const patchFields = completionPatch({
    machine: loader.machine,
    caseRow,
    catalogue: loader.catalogue,
    answers,
    allAnswered: allApplicableAnswered(loader.catalogue, answers),
    captureGroups: loader.config.captureGroups ?? [],
    computeOutcome: loader.config.computeOutcome,
    exportHash: loader.exportHash,
  });

  const ok = await completeCase({
    caseId: caseRow.id,
    client: loader.client,
    saveQueue: loader.saveQueue,
    patchFields,
    caseListOptions: loader.caseListOptions,
    navigate,
  });
  return ok ? patchFields : null;
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
