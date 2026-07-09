// @ts-check
// CaseReviewViewModel is the Case Review page's state model: it loads the Case,
// catalogue, roles and access, exposes them as signals/computeds, and holds the
// answer-mutation handlers that persist through the SaveQueue. The page
// (CaseReviewPage) is a plain function component that reads these signals inside
// reactive(); the view-model owns state, not rendering, so it is the single
// state layer reactive() reads — not a controller framework wrapped around it.

import { signal, computed } from './signal.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { materializeRemediationActions } from '../evaluators/failure-evaluator.js';
import {
  captureValue,
  validateCaptureGroups,
  findCaptureField,
} from '../evaluators/issue-capture.js';
import {
  coerceRemediationActions,
  setActionStatus,
} from '../evaluators/remediation-actions.js';
import {
  showInSummary,
  SECTIONS,
  SUMMARY_SECTIONS,
} from '../services/section-access.js';
import { CaseMachine, isReportable } from './case-machine.js';
import {
  InvalidCaseTypeConfigError,
  UnknownCaseTypeError,
  loadCaseTypeConfig,
} from '../../case-types/manifest.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

/**
 * The element that actually scrolls the app, or `window` where it does not, or
 * `null` outside a browser. The app root (`#app[data-cora-root]`) owns the
 * vertical scroll; only the styleguide/tests let the window scroll.
 *
 * @returns {Element | (Window & typeof globalThis) | null}
 */
function scrollContainer() {
  if (typeof document !== 'undefined' && document.querySelector) {
    const root = document.querySelector('#app[data-cora-root]');
    if (root) return root;
  }
  return typeof window !== 'undefined' ? window : null;
}

/**
 * Reads the scroll offset of a container, spanning both the window
 * (`scrollX`/`scrollY`) and element (`scrollLeft`/`scrollTop`) shapes. An
 * element exposes `scrollTop`; the window exposes `scrollY` instead.
 *
 * @param {Element | (Window & typeof globalThis)} target
 * @returns {{ left: number, top: number }}
 */
function readScroll(target) {
  if ('scrollTop' in target) {
    return { left: target.scrollLeft, top: target.scrollTop };
  }
  return { left: target.scrollX, top: target.scrollY };
}

/**
 * Restores a scroll offset onto a container, spanning both container shapes.
 *
 * @param {Element | (Window & typeof globalThis)} target
 * @param {number} left
 * @param {number} top
 */
function writeScroll(target, left, top) {
  if ('scrollTop' in target) {
    target.scrollLeft = left;
    target.scrollTop = top;
    return;
  }
  target.scrollTo(left, top);
}

/**
 * @param {unknown} error
 * @param {string} caseType
 * @param {boolean} isRouteCaseType
 * @returns {string | null}
 */
function caseTypeLoadErrorMessage(error, caseType, isRouteCaseType) {
  if (error instanceof UnknownCaseTypeError) {
    const subject = isRouteCaseType ? 'route Case Type' : 'Case Type';
    return `This Case cannot be opened because its ${subject} is not supported. Ask a maintainer to add "${caseType}" to the Case Type manifest.`;
  }
  if (error instanceof InvalidCaseTypeConfigError) {
    return 'This Case cannot be opened because its Case Type outcome configuration is invalid. Ask a maintainer to correct it.';
  }
  return null;
}

/**
 * @typedef {Object} CaseReviewViewModelOptions
 * @property {SharePointClient} client
 * @property {SaveQueue} saveQueue
 * @property {string} caseId
 * @property {string} currentUserId
 * @property {Capabilities | null} capabilities
 * @property {string | null} [caseType]
 */

export class CaseReviewViewModel {
  /** @param {CaseReviewViewModelOptions} options */
  constructor({
    client,
    saveQueue,
    caseId,
    currentUserId,
    capabilities,
    caseType = null,
  }) {
    this.client = client;
    this.saveQueue = saveQueue;
    this.caseId = caseId;
    this.currentUserId = currentUserId;
    this.capabilities = capabilities;
    this.caseType = caseType;
    /** @type {CaseListOptions} */
    this.caseListOptions = {};

    this.loaded = signal(false);
    this.error = signal(/** @type {string | null} */ (null));
    this.accessDenied = signal(false);

    /** @type {CaseRow | null} */
    this.caseRow = null;
    /** @type {CurrentUser | null} */
    this.currentUser = null;
    /** @type {import('../sharepoint-client.js').CaseTypeConfig | null} */
    this.config = null;
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Map<string, QuestionDefinition>} */
    this.catalogueById = new Map();

    this.answersSignal = signal(/** @type {Record<string, Answer>} */ ({}));

    this.applicableQuestions = computed(() => {
      const ids = evaluate(this.catalogue, this.answersSignal.get());
      return this.catalogue.filter((q) => ids.has(q.id));
    });

    this.allAnswered = computed(() => {
      const answers = this.answersSignal.get();
      return this.applicableQuestions
        .get()
        .every((q) => !!answers[q.id]?.value);
    });

    /** @type {string | null} */
    this.exportHash = null;

    this.versionWarning = signal(/** @type {string | null} */ (null));

    /** @type {CaseMachine | null} */
    this.machine = null;
    /** @type {import('../services/section-access.js').Role[]} */
    this.roles = [];
    /** @type {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} */
    this.access = /** @type {any} */ ({});
    /** @type {import('../services/section-access.js').Section[]} */
    this.summarySections = [];

    this.activeTab = signal('');
    this.conversationHidden = signal(true);
  }

  async load() {
    const { client, saveQueue, caseId } = this;
    /** @type {CaseTypeConfig | null} */
    let routeConfig = null;
    if (this.caseType) {
      try {
        routeConfig = await loadCaseTypeConfig(this.caseType);
      } catch (error) {
        const message = caseTypeLoadErrorMessage(error, this.caseType, true);
        if (message) {
          console.error(error);
          this.error.set(message);
          return;
        }
        throw error;
      }
      this.caseListOptions = routeConfig.listName
        ? { listName: routeConfig.listName }
        : {};
    }
    const [caseRow, currentUser] = await Promise.all([
      client.getCase(caseId, this.caseListOptions),
      client.getCurrentUser(),
    ]);

    if (!caseRow) {
      this.error.set('Case not found.');
      return;
    }

    this.caseRow = caseRow;
    this.currentUser = currentUser;
    saveQueue.loadCase(caseRow, this.caseListOptions);

    // A Case freezes at the reportable milestone, not only at final
    // completion: once reportable we load the as-reviewed bank snapshot so a
    // newly-applicable Question Definition no longer reopens the Case.
    const versionHash =
      isReportable(caseRow.status) && caseRow.questionBankVersion
        ? caseRow.questionBankVersion
        : null;

    let config = routeConfig;
    let exportHash;
    let versionedExport;
    try {
      [config, exportHash, versionedExport] = await Promise.all([
        config ? Promise.resolve(config) : loadCaseTypeConfig(caseRow.caseType),
        this.client.getExportHash(caseRow.caseType),
        versionHash
          ? this.client.getVersionedExport(caseRow.caseType, versionHash)
          : Promise.resolve(null),
      ]);
    } catch (error) {
      const message = caseTypeLoadErrorMessage(error, caseRow.caseType, false);
      if (message) {
        console.error(error);
        this.error.set(message);
        return;
      }
      throw error;
    }
    this.config = config;
    this.exportHash = exportHash;

    validateCaptureGroups(config.captureGroups);

    if (versionHash && versionedExport) {
      // Reportable Case with a published snapshot — freeze the catalogue as-reviewed.
      this.catalogue = versionedExport.questions
        .filter((q) => !q.deprecated)
        .map((q) => ({
          id: q.id,
          text: q.text,
          ...(q.category !== null ? { category: q.category } : {}),
          responseType:
            /** @type {'yes-no-na'|'single-choice'|'multi-choice'|'outcome'} */ (
              q.responseType
            ),
          ...(q.options !== null ? { options: q.options } : {}),
          ...(q.optionOutcomes != null
            ? { optionOutcomes: q.optionOutcomes }
            : {}),
          ...(q.showWhen !== null ? { showWhen: q.showWhen } : {}),
          ...(q.failureCriteria !== null
            ? { failureCriteria: q.failureCriteria }
            : {}),
          ...(q.labelIds ? { labelIds: q.labelIds } : {}),
          deprecated: q.deprecated,
        }));
    } else {
      if (versionHash && !versionedExport) {
        // Versioned file was stamped but not published — fall back with a warning.
        this.versionWarning.set('as-reviewed version unavailable');
      }
      this.catalogue = config.questions.filter((q) => !q.deprecated);
    }

    this.catalogueById = new Map(this.catalogue.map((q) => [q.id, q]));

    this.answersSignal.set({ ...caseRow.answers });

    const actualUserId = this.currentUserId || currentUser.id;
    const caps = this.capabilities || {
      isReviewer: true,
      listAccessCaseTypes: [],
      isAdviser: false,
      ownedCaseTypes: [],
      ownedJourneyCaseTypes: [],
      isControls: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      isVisitor: false,
    };

    this.machine = new CaseMachine(caseRow, { id: actualUserId }, caps, config);
    this.roles = this.machine.roles;
    this.access = this.machine.access;

    if (SECTIONS.every((s) => this.access[s] === 'hidden')) {
      this.accessDenied.set(true);
      this.loaded.set(true);
      return;
    }

    this.summarySections = SUMMARY_SECTIONS.filter(
      (s) => this.access[s] !== 'hidden' && showInSummary(s, config)
    );

    const tabs = [
      { id: 'details', hidden: this.access.details === 'hidden' },
      { id: 'questions', hidden: this.access.questions === 'hidden' },
      { id: 'issues', hidden: this.access.issues === 'hidden' },
      { id: 'remediation', hidden: this.access.remediation === 'hidden' },
      { id: 'summary', hidden: this.access.summary === 'hidden' },
      { id: 'notes', hidden: this.access.notes === 'hidden' },
      { id: 'appealRequest', hidden: this.access.appealRequest === 'hidden' },
    ];
    const firstVisible = tabs.find((t) => !t.hidden);
    if (firstVisible) this.activeTab.set(firstVisible.id);

    this.loaded.set(true);

    await this._resolveAttributedParties();
  }

  toggleConversationPanel() {
    this.conversationHidden.set(!this.conversationHidden.get());
  }

  /**
   * @param {string} questionId
   * @param {string | string[]} value
   */
  handleAnswer(questionId, value) {
    if (this.access.questions !== 'edit') return;
    const q = this.catalogueById.get(questionId);
    const baseAnswer = { ...this.answersSignal.get()[questionId], value };
    const nextAnswer = q
      ? materializeRemediationActions(q, baseAnswer)
      : baseAnswer;
    const draft = { ...this.answersSignal.get(), [questionId]: nextAnswer };

    const stillApplicable = evaluate(this.catalogue, draft);
    const newAnswers = /** @type {Record<string, Answer>} */ ({});
    for (const [id, answer] of Object.entries(draft)) {
      if (!this.catalogueById.has(id) || stillApplicable.has(id)) {
        newAnswers[id] = answer;
      }
    }

    this.answersSignal.set(newAnswers);
    this.saveQueue.enqueue(this.caseId, 'answers', newAnswers);
  }

  /**
   * @param {string} questionId
   * @param {string} fieldKey
   * @param {string} value
   */
  handleCapture(questionId, fieldKey, value) {
    if (!this.machine?.canCapture) return;
    const current = this.answersSignal.get();
    const existing = current[questionId];
    if (!existing) return;
    const captureGroups = this.config?.captureGroups || [];
    const field = findCaptureField(captureGroups, fieldKey);
    if (!field) return;
    const newAnswers = {
      ...current,
      [questionId]: captureValue(existing, field, value),
    };
    // Setting the answers signal synchronously re-renders the Issues list, which
    // rebuilds DOM above the viewport and resets the page scroll. Snapshot and
    // restore the scroll around that synchronous re-render so capturing an Issue
    // detail doesn't throw the Reviewer back to the top. No-op outside a browser.
    this._withPreservedScroll(() => this.answersSignal.set(newAnswers));
    this.saveQueue.enqueue(this.caseId, 'answers', newAnswers);
  }

  /**
   * Runs `mutate` (a synchronous signal update that triggers a re-render) while
   * holding the scroll position steady across the resulting DOM churn.
   *
   * The re-render tears down and rebuilds the Issues list — including the very
   * control the Reviewer is editing — which both breaks the browser's scroll
   * anchoring and provokes a focus-restore `.focus()` that scrolls the refocused
   * control into view. Snapshotting and restoring the scroll around the whole
   * synchronous re-render undoes both, so capturing an Issue detail leaves the
   * page exactly where it was.
   *
   * The scroll lives on the app root (`#app[data-cora-root]` is `position: fixed`
   * with its own `overflow-y: auto`), not the window — so we restore that
   * container, falling back to the window where the app is not the scroll root
   * (styleguide, tests). No-op outside a browser.
   *
   * @param {() => void} mutate
   */
  _withPreservedScroll(mutate) {
    const target = scrollContainer();
    if (!target) {
      mutate();
      return;
    }
    const { left, top } = readScroll(target);
    mutate();
    const after = readScroll(target);
    if (after.left !== left || after.top !== top)
      writeScroll(target, left, top);
  }

  /**
   * @param {string} questionId
   * @param {{ loginName: string, displayName: string } | null} attributedParty
   */
  handleAttribute(questionId, attributedParty) {
    if (!this.machine?.canAttribute) return;
    const current = this.answersSignal.get();
    const existing = current[questionId];
    if (!existing) return;
    let nextAnswer;
    if (attributedParty) {
      nextAnswer = { ...existing, attributedParty };
    } else {
      const { attributedParty: _drop, ...rest } = existing;
      nextAnswer = rest;
    }
    const newAnswers = { ...current, [questionId]: nextAnswer };
    this.answersSignal.set(newAnswers);
    this.saveQueue.enqueue(this.caseId, 'answers', newAnswers);
  }

  /**
   * Tick/untick a configured Remediation Action on a failed Answer.
   * Selection is stored as the reviewer-chosen subset on
   * `answer.remediationActions`; only these feed the per-action outcome scoring
   * in `computeConfiguredOutcome`. Gated on `canSelectRemediation` (Assigned
   * Reviewer, not-yet-reportable). Persists via the autosave SaveQueue.
   *
   * @param {string} questionId
   * @param {{ id: string, text: string }} action
   * @param {boolean} selected
   */
  handleRemediationAction(questionId, action, selected) {
    if (!this.machine?.canSelectRemediation) return;
    const current = this.answersSignal.get();
    const existing = current[questionId];
    if (!existing) return;

    const list = existing.remediationActions ?? [];
    let next;
    if (selected) {
      if (list.some((a) => a.id === action.id)) return;
      next = [...list, { id: action.id, text: action.text, completed: false }];
    } else {
      if (!list.some((a) => a.id === action.id)) return;
      next = list.filter((a) => a.id !== action.id);
    }

    let nextAnswer;
    if (next.length) {
      nextAnswer = { ...existing, remediationActions: next };
    } else {
      const { remediationActions: _drop, ...rest } = existing;
      nextAnswer = rest;
    }
    const newAnswers = { ...current, [questionId]: nextAnswer };
    this._withPreservedScroll(() => this.answersSignal.set(newAnswers));
    this.saveQueue.enqueue(this.caseId, 'answers', newAnswers);
  }

  /**
   * Capture a reviewer's free-form Remediation text on a failed Answer (issue
   * #250), stored as `answer.freeFormRemediation`. An empty value clears the
   * field. Shares the `canSelectRemediation` gate and the autosave lifecycle.
   *
   * @param {string} questionId
   * @param {string} value
   */
  handleRemediationFreeForm(questionId, value) {
    if (!this.machine?.canSelectRemediation) return;
    const current = this.answersSignal.get();
    const existing = current[questionId];
    if (!existing) return;

    let nextAnswer;
    if (value) {
      nextAnswer = { ...existing, freeFormRemediation: value };
    } else {
      const { freeFormRemediation: _drop, ...rest } = existing;
      nextAnswer = rest;
    }
    const newAnswers = { ...current, [questionId]: nextAnswer };
    this._withPreservedScroll(() => this.answersSignal.set(newAnswers));
    this.saveQueue.enqueue(this.caseId, 'answers', newAnswers);
  }

  /**
   * Resolve a single sent Remediation Action on the Remediation tracking tab
   *. Writes the new `status`/`cancelReason` back into the failed
   * Answer's `actions`-typed capture field, coercing any legacy string entries to
   * object records in the same pass. A cancelled action needs a reason; an invalid
   * change (cancelled without one) is dropped rather than persisted, leaving the
   * reviewer to supply the reason.
   *
   * @param {string} questionId
   * @param {string} fieldKey
   * @param {string} actionId
   * @param {'pending' | 'complete' | 'cancelled'} status
   * @param {string} [cancelReason]
   */
  handleActionStatus(
    questionId,
    fieldKey,
    actionId,
    status,
    cancelReason = ''
  ) {
    if (this.access.remediation !== 'edit') return;
    const current = this.answersSignal.get();
    const existing = current[questionId];
    const raw = existing?.capture?.[fieldKey];
    if (!Array.isArray(raw)) return;

    let changed = false;
    /** @type {import('../sharepoint-client.js').RemediationAction[]} */
    let next;
    try {
      next = coerceRemediationActions(raw, fieldKey).map((action) => {
        if (action.id !== actionId) return action;
        changed = true;
        return setActionStatus(action, status, cancelReason);
      });
    } catch {
      // Cancelled without a reason — a hard validation. Skip the write.
      return;
    }
    if (!changed) return;

    const newAnswer = {
      ...existing,
      capture: { ...existing.capture, [fieldKey]: next },
    };
    const newAnswers = { ...current, [questionId]: newAnswer };
    this.answersSignal.set(newAnswers);
    this.saveQueue.enqueue(this.caseId, 'answers', newAnswers);
  }

  async _resolveAttributedParties() {
    /** @type {string[]} */
    const accounts = [];
    for (const answer of Object.values(this.answersSignal.get())) {
      const login = answer.attributedParty?.loginName;
      if (login && !accounts.includes(login)) accounts.push(login);
    }
    if (accounts.length === 0) return;

    const resolved = await this.client.resolveUsers(accounts);
    let changed = false;
    /** @type {Record<string, Answer>} */
    const next = {};
    for (const [id, answer] of Object.entries(this.answersSignal.get())) {
      const party = answer.attributedParty;
      const name = party ? resolved[party.loginName] : null;
      if (party && name && name !== party.displayName) {
        next[id] = {
          ...answer,
          attributedParty: { ...party, displayName: name },
        };
        changed = true;
      } else {
        next[id] = answer;
      }
    }
    if (changed) this.answersSignal.set(next);
  }
}
