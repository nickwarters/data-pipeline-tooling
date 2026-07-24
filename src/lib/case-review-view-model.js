// @ts-check
// CaseReviewViewModel is the Case Review page's state model: it loads the Case,
// catalogue, roles and access, exposes them as signals/computeds, and holds the
// answer-mutation handlers that persist through the SaveQueue. Signals remain
// an internal state-notification detail; the store-driven page reads snapshots
// and renders through keyed morphing.

import { signal, computed } from './signal.js';
import {
  allApplicableAnswered,
  evaluate,
} from '../evaluators/applicability-evaluator.js';
import {
  materializeRemediationActions,
  withDerivedFailureValues,
} from '../evaluators/failure-evaluator.js';
import {
  captureValue,
  validateCaptureGroups,
  findCaptureField,
} from '../evaluators/issue-capture.js';
import {
  validateGeneralQuestions,
  validateAnswerKeyNamespace,
} from '../evaluators/general-questions.js';
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
  resolveSectionHeadings,
  resolveSectionLabels,
} from './section-labels.js';
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
 * @property {((answers: Record<string, Answer>) => void) | null} [onAnswersChanged]
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
    onAnswersChanged = null,
  }) {
    this.client = client;
    this.saveQueue = saveQueue;
    this.caseId = caseId;
    this.currentUserId = currentUserId;
    this.capabilities = capabilities;
    this.caseType = caseType;
    this._onAnswersChanged = onAnswersChanged;
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
    /**
     * Resolved Case Review tab labels / section headings for this Case Type —
     * `DEFAULT_SECTION_LABELS` overridden by `config.sectionLabels` (MAINT-11).
     * Populated once `config` loads; defaults until then so components have
     * something to render before `load()` resolves.
     * @type {Required<import('../sharepoint-client.js').SectionLabels>}
     */
    this.sectionLabels = resolveSectionLabels(null);
    /**
     * Resolved section headings (the in-panel `<h2>`/`<h3>` copy) — as
     * `sectionLabels` but over `DEFAULT_SECTION_HEADINGS`.
     * @type {Required<import('../sharepoint-client.js').SectionLabels>}
     */
    this.sectionHeadings = resolveSectionHeadings(null);
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Map<string, QuestionDefinition>} */
    this.catalogueById = new Map();

    this.answersSignal = signal(/** @type {Record<string, Answer>} */ ({}));

    this.applicableQuestions = computed(() => {
      const ids = evaluate(this.catalogue, this.answersSignal.get());
      return this.catalogue.filter((q) => ids.has(q.id));
    });

    this.allAnswered = computed(() =>
      allApplicableAnswered(this.catalogue, this.answersSignal.get())
    );

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

  /**
   * Install or replace the store-driven Answer effect bridge. Legacy callers
   * leave this unset and retain the existing direct SaveQueue behaviour.
   *
   * @param {((answers: Record<string, Answer>) => void) | null} handler
   */
  setAnswerChangeHandler(handler) {
    this._onAnswersChanged = handler;
  }

  /**
   * Plain snapshot consumed by the CASE-1 route store. The view model remains
   * the loading/domain adapter while the store becomes the UI state owner.
   */
  toStoreSnapshot() {
    return {
      loaded: this.loaded.get(),
      error: this.error.get(),
      accessDenied: this.accessDenied.get(),
      caseRow: this.caseRow,
      currentUser: this.currentUser,
      config: this.config,
      catalogue: this.catalogue,
      answers: this.answersSignal.get(),
      applicableQuestions: this.applicableQuestions.get(),
      allAnswered: this.allAnswered.get(),
      machine: this.machine,
      access: this.access,
      roles: this.roles,
      summarySections: this.summarySections,
      sectionLabels: this.sectionLabels,
      sectionHeadings: this.sectionHeadings,
      versionWarning: this.versionWarning.get(),
      exportHash: this.exportHash,
      caseListOptions: this.caseListOptions,
      conversationHidden: this.conversationHidden.get(),
    };
  }

  /** @param {Record<string, Answer>} answers */
  _persistAnswers(answers) {
    if (this._onAnswersChanged) {
      this._onAnswersChanged(answers);
      return;
    }
    this.saveQueue.enqueue(this.caseId, 'answers', answers);
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
    this.sectionLabels = resolveSectionLabels(config);
    this.sectionHeadings = resolveSectionHeadings(config);
    this.exportHash = exportHash;

    validateCaptureGroups(config.captureGroups);
    validateGeneralQuestions(config.generalQuestions);

    if (versionHash && versionedExport) {
      // Reportable Case with a published snapshot — freeze the catalogue as-reviewed.
      this.catalogue = versionedExport.questions
        .filter((q) => !q.deprecated)
        .map((q) => ({
          id: q.id,
          text: q.text,
          // Exports published before #390 carry no `questionGroup` key and
          // their `category` meant the inner grouping level — remap it so a
          // frozen Case keeps its as-reviewed grouping.
          ...(!('questionGroup' in q)
            ? q.category !== null
              ? { questionGroup: q.category }
              : {}
            : {
                ...(q.category !== null ? { category: q.category } : {}),
                ...(q.questionGroup != null
                  ? { questionGroup: q.questionGroup }
                  : {}),
              }),
          responseType:
            /** @type {'yes-no-na'|'single-choice'|'multi-choice'|'outcome'} */ (
              q.responseType
            ),
          ...(q.options !== null ? { options: q.options } : {}),
          ...(q.optionOutcomes != null
            ? { optionOutcomes: q.optionOutcomes }
            : {}),
          ...(q.showWhen !== null ? { showWhen: q.showWhen } : {}),
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

    // Failure is derived, not authored: annotate the catalogue with each
    // question's failing response values (every option mapped to a non-default
    // Outcome). A frozen Case derives against its snapshot's default so the
    // as-reviewed failure semantics hold even if the live config moves on.
    this.catalogue = withDerivedFailureValues(
      this.catalogue,
      (versionHash && versionedExport
        ? (versionedExport.defaultOutcomeId ?? config.defaultOutcomeId)
        : config.defaultOutcomeId) ?? ''
    );

    // The `general:` answer-key namespace only isolates General Questions from
    // the catalogue while no Question Definition id can be mistaken for one.
    validateAnswerKeyNamespace(this.catalogue);

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
    this._persistAnswers(newAnswers);
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
    // No scroll workaround here (unlike the remediation-action handlers below):
    // the Issues list patches changed items in place on a capture change, so the
    // control being edited is never detached and focus/scroll survive natively
    // (issue #308).
    this.answersSignal.set(newAnswers);
    this._persistAnswers(newAnswers);
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
    this._persistAnswers(newAnswers);
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
    this.answersSignal.set(newAnswers);
    this._persistAnswers(newAnswers);
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
    this.answersSignal.set(newAnswers);
    this._persistAnswers(newAnswers);
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
    this._persistAnswers(newAnswers);
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
