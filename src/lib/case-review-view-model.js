// @ts-check
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

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */

export class CaseReviewViewModel {
  /**
   * @param {SharePointClient} client
   * @param {SaveQueue} saveQueue
   * @param {string} caseId
   * @param {string} currentUserId
   * @param {import('../services/permissions.js').Capabilities | null} capabilities
   */
  constructor(client, saveQueue, caseId, currentUserId, capabilities) {
    this.client = client;
    this.saveQueue = saveQueue;
    this.caseId = caseId;
    this.currentUserId = currentUserId;
    this.capabilities = capabilities;

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
    const [caseRow, currentUser] = await Promise.all([
      client.getCase(caseId),
      client.getCurrentUser(),
    ]);

    if (!caseRow) {
      this.error.set('Case not found.');
      return;
    }

    this.caseRow = caseRow;
    this.currentUser = currentUser;
    saveQueue.loadCase(caseRow);

    const [caseTypeModule, exportHash] = await Promise.all([
      import(`../../case-types/${caseRow.caseType}.js`),
      this.client.getExportHash(caseRow.caseType),
    ]);
    this.config = caseTypeModule.default;
    this.exportHash = exportHash;

    validateCaptureGroups(this.config.captureGroups);
    this.catalogue = this.config.questions.filter((q) => !q.deprecated);
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

    this.machine = new CaseMachine(
      caseRow,
      { id: actualUserId },
      caps,
      this.config
    );
    this.roles = this.machine.roles;
    this.access = this.machine.access;

    if (SECTIONS.every((s) => this.access[s] === 'hidden')) {
      this.accessDenied.set(true);
      this.loaded.set(true);
      return;
    }

    this.summarySections = SUMMARY_SECTIONS.filter(
      (s) => this.access[s] !== 'hidden' && showInSummary(s, this.config)
    );

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
    const accounts = [];
    for (const answer of Object.values(this.answersSignal.get())) {
      const login = answer.attributedParty?.loginName;
      if (login && !accounts.includes(login)) accounts.push(login);
    }
    if (accounts.length === 0) return;

    const resolved = await this.client.resolveUsers(accounts);
    let changed = false;
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
    const mod = await import(`../../case-types/${original.caseType}.js`);
    const origConfig = mod.default;
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
