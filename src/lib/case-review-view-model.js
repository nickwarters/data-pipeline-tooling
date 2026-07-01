// @ts-check
// TODO(simplify-ui): Simplify this orchestration boundary into plain
// state transition and binding functions that can be called from function
// components. Avoid preserving controller/view-model objects as a second
// framework layer around reactive().

import { signal, computed } from './signal.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { materializeRemediationActions } from '../evaluators/failure-evaluator.js';
import {
  captureValue,
  validateCaptureGroups,
  findCaptureField,
} from '../evaluators/issue-capture.js';
import {
  showInSummary,
  SECTIONS,
  SUMMARY_SECTIONS,
} from '../services/section-access.js';
import { CaseMachine } from './case-machine.js';
import {
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

export class CaseReviewViewModel {
  /**
   * @param {SharePointClient} client
   * @param {SaveQueue} saveQueue
   * @param {string} caseId
   * @param {string} currentUserId
   * @param {import('../services/permissions.js').Capabilities | null} capabilities
   * @param {string | null} [caseType]
   */
  constructor(
    client,
    saveQueue,
    caseId,
    currentUserId,
    capabilities,
    caseType = null
  ) {
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

    /** @type {any} */
    this.sourceCase = null;

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
        if (error instanceof UnknownCaseTypeError) {
          console.error(error);
          this.error.set(
            `This Case cannot be opened because its route Case Type is not supported. Ask a maintainer to add "${this.caseType}" to the Case Type manifest.`
          );
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

    const versionHash =
      caseRow.status === 'Completed' && caseRow.questionBankVersion
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
      if (error instanceof UnknownCaseTypeError) {
        console.error(error);
        this.error.set(
          `This Case cannot be opened because its Case Type is not supported. Ask a maintainer to add "${caseRow.caseType}" to the Case Type manifest.`
        );
        return;
      }
      throw error;
    }
    this.config = config;
    this.exportHash = exportHash;

    validateCaptureGroups(config.captureGroups);

    if (versionHash && versionedExport) {
      // Completed Case with a published snapshot — freeze the catalogue as-reviewed.
      this.catalogue = versionedExport.questions
        .filter((q) => !q.deprecated)
        .map((q) => ({
          id: q.id,
          text: q.text,
          ...(q.category !== null ? { category: q.category } : {}),
          responseType:
            /** @type {'yes-no-na'|'single-choice'|'multi-choice'} */ (
              q.responseType
            ),
          ...(q.options !== null ? { options: q.options } : {}),
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
      ownedCaseTypes: [],
      isResponsibleParty: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      isQaReviewer: false,
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

    try {
      this.sourceCase = caseRow.sourceCaseId
        ? await this._resolveSourceCase(
            caseRow.sourceCaseId,
            caseRow.id,
            client,
            saveQueue,
            actualUserId,
            caps
          )
        : null;
    } catch (error) {
      if (error instanceof UnknownCaseTypeError) {
        console.error(error);
        this.error.set(
          `This Case cannot be opened because its source Case Type is not supported. Ask a maintainer to add "${error.slug}" to the Case Type manifest.`
        );
        return;
      }
      throw error;
    }

    const tabs = [
      { id: 'details', hidden: this.access.details === 'hidden' },
      { id: 'questions', hidden: this.access.questions === 'hidden' },
      { id: 'remediation', hidden: this.access.remediation === 'hidden' },
      { id: 'summary', hidden: this.access.summary === 'hidden' },
      { id: 'notes', hidden: this.access.notes === 'hidden' },
      { id: 'appeal', hidden: this.access.appeal === 'hidden' },
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
   * holding the window scroll position steady across the resulting DOM churn.
   * @param {() => void} mutate
   */
  _withPreservedScroll(mutate) {
    if (typeof window === 'undefined') {
      mutate();
      return;
    }
    const x = window.scrollX;
    const y = window.scrollY;
    mutate();
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
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

  /**
   * @param {string} sourceCaseId
   * @param {string} qaCaseId
   * @param {SharePointClient} client
   * @param {SaveQueue} saveQueue
   * @param {string} currentUserId
   * @param {Capabilities} capabilities
   */
  async _resolveSourceCase(
    sourceCaseId,
    qaCaseId,
    client,
    saveQueue,
    currentUserId,
    capabilities
  ) {
    const original = await client.getCase(sourceCaseId);
    if (!original) {
      return {
        originalRow: null,
        catalogue: [],
        computeOutcome: null,
        attributeFailures: false,
        remediationFields: [],
        overrideAccess: 'read-only',
        sourceCaseId: qaCaseId,
      };
    }

    saveQueue.loadCase(original);
    const origConfig = await loadCaseTypeConfig(original.caseType);
    const origCatalogue = origConfig.questions.filter((q) => !q.deprecated);

    const origMachine = new CaseMachine(
      original,
      { id: currentUserId },
      capabilities,
      origConfig
    );
    const mode = origMachine.access.questions;
    const overrideAccess = mode === 'override' ? 'override' : 'read-only';

    return {
      originalRow: original,
      catalogue: origCatalogue,
      computeOutcome: origConfig.computeOutcome,
      attributeFailures: origConfig.attributeFailures === true,
      remediationFields: origConfig.remediationFields ?? [],
      overrideAccess,
      sourceCaseId: qaCaseId,
    };
  }
}
