// @ts-check
// CaseReviewViewModel loads the Case Review page: the Case row, the (possibly
// as-reviewed) catalogue, the Case Type config, roles and access. It hands the
// result over once, as a plain snapshot, and owns no Answer mutation — the
// store is the single Answer owner and the route's answer-actions are the only
// writers (#510). Signals remain an internal loading-state detail.

import { signal } from './signal.js';
import {
  allApplicableAnswered,
  evaluate,
} from '../evaluators/applicability-evaluator.js';
import { withDerivedFailureValues } from '../evaluators/failure-evaluator.js';
import { validateCaptureGroups } from '../evaluators/issue-capture.js';
import {
  validateGeneralQuestions,
  validateAnswerKeyNamespace,
} from '../evaluators/general-questions.js';
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
    /**
     * The loaded Answers, handed to the store in `toStoreSnapshot()`. The
     * loader stops touching them at that point: the store is the owner.
     * @type {Record<string, Answer>}
     */
    this.answers = {};

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

    this.conversationHidden = signal(true);
  }

  /**
   * Plain snapshot consumed by the CASE-1 route store — the loader's single
   * handover to the state owner. `applicableQuestions` and `allAnswered` are
   * derived here and re-derived by the reducer on every Answer edit; #467
   * replaces both with a selector.
   */
  toStoreSnapshot() {
    const applicableIds = evaluate(this.catalogue, this.answers);
    return {
      loaded: this.loaded.get(),
      error: this.error.get(),
      accessDenied: this.accessDenied.get(),
      caseRow: this.caseRow,
      currentUser: this.currentUser,
      config: this.config,
      catalogue: this.catalogue,
      answers: this.answers,
      applicableQuestions: this.catalogue.filter((q) =>
        applicableIds.has(q.id)
      ),
      allAnswered: allApplicableAnswered(this.catalogue, this.answers),
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
        // A stamped-but-unpublished version means a publish went wrong. The
        // banner tells the reader; this is the only trace an operator gets (#513).
        console.error(
          `[CORA] Case ${caseId}: as-reviewed Question Bank version ${versionHash} is stamped on the row but its versioned export could not be loaded. Falling back to the live Question Bank (ADR-0021 Step 4).`
        );
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

    this.answers = { ...caseRow.answers };

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

    this.loaded.set(true);

    await this._resolveAttributedParties();
  }

  /**
   * Refresh stale Attributed Party display names from the directory, as the
   * last step of the load and before the loader hands its Answers to the
   * store. Not persisted: a display-name refresh is presentation, not a
   * Reviewer edit.
   */
  async _resolveAttributedParties() {
    /** @type {string[]} */
    const accounts = [];
    for (const answer of Object.values(this.answers)) {
      const login = answer.attributedParty?.loginName;
      if (login && !accounts.includes(login)) accounts.push(login);
    }
    if (accounts.length === 0) return;

    const resolved = await this.client.resolveUsers(accounts);
    let changed = false;
    /** @type {Record<string, Answer>} */
    const next = {};
    for (const [id, answer] of Object.entries(this.answers)) {
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
    if (changed) this.answers = next;
  }
}
