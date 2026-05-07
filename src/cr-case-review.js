// @ts-check
import { CRElement } from './cr-element.js';
import { signal, computed } from './signal.js';
import { evaluate } from './applicability-evaluator.js';
import './cr-question-list.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('./sharepoint-client.js').Answer} Answer */
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

    const caseRow = await client.getCase(caseId);
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

    this._buildLayout(caseRow, client, saveQueue, answersSignal, applicableQuestions, allAnswered);
  }

  /**
   * @param {CaseRow} caseRow
   * @param {SharePointClient} client
   * @param {SaveQueue} saveQueue
   * @param {{ get: () => Record<string, Answer>, set: (v: Record<string, Answer>) => void }} answersSignal
   * @param {{ get: () => QuestionDefinition[] }} applicableQuestions
   * @param {{ get: () => boolean }} allAnswered
   */
  _buildLayout(caseRow, client, saveQueue, answersSignal, applicableQuestions, allAnswered) {
    const header = document.createElement('header');
    const h1 = document.createElement('h1');
    h1.textContent = caseRow.title;
    const reviewerP = document.createElement('p');
    reviewerP.textContent = `Reviewer: ${caseRow.assignedReviewer}`;
    header.append(h1, reviewerP);

    const statusEl = document.createElement('p');
    statusEl.className = 'cr-save-status';
    this.subscribe(saveQueue.status, status => {
      statusEl.textContent = STATUS_LABELS[status] ?? status;
    });

    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = 'Questions';
    const qList = /** @type {import('./cr-question-list.js').CRQuestionList} */ (
      document.createElement('cr-question-list')
    );
    section.append(h2, qList);

    section.addEventListener('cr-answer', (ev) => {
      const { questionId, value } =
        /** @type {CustomEvent<{ questionId: string, value: string | string[] }>} */ (ev).detail;
      const newAnswers = { ...answersSignal.get(), [questionId]: { value } };
      answersSignal.set(newAnswers);
      saveQueue.enqueue(caseRow.id, 'answers', newAnswers);
    });

    // viewState combines applicability + answers so the subscribe fires once per state change.
    const viewState = computed(() => ({
      questions: applicableQuestions.get(),
      answers: answersSignal.get(),
    }));
    this.subscribe(viewState, ({ questions, answers }) => {
      qList.update(questions, answers);
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

    this.replaceChildren(header, statusEl, section, completeBtn);
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
