// @ts-check
import { CRElement } from '../components/cr-element.js';
import { signal, computed } from '../lib/signal.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { computeSectionProgress } from '../evaluators/section-progress.js';
import { materializeRemediationActions } from '../evaluators/failure-evaluator.js';
import { evaluateAccess, resolveRoles, showInSummary, SECTIONS, SUMMARY_SECTIONS } from '../services/section-access.js';
import '../components/cr-question-list.js';
import '../components/cr-section-progress.js';
import '../components/cr-remediation-section.js';
import '../components/cr-conversation.js';
import '../components/cr-notes.js';
import '../components/cr-summary.js';
import '../components/cr-appeal.js';
import '../components/cr-override-editor.js';
import '../components/cr-source-case.js';
import '../components/cr-status-banner.js';
import '../components/cr-tabs.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * The resolved source-Case panel inputs for a QA Check (ADR-0018). `originalRow`
 * is null when the linked original could not be fetched.
 *
 * @typedef {{
 *   originalRow: CaseRow | null,
 *   catalogue: QuestionDefinition[],
 *   computeOutcome: ((answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult) | null,
 *   attributeFailures: boolean,
 *   remediationFields: import('../sharepoint-client.js').RemediationField[],
 *   overrideAccess: 'override' | 'read-only',
 *   sourceCaseId: string
 * }} SourceCaseOpts
 */

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
    /**
     * The active tab id, held in component state rather than the URL (ADR-0014):
     * ADR-0002's router remounts the route on hashchange, which would refetch the
     * Case and discard the in-memory answers signal plus any un-flushed auto-save.
     * @type {{ get: () => string, set: (v: string) => void } | null}
     */
    this._activeTab = null;
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
      { isReviewer: true, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isQaReviewer: false, isVisitor: false }
    );
    const roles = resolveRoles(caseRow, currentUserId, capabilities);
    /** @type {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} */
    const access = /** @type {any} */ ({});
    for (const s of SECTIONS) access[s] = evaluateAccess(s, roles, caseRow, config);

    if (SECTIONS.every(s => access[s] === 'hidden')) {
      this._renderAccessDenied();
      return;
    }

    // Which Sections contribute a Summary block: membership + showInSummary
    // (ADR-0016), gated by the viewer's access so a Section hidden for their role
    // never leaks into Summary (ADR-0011).
    const summarySections = SUMMARY_SECTIONS.filter(
      s => access[s] !== 'hidden' && showInSummary(s, config)
    );

    // QA Check (issue #47, ADR-0018): when this Case links to an original via
    // `sourceCaseId`, fetch that original read-only and resolve the source-Case
    // panel. The override capability is resolved against the *linked original*,
    // and its ETag is loaded into the SaveQueue so the embedded editor's write is
    // a guarded, cross-row PATCH (the QA Check row stays the page's primary).
    const sourceCase = caseRow.sourceCaseId
      ? await this._resolveSourceCase(caseRow.sourceCaseId, caseRow.id, client, saveQueue, currentUserId, capabilities)
      : null;

    this._buildLayout({ caseRow, catalogue, computeOutcome: config.computeOutcome, attributeFailures: config.attributeFailures, remediationFields: config.remediationFields ?? [], client, saveQueue, answersSignal, applicableQuestions, allAnswered, currentUser, access, roles, summarySections, sourceCase });

    // Render with cached display names first, then upgrade to the authoritative
    // directory names once they resolve (ADR-0013, #97).
    await this._resolveAttributedParties(client, answersSignal);
  }

  /**
   * Resolve the bare account names stored on each Attributed Party to their
   * authoritative display names (ADR-0013), updating the answers signal for
   * display only. The cached `displayName` stays as the fallback when a lookup
   * returns null. Not persisted: the answers signal is the single source of
   * truth and a later edit refreshes the cache naturally.
   *
   * @param {SharePointClient} client
   * @param {{ get: () => Record<string, Answer>, set: (v: Record<string, Answer>) => void }} answersSignal
   */
  async _resolveAttributedParties(client, answersSignal) {
    /** @type {string[]} */
    const accounts = [];
    for (const answer of Object.values(answersSignal.get())) {
      const login = answer.attributedParty?.loginName;
      if (login && !accounts.includes(login)) accounts.push(login);
    }
    if (accounts.length === 0) return;

    const resolved = await client.resolveUsers(accounts);

    let changed = false;
    /** @type {Record<string, Answer>} */
    const next = {};
    for (const [id, answer] of Object.entries(answersSignal.get())) {
      const party = answer.attributedParty;
      const name = party ? resolved[party.loginName] : null;
      if (party && name && name !== party.displayName) {
        next[id] = { ...answer, attributedParty: { ...party, displayName: name } };
        changed = true;
      } else {
        next[id] = answer;
      }
    }
    if (changed) answersSignal.set(next);
  }

  /**
   * Resolve the read-only source Case for a QA Check (ADR-0018). Fetches the
   * linked original, loads the *original* Case Type config (for its catalogue and
   * `computeOutcome`, used to render Effective Answers + Current Outcome), and
   * resolves the Override Mode against the original row so the embedded editor's
   * `override` capability follows the original, not the QA Check. The original's
   * ETag is loaded into the SaveQueue for the cross-row PATCH. A missing original
   * still yields an opts object (with a null row) so the panel renders its own
   * not-found state.
   *
   * @param {string} sourceCaseId  the original row id (CaseRow.sourceCaseId)
   * @param {string} qaCaseId      this QA Check's own id, stamped on overrides
   * @param {SharePointClient} client
   * @param {SaveQueue} saveQueue
   * @param {string} currentUserId
   * @param {import('../services/permissions.js').Capabilities} capabilities
   * @returns {Promise<SourceCaseOpts>}
   */
  async _resolveSourceCase(sourceCaseId, qaCaseId, client, saveQueue, currentUserId, capabilities) {
    const original = await client.getCase(sourceCaseId);
    if (!original) {
      return { originalRow: null, catalogue: [], computeOutcome: null, attributeFailures: false, remediationFields: [], overrideAccess: 'read-only', sourceCaseId: qaCaseId };
    }

    saveQueue.loadCase(original);

    const mod = await import(`../../case-types/${original.caseType}.js`);
    /** @type {import('../sharepoint-client.js').CaseTypeConfig} */
    const origConfig = mod.default;
    const origCatalogue = origConfig.questions.filter(q => !q.deprecated);

    const roles = resolveRoles(original, currentUserId, capabilities);
    const mode = evaluateAccess('questions', roles, original, origConfig);
    /** @type {'override' | 'read-only'} */
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
   * @param {import('../sharepoint-client.js').RemediationField[]} [opts.remediationFields]
   * @param {SharePointClient} opts.client
   * @param {SaveQueue} opts.saveQueue
   * @param {{ get: () => Record<string, Answer>, set: (v: Record<string, Answer>) => void }} opts.answersSignal
   * @param {{ get: () => QuestionDefinition[] }} opts.applicableQuestions
   * @param {{ get: () => boolean }} opts.allAnswered
   * @param {CurrentUser} opts.currentUser
   * @param {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} opts.access
   * @param {import('../services/section-access.js').Role[]} [opts.roles]
   * @param {import('../services/section-access.js').Section[]} [opts.summarySections]
   * @param {SourceCaseOpts | null} [opts.sourceCase]
   */
  _buildLayout({ caseRow, catalogue, computeOutcome, attributeFailures, remediationFields = [], client, saveQueue, answersSignal, applicableQuestions, allAnswered, currentUser, access, roles = [], summarySections = [], sourceCase = null }) {

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

    // The Override Mode (ADR-0018) is authored by the dedicated cr-override-editor;
    // the read-only Section components only understand edit/read-only/hidden, so an
    // `override` cell presents to them as read-only.
    const displayMode = (/** @type {import('../services/section-access.js').Mode} */ m) =>
      m === 'override' ? 'read-only' : m;

    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = 'Questions';
    const qList = /** @type {import('../components/cr-question-list.js').CRQuestionList} */ (
      document.createElement('cr-question-list')
    );
    qList.access = displayMode(access.questions);
    const progressEl = /** @type {import('../components/cr-section-progress.js').CRSectionProgress} */ (
      document.createElement('cr-section-progress')
    );
    section.append(h2, qList, progressEl);

    // QA Answer Override authoring (ADR-0018): when the viewer holds the `override`
    // Mode (a QA Reviewer on a Completed Case), mount the reusable editor below the
    // read-only Questions. It appends to the original row's `overrides[]`; the
    // frozen Answers are never mutated.
    if (access.questions === 'override') {
      const overrideEl = /** @type {import('../components/cr-override-editor.js').CROverrideEditor} */ (
        document.createElement('cr-override-editor')
      );
      overrideEl.caseRow = caseRow;
      overrideEl.saveQueue = saveQueue;
      overrideEl.caseId = caseRow.id;
      overrideEl.access = 'override';
      overrideEl.currentUser = currentUser;
      overrideEl.catalogue = catalogue;
      overrideEl.attributeFailures = attributeFailures === true;
      overrideEl.remediationFields = remediationFields;
      overrideEl.computeOutcome = computeOutcome;
      overrideEl.client = client;
      section.append(/** @type {any} */ (overrideEl));
    }

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

    // The Summary Section (ADR-0016) absorbs the former Outcome tab: it wraps
    // cr-outcome and reads the frozen outcomeAtCompletion snapshot once Completed.
    const summaryEl = /** @type {import('../components/cr-summary.js').CRSummary} */ (
      document.createElement('cr-summary')
    );
    summaryEl.caseRow = caseRow;
    summaryEl.catalogue = catalogue;
    summaryEl.summarySections = summarySections;

    // viewState combines applicability + answers + allAnswered so the subscribe fires once per state change.
    const viewState = computed(() => ({
      questions: applicableQuestions.get(),
      answers: answersSignal.get(),
      allAnswered: allAnswered.get(),
    }));
    this.subscribe(viewState, ({ questions, answers, allAnswered: done }) => {
      qList.update(questions, answers);
      remediationSection.update(catalogue, answers, attributeFailures);
      summaryEl.update(computeOutcome, answers, done);
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
      await this._completeCase(caseRow.id, client, saveQueue, computeOutcome, answersSignal.get());
      completeBtn.disabled = false;
    });

    const conversationEl = /** @type {import('../components/cr-conversation.js').CRConversation} */ (
      document.createElement('cr-conversation')
    );
    conversationEl.client = client;
    conversationEl.saveQueue = saveQueue;
    conversationEl.caseId = caseRow.id;
    conversationEl.currentUser = currentUser;
    conversationEl.access = displayMode(access.conversation);
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
    notesEl.caseJustification = caseRow.caseJustification ?? '';
    notesEl.saveQueue = saveQueue;
    notesEl.caseId = caseRow.id;
    notesEl.access = displayMode(access.notes);

    // Appeal Section (issue #132): lets the Responsible Party or their Manager
    // raise a case-level Appeal on a Completed Case. The Section is additive and
    // writes only the `appeals` field via the SaveQueue.
    const appealEl = /** @type {import('../components/cr-appeal.js').CRAppeal} */ (
      document.createElement('cr-appeal')
    );
    appealEl.caseRow = caseRow;
    appealEl.saveQueue = saveQueue;
    appealEl.caseId = caseRow.id;
    appealEl.access = displayMode(access.appeal);
    // A QA Reviewer holds the resolution path (issue #134): the appeal Section is
    // `edit` for them and for the appellant, so the role flag selects the
    // resolution form over the raise form. The Override editor an agreed Appeal
    // reveals needs the same Case Type config the Questions-tab editor receives.
    appealEl.canResolve = roles.includes('qaReviewer');
    appealEl.attributeFailures = attributeFailures === true;
    appealEl.remediationFields = remediationFields;
    appealEl.computeOutcome = computeOutcome;
    appealEl.client = client;
    appealEl.currentUser = currentUser;
    appealEl.catalogue = catalogue;
    appealEl.answers = caseRow.answers;

    // Case Details Section (ADR-0014, #105). Placeholder content this slice.
    const detailsEl = /** @type {import('../components/cr-case-details.js').CRCaseDetails} */ (
      document.createElement('cr-case-details')
    );
    detailsEl.caseRow = caseRow;
    detailsEl.access = displayMode(access.details);

    // Each visible Section becomes a tab (ADR-0014); a Section that resolves to
    // `hidden` (ADR-0011) renders no tab. Conversation is deliberately NOT a tab —
    // it stays a floating overlay so a Reviewer can read it alongside the
    // Questions. Tab order is the Section order with Details first.
    // Tab row is Details · Questions · Notes · Issues · Summary (ADR-0016). The
    // Remediation Section surfaces under the UI label "Issues" while keeping its
    // Section id `remediation`; the Outcome tab is gone, absorbed into Summary.
    /** @type {import('../components/cr-tabs.js').Tab[]} */
    const tabs = [
      { id: 'details', label: 'Details', hidden: access.details === 'hidden' },
      { id: 'questions', label: 'Questions', hidden: access.questions === 'hidden' },
      { id: 'notes', label: 'Notes', hidden: access.notes === 'hidden' },
      { id: 'remediation', label: 'Issues', hidden: access.remediation === 'hidden' },
      { id: 'summary', label: 'Summary', hidden: access.summary === 'hidden' },
      { id: 'appeal', label: 'Appeal', hidden: access.appeal === 'hidden' },
    ];
    /** @type {Record<string, Node>} */
    const panels = {
      details: /** @type {any} */ (detailsEl),
      questions: section,
      notes: /** @type {any} */ (notesEl),
      remediation: /** @type {any} */ (remediationSection),
      summary: /** @type {any} */ (summaryEl),
      appeal: /** @type {any} */ (appealEl),
    };

    // Default tab is Details; because Details leads the array, the first visible
    // tab is Details when present and otherwise the next visible Section in order
    // (the fallback). The all-Sections-hidden short-circuit upstream guarantees
    // at least one tab-bearing Section is visible here in practice.
    const firstVisible = tabs.find(t => !t.hidden);
    const activeTab = signal(firstVisible ? firstVisible.id : '');
    this._activeTab = activeTab;

    const tabsEl = /** @type {import('../components/cr-tabs.js').CRTabs} */ (
      document.createElement('cr-tabs')
    );
    tabsEl.tabs = tabs;
    tabsEl.panels = panels;
    tabsEl.selected = activeTab.get();
    tabsEl.addEventListener('cr-tab-change', (ev) => {
      const { id } = /** @type {CustomEvent<{ id: string }>} */ (ev).detail;
      activeTab.set(id);
    });

    // QA Check source-Case panel (issue #47, ADR-0018): a read-only view of the
    // linked original's Effective Answers + Current Outcome, with the embedded
    // Override editor. It sits outside the standard Section model (not a tab) and
    // is only built when this Case links to an original.
    const sourceCaseEl = sourceCase
      ? this._buildSourceCasePanel(sourceCase, { saveQueue, currentUser, client })
      : null;

    // Persistent chrome (banner, Conversation overlay + its header toggle, and the
    // Complete Case button) lives OUTSIDE the tabs so it is reachable from any tab.
    /** @type {HTMLElement[]} */
    const children = [
      /** @type {HTMLElement} */ (/** @type {unknown} */ (bannerEl)),
      header,
    ];
    if (sourceCaseEl) children.push(/** @type {HTMLElement} */ (/** @type {unknown} */ (sourceCaseEl)));
    children.push(
      /** @type {HTMLElement} */ (/** @type {unknown} */ (tabsEl)),
      /** @type {HTMLElement} */ (/** @type {unknown} */ (conversationEl)),
      completeBtn,
    );

    this.replaceChildren(...children);
  }

  /**
   * Build the read-only source-Case panel for a QA Check (ADR-0018), wiring the
   * resolved original + the original Case Type config into cr-source-case. The
   * embedded Override editor inside the panel performs the cross-row write.
   *
   * @param {SourceCaseOpts} sourceCase
   * @param {{ saveQueue: SaveQueue, currentUser: CurrentUser, client: SharePointClient }} deps
   * @returns {import('../components/cr-source-case.js').CRSourceCase}
   */
  _buildSourceCasePanel(sourceCase, { saveQueue, currentUser, client }) {
    const el = /** @type {import('../components/cr-source-case.js').CRSourceCase} */ (
      document.createElement('cr-source-case')
    );
    el.originalRow = sourceCase.originalRow;
    el.catalogue = sourceCase.catalogue;
    el.computeOutcome = sourceCase.computeOutcome;
    el.attributeFailures = sourceCase.attributeFailures;
    el.remediationFields = sourceCase.remediationFields;
    el.saveQueue = saveQueue;
    el.currentUser = currentUser;
    el.client = client;
    el.overrideAccess = sourceCase.overrideAccess;
    el.sourceCaseId = sourceCase.sourceCaseId;
    return el;
  }

  /**
   * Patches the case status to Completed and navigates to the dashboard.
   *
   * When the Case Type's `computeOutcome` and the current answers are supplied,
   * a frozen outcome snapshot is stamped in the *same* ETag-guarded PATCH
   * (ADR-0012): `outcomeAtCompletion` is the verdict computed over the answers at
   * completion time, and `hadRemediation` is true iff any Answer carries one or
   * more Remediation Actions. Because the snapshot is written once from these
   * inputs, later edits to the answers, Question Definitions, or outcome function
   * never change a Completed Case's stamped values.
   *
   * @param {string} caseId
   * @param {SharePointClient} [clientArg]
   * @param {SaveQueue} [saveQueueArg]
   * @param {(answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult} [computeOutcome]
   * @param {Record<string, Answer>} [answers]
   */
  async _completeCase(caseId, clientArg, saveQueueArg, computeOutcome, answers) {
    const client = clientArg ?? this.client;
    const saveQueue = saveQueueArg ?? this.saveQueue;
    if (!client || !saveQueue) return;

    /** @type {Partial<CaseRow>} */
    const fields = {
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: new Date().toISOString(),
    };
    if (computeOutcome && answers) {
      fields.outcomeAtCompletion = computeOutcome(answers).verdict;
      fields.hadRemediation = Object.values(answers).some(
        a => (a.remediationActions?.length ?? 0) > 0
      );
      // The effective-outcome columns (ADR-0019) start life equal to the frozen
      // snapshot; an Override has not yet been authored, so nothing is corrected.
      // They re-stamp on every Override write; outcomeAtCompletion stays frozen.
      fields.effectiveOutcome = fields.outcomeAtCompletion;
      fields.effectiveHadRemediation = fields.hadRemediation;
      fields.outcomeOverridden = false;
    }

    const etag = saveQueue.getEtag(caseId);
    const result = await client.patchCase(caseId, fields, etag);
    if (result.ok) {
      location.hash = '#/dashboard';
    }
  }
}

customElements.define('cr-case-review', CRCaseReview);
