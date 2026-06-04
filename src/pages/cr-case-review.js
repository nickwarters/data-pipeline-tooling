// @ts-check
import { CRElement } from '../components/cr-element.js';
import { signal, computed } from '../lib/signal.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { computeSectionProgress } from '../evaluators/section-progress.js';
import { materializeRemediationActions } from '../evaluators/failure-evaluator.js';
import { evaluateAccess, resolveRoles, SECTIONS } from '../services/section-access.js';
import '../components/cr-question-list.js';
import '../components/cr-section-progress.js';
import '../components/cr-remediation-section.js';
import '../components/cr-conversation.js';
import '../components/cr-notes.js';
import '../components/cr-outcome.js';
import '../components/cr-status-banner.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../services/save-queue.js').SaveStatus} SaveStatus */

/** @type {Record<SaveStatus, string>} */

export class CRCaseReview extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
    /** @type {string} */
    this.currentUserId = '';
    /** @type {import('../services/permissions.js').Capabilities | null} */
    this.capabilities = null;
    /** @type {((e: KeyboardEvent) => void) | null} */
    this._keydownHandler = null;
    /** @type {HTMLElement | null} */
    this._conversationEl = null;
    /** @type {HTMLElement | null} */
    this._conversationToggleBtn = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._keydownHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
  }

  _toggleConversationPanel() {
    const el = this._conversationEl;
    const btn = this._conversationToggleBtn;
    if (!el) return;
    el.hidden = !el.hidden;
    if (btn) btn.setAttribute('aria-expanded', String(!el.hidden));
  }

  /** @param {{ altKey: boolean, code?: string }} e */
  _handleKeydown(e) {
    if (e.altKey && e.code === 'KeyC') {
      this._toggleConversationPanel();
    }
  }

  async connectedCallback() {
    const { client, saveQueue, caseId } = this;
    if (!client || !saveQueue || !caseId) return;

    const [caseRow, currentUser] = await Promise.all([
      client.getCase(caseId),
      client.getCurrentUser(),
    ]);

    if (!caseRow) {
      const p = document.createElement('p');
      p.textContent = 'Case not found.';
      this.replaceChildren(p);
      return;
    }

    saveQueue.loadCase(caseRow);

    // Dynamic import resolves relative to this module's location (src/).
    const caseTypeModule = await import(`../../case-types/${caseRow.caseType}.js`);
    /** @type {import('../sharepoint-client.js').CaseTypeConfig} */
    const config = caseTypeModule.default;
    const catalogue = config.questions.filter(q => !q.deprecated);

    const answersSignal = signal(/** @type {Record<string, Answer>} */ ({ ...caseRow.answers }));

    const applicableQuestions = computed(() => {
      const ids = evaluate(catalogue, answersSignal.get());
      return catalogue.filter(q => ids.has(q.id));
    });

    const allAnswered = computed(() => {
      const answers = answersSignal.get();
      return applicableQuestions.get().every(q => !!answers[q.id]?.value);
    });

    const currentUserId = this.currentUserId || currentUser.id;
    const capabilities = this.capabilities || /** @type {import('../services/permissions.js').Capabilities} */ (
      { isReviewer: true, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false }
    );
    const roles = resolveRoles(caseRow, currentUserId, capabilities);
    /** @type {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} */
    const access = /** @type {any} */ ({});
    for (const s of SECTIONS) access[s] = evaluateAccess(s, roles, caseRow, config);

    if (SECTIONS.every(s => access[s] === 'hidden')) {
      this._renderAccessDenied();
      return;
    }

    this._buildLayout({ caseRow, catalogue, computeOutcome: config.computeOutcome, attributeFailures: config.attributeFailures, client, saveQueue, answersSignal, applicableQuestions, allAnswered, currentUser, access });
  }

  _renderAccessDenied() {
    const panel = document.createElement('section');
    panel.className = 'cr-access-denied';
    const h2 = document.createElement('h2');
    h2.textContent = 'Access denied';
    const p = document.createElement('p');
    p.textContent = 'You do not have access to this case.';
    panel.append(h2, p);
    this.replaceChildren(panel);
  }

  /**
   * @param {object} opts
   * @param {CaseRow} opts.caseRow
   * @param {QuestionDefinition[]} opts.catalogue
   * @param {(answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult} opts.computeOutcome
   * @param {boolean} [opts.attributeFailures]
   * @param {SharePointClient} opts.client
   * @param {SaveQueue} opts.saveQueue
   * @param {{ get: () => Record<string, Answer>, set: (v: Record<string, Answer>) => void }} opts.answersSignal
   * @param {{ get: () => QuestionDefinition[] }} opts.applicableQuestions
   * @param {{ get: () => boolean }} opts.allAnswered
   * @param {CurrentUser} opts.currentUser
   * @param {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} opts.access
   */
  _buildLayout({ caseRow, catalogue, computeOutcome, attributeFailures, client, saveQueue, answersSignal, applicableQuestions, allAnswered, currentUser, access }) {

    const searchStr = typeof location !== 'undefined' ? (/** @type {any} */ (location).search ?? '') : '';
    const panelMode = new URLSearchParams(searchStr).get('conversation') ?? 'popover';
    this.setAttribute('data-conversation-mode', panelMode);

    const header = document.createElement('header');
    const h1 = document.createElement('h1');
    h1.textContent = caseRow.title;
    const reviewerP = document.createElement('p');
    reviewerP.textContent = `Reviewer: ${caseRow.assignedReviewer}`;

    const bannerEl = /** @type {import('../components/cr-status-banner.js').CRStatusBanner} */ (
      document.createElement('cr-status-banner')
    );
    bannerEl.saveQueue = saveQueue;

    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = 'Questions';
    const qList = /** @type {import('../components/cr-question-list.js').CRQuestionList} */ (
      document.createElement('cr-question-list')
    );
    qList.access = access.questions;
    const progressEl = /** @type {import('../components/cr-section-progress.js').CRSectionProgress} */ (
      document.createElement('cr-section-progress')
    );
    section.append(h2, qList, progressEl);

    /** @type {Map<string, QuestionDefinition>} */
    const byId = new Map(catalogue.map(q => [q.id, q]));

    section.addEventListener('cr-answer', (ev) => {
      if (access.questions !== 'edit') return;
      const { questionId, value } =
        /** @type {CustomEvent<{ questionId: string, value: string | string[] }>} */ (ev).detail;
      const q = byId.get(questionId);
      const baseAnswer = { ...answersSignal.get()[questionId], value };
      const nextAnswer = q ? materializeRemediationActions(q, baseAnswer) : baseAnswer;
      const draft = { ...answersSignal.get(), [questionId]: nextAnswer };
      // Drop answers for questions that are no longer applicable so a hidden
      // conditional question does not retain its previously-selected value.
      const stillApplicable = evaluate(catalogue, draft);
      const newAnswers = /** @type {Record<string, Answer>} */ ({});
      for (const [id, answer] of Object.entries(draft)) {
        if (!byId.has(id) || stillApplicable.has(id)) {
          newAnswers[id] = answer;
        }
      }
      answersSignal.set(newAnswers);
      saveQueue.enqueue(caseRow.id, 'answers', newAnswers);
    });

    section.addEventListener('cr-section-jump', (ev) => {
      const { section: sectionName } = /** @type {CustomEvent<{ section: string }>} */ (ev).detail;
      const children = qList.questionElements ?? [];
      const target = children.find(c => c.question?.category === sectionName ||
        (!c.question?.category && sectionName === 'General'));
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });

    section.addEventListener('cr-jump-unanswered', () => {
      const children = qList.questionElements ?? [];
      const answers = answersSignal.get();
      const target = children.find(c => {
        if (!c.question) return false;
        const v = answers[c.question.id]?.value;
        return Array.isArray(v) ? v.length === 0 : !v;
      });
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });

    const remediationSection = /** @type {import('../components/cr-remediation-section.js').CRRemediationSection} */ (
      document.createElement('cr-remediation-section')
    );
    remediationSection.client = client;
    // Attribution is editable only for the Assigned Reviewer (remediation edit)
    // on an In-progress Case — frozen at completion per ADR-0013. The matrix
    // does not freeze on status, so the status guard lives here.
    const canAttribute = attributeFailures === true
      && access.remediation === 'edit'
      && caseRow.status === 'In-progress';
    remediationSection.canAttribute = canAttribute;
    // The Case's Responsible Party, offered as a one-click quick-pick in each
    // attribute menu. Stored as a bare account today, so displayName mirrors it
    // until the page-load resolver (issue #97) supplies a real name.
    remediationSection.responsibleParty = caseRow.responsibleParty
      ? { loginName: caseRow.responsibleParty, displayName: caseRow.responsibleParty }
      : null;
    remediationSection.addEventListener('cr-attribute', (ev) => {
      if (!canAttribute) return;
      const { questionId, attributedParty } =
        /** @type {CustomEvent<{ questionId: string, attributedParty: { loginName: string, displayName: string } | null }>} */ (ev).detail;
      const current = answersSignal.get();
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
      answersSignal.set(newAnswers);
      saveQueue.enqueue(caseRow.id, 'answers', newAnswers);
    });

    const outcomeEl = /** @type {import('../components/cr-outcome.js').CROutcome} */ (
      document.createElement('cr-outcome')
    );

    // viewState combines applicability + answers + allAnswered so the subscribe fires once per state change.
    const viewState = computed(() => ({
      questions: applicableQuestions.get(),
      answers: answersSignal.get(),
      allAnswered: allAnswered.get(),
    }));
    this.subscribe(viewState, ({ questions, answers, allAnswered: done }) => {
      qList.update(questions, answers);
      remediationSection.update(catalogue, answers, attributeFailures);
      outcomeEl.update(computeOutcome, answers, done);
      const sectionData = computeSectionProgress(catalogue, answers);
      const unanswered = questions.filter(q => {
        const v = answers[q.id]?.value;
        return Array.isArray(v) ? v.length === 0 : !v;
      });
      progressEl.update(sectionData, unanswered);
    });

    const completeBtn = document.createElement('button');
    completeBtn.className = 'cr-complete-btn';
    completeBtn.textContent = 'Complete Case';
    completeBtn.hidden = true;

    const canComplete = access.questions === 'edit'
      && caseRow.assignedReviewer === (this.currentUserId || currentUser.id)
      && caseRow.status === 'In-progress';
    this.subscribe(allAnswered, answered => {
      completeBtn.hidden = !(answered && canComplete);
    });

    completeBtn.addEventListener('click', async () => {
      if (completeBtn.disabled) return;
      completeBtn.disabled = true;
      await this._completeCase(caseRow.id, client, saveQueue);
      completeBtn.disabled = false;
    });

    const conversationEl = /** @type {import('../components/cr-conversation.js').CRConversation} */ (
      document.createElement('cr-conversation')
    );
    conversationEl.client = client;
    conversationEl.saveQueue = saveQueue;
    conversationEl.caseId = caseRow.id;
    conversationEl.currentUser = currentUser;
    conversationEl.access = access.conversation;
    conversationEl._messages = caseRow.conversation.slice();
    // Always start hidden; the toggle button controls visibility.
    /** @type {any} */ (conversationEl).hidden = true;
    this._conversationEl = /** @type {HTMLElement} */ (/** @type {unknown} */ (conversationEl));

    const canToggle = access.conversation !== 'hidden';
    if (canToggle) {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'cr-conversation-toggle-btn';
      toggleBtn.textContent = 'Conversation';
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-label', 'Toggle conversation panel (⌥C / Alt+C)');
      toggleBtn.addEventListener('click', () => this._toggleConversationPanel());
      this._conversationToggleBtn = /** @type {HTMLElement} */ (/** @type {unknown} */ (toggleBtn));
      this._keydownHandler = (/** @type {KeyboardEvent} */ e) => this._handleKeydown(e);
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', this._keydownHandler);
      }
      header.append(h1, reviewerP, toggleBtn);
    } else {
      header.append(h1, reviewerP);
    }

    const notesEl = /** @type {import('../components/cr-notes.js').CRNotes} */ (
      document.createElement('cr-notes')
    );
    notesEl.notes = caseRow.notes;
    notesEl.saveQueue = saveQueue;
    notesEl.caseId = caseRow.id;
    notesEl.access = access.notes;

    /** @type {HTMLElement[]} */
    const children = [
      /** @type {HTMLElement} */ (/** @type {unknown} */ (bannerEl)),
      header,
      section,
      /** @type {HTMLElement} */ (/** @type {unknown} */ (remediationSection)),
      /** @type {HTMLElement} */ (/** @type {unknown} */ (outcomeEl)),
      /** @type {HTMLElement} */ (/** @type {unknown} */ (conversationEl)),
      /** @type {HTMLElement} */ (/** @type {unknown} */ (notesEl)),
      completeBtn,
    ];
    // Hide rather than unmount so existing layout indices stay stable and so
    // tests can still inspect properties on the hidden elements.
    if (access.questions === 'hidden') section.hidden = true;
    if (access.remediation === 'hidden') /** @type {any} */ (remediationSection).hidden = true;
    if (access.outcome === 'hidden') /** @type {any} */ (outcomeEl).hidden = true;
    if (access.notes === 'hidden') /** @type {any} */ (notesEl).hidden = true;

    this.replaceChildren(...children);
  }

  /**
   * Patches the case status to Completed and navigates to the dashboard.
   * @param {string} caseId
   * @param {SharePointClient} [clientArg]
   * @param {SaveQueue} [saveQueueArg]
   */
  async _completeCase(caseId, clientArg, saveQueueArg) {
    const client = clientArg ?? this.client;
    const saveQueue = saveQueueArg ?? this.saveQueue;
    if (!client || !saveQueue) return;

    const etag = saveQueue.getEtag(caseId);
    const result = await client.patchCase(
      caseId,
      {
        status: /** @type {'Completed'} */ ('Completed'),
        completedAt: new Date().toISOString(),
      },
      etag
    );
    if (result.ok) {
      location.hash = '#/dashboard';
    }
  }
}

customElements.define('cr-case-review', CRCaseReview);
