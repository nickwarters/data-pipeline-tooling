// @ts-check
import { CRElement } from './cr-element.js';
import { signal, computed } from './signal.js';
import { evaluate } from './applicability-evaluator.js';
import { materializeRemediationActions } from './failure-evaluator.js';
import './cr-question-list.js';
import './cr-remediation-section.js';
import './cr-conversation.js';
import './cr-notes.js';
import './cr-outcome.js';
import './cr-status-banner.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('./sharepoint-client.js').Answer} Answer */
/** @typedef {import('./sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('./save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('./save-queue.js').SaveStatus} SaveStatus */

/** @type {Record<SaveStatus, string>} */
const STATUS_LABELS = {
  saved: 'Saved',
  saving: 'Saving…',
  reconnecting: 'Reconnecting…',
  conflict: 'Conflict — reload',
};

export class CRCaseReview extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
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
    const caseTypeModule = await import(`../case-types/${caseRow.caseType}.js`);
    /** @type {import('./sharepoint-client.js').CaseTypeConfig} */
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

    this._buildLayout(caseRow, catalogue, config.computeOutcome, client, saveQueue, answersSignal, applicableQuestions, allAnswered, currentUser);
  }

  /**
   * @param {CaseRow} caseRow
   * @param {QuestionDefinition[]} catalogue
   * @param {(answers: Record<string, Answer>) => import('./sharepoint-client.js').OutcomeResult} computeOutcome
   * @param {SharePointClient} client
   * @param {SaveQueue} saveQueue
   * @param {{ get: () => Record<string, Answer>, set: (v: Record<string, Answer>) => void }} answersSignal
   * @param {{ get: () => QuestionDefinition[] }} applicableQuestions
   * @param {{ get: () => boolean }} allAnswered
   * @param {CurrentUser} currentUser
   */
  _buildLayout(caseRow, catalogue, computeOutcome, client, saveQueue, answersSignal, applicableQuestions, allAnswered, currentUser) {
    const header = document.createElement('header');
    const h1 = document.createElement('h1');
    h1.textContent = caseRow.title;
    const reviewerP = document.createElement('p');
    reviewerP.textContent = `Reviewer: ${caseRow.assignedReviewer}`;
    header.append(h1, reviewerP);

    const statusEl = document.createElement('p');
    statusEl.className = 'cr-save-status';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    this.subscribe(saveQueue.status, status => {
      statusEl.textContent = STATUS_LABELS[status] ?? status;
    });

    const bannerEl = /** @type {import('./cr-status-banner.js').CRStatusBanner} */ (
      document.createElement('cr-status-banner')
    );
    bannerEl.saveQueue = saveQueue;

    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = 'Questions';
    const qList = /** @type {import('./cr-question-list.js').CRQuestionList} */ (
      document.createElement('cr-question-list')
    );
    section.append(h2, qList);

    /** @type {Map<string, QuestionDefinition>} */
    const byId = new Map(catalogue.map(q => [q.id, q]));

    section.addEventListener('cr-answer', (ev) => {
      const { questionId, value } =
        /** @type {CustomEvent<{ questionId: string, value: string | string[] }>} */ (ev).detail;
      const q = byId.get(questionId);
      const baseAnswer = { ...answersSignal.get()[questionId], value };
      const nextAnswer = q ? materializeRemediationActions(q, baseAnswer) : baseAnswer;
      const newAnswers = { ...answersSignal.get(), [questionId]: nextAnswer };
      answersSignal.set(newAnswers);
      saveQueue.enqueue(caseRow.id, 'answers', newAnswers);
    });

    const remediationSection = /** @type {import('./cr-remediation-section.js').CRRemediationSection} */ (
      document.createElement('cr-remediation-section')
    );

    const outcomeEl = /** @type {import('./cr-outcome.js').CROutcome} */ (
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
      remediationSection.update(catalogue, answers);
      outcomeEl.update(computeOutcome, answers, done);
    });

    const completeBtn = document.createElement('button');
    completeBtn.className = 'cr-complete-btn';
    completeBtn.textContent = 'Complete Case';
    completeBtn.hidden = true;

    this.subscribe(allAnswered, answered => {
      completeBtn.hidden = !answered;
    });

    completeBtn.addEventListener('click', async () => {
      if (completeBtn.disabled) return;
      completeBtn.disabled = true;
      await this._completeCase(caseRow.id, client, saveQueue);
      completeBtn.disabled = false;
    });

    const conversationEl = /** @type {import('./cr-conversation.js').CRConversation} */ (
      document.createElement('cr-conversation')
    );
    conversationEl.client = client;
    conversationEl.saveQueue = saveQueue;
    conversationEl.caseId = caseRow.id;
    conversationEl.currentUser = currentUser;
    conversationEl._messages = caseRow.conversation.slice();

    const notesEl = /** @type {import('./cr-notes.js').CRNotes} */ (
      document.createElement('cr-notes')
    );
    notesEl.notes = caseRow.notes;
    notesEl.saveQueue = saveQueue;
    notesEl.caseId = caseRow.id;

    this.replaceChildren(bannerEl, header, statusEl, section, remediationSection, outcomeEl, conversationEl, notesEl, completeBtn);
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
