// @ts-check
// CaseLoader loads the Case Review page: the Case row, the (possibly
// as-reviewed) catalogue, the Case Type config, the CaseMachine and its
// resolved Section access. It hands the result over once, as a plain
// snapshot, and owns no Answer mutation — the
// store is the single Answer owner and the route's answer-actions are the only
// writers. It holds no signals: every field it loads is plain, handed
// over once through `toStoreSnapshot()`.

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
 * @typedef {Object} CaseLoaderOptions
 * @property {SharePointClient} client
 * @property {SaveQueue} saveQueue
 * @property {string} caseId
 * @property {string} currentUserId
 * @property {Capabilities | null} capabilities
 * @property {string | null} [caseType]
 */

export class CaseLoader {
  /** @param {CaseLoaderOptions} options */
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

    // Loading state, written by `load()` and read once by
    // `toStoreSnapshot()`. Plain fields: nothing subscribes, the store owns
    // the page's reactive state.
    this.loaded = false;
    /** @type {string | null} */
    this.error = null;
    this.accessDenied = false;

    /**
     * The loaded Case Row, handed to the store in `toStoreSnapshot()`. As with
     * `answers`, the loader stops touching it at that point: the store is the
     * owner, and the Appeal/amend transitions replace only its copy.
     * @type {CaseRow | null}
     */
    this.caseRow = null;
    /** @type {CurrentUser | null} */
    this.currentUser = null;
    /** @type {import('../sharepoint-client.js').CaseTypeConfig | null} */
    this.config = null;
    /**
     * Resolved Case Review tab labels / section headings for this Case Type —
     * `DEFAULT_SECTION_LABELS` overridden by `config.sectionLabels`.
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

    /**
     * Set only on the fallback path — a Case stamped with an as-reviewed
     * Question Bank version whose export could not be loaded.
     * Plain field: nothing subscribes, the store owns the banner.
     * @type {string | null}
     */
    this.versionWarning = null;

    /** @type {CaseMachine | null} */
    this.machine = null;
    /** @type {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} */
    this.access = /** @type {any} */ ({});
    /** @type {import('../services/section-access.js').Section[]} */
    this.summarySections = [];
  }

  /**
   * Plain snapshot consumed by the route store — the loader's single handover
   * to the state owner. `applicableQuestions` and `allAnswered` are derived
   * here and re-derived by the reducer on every Answer edit; a selector is
   * meant to replace both.
   */
  toStoreSnapshot() {
    const applicableIds = evaluate(this.catalogue, this.answers);
    return {
      loaded: this.loaded,
      error: this.error,
      accessDenied: this.accessDenied,
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
      summarySections: this.summarySections,
      sectionLabels: this.sectionLabels,
      sectionHeadings: this.sectionHeadings,
      versionWarning: this.versionWarning,
      exportHash: this.exportHash,
      caseListOptions: this.caseListOptions,
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
          this.error = message;
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
      this.error = 'Case not found.';
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
        this.error = message;
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
          // Older exports carry no `questionGroup` key and
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
        this.versionWarning = 'as-reviewed version unavailable';
        // A stamped-but-unpublished version means a publish went wrong. The
        // banner tells the reader; this is the only trace an operator gets.
        console.error(
          `[CORA] Case ${caseId}: as-reviewed Question Bank version ${versionHash} is stamped on the row but its versioned export could not be loaded. Falling back to the live Question Bank.`
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

    // The resolved catalogue — live bank while In-progress, the stamped
    // versioned export once reportable, `failureValues` derived either way — is
    // what decides whether this Case carries remediation, so the lifecycle model
    // gets the same one the tabs render from.
    this.machine = new CaseMachine(
      caseRow,
      { id: actualUserId },
      caps,
      config,
      {
        catalogue: this.catalogue,
      }
    );
    this.access = this.machine.access;
    const roles = this.machine.roles;

    if (SECTIONS.every((s) => this.access[s] === 'hidden')) {
      this.accessDenied = true;
      this.loaded = true;
      return;
    }

    // Access first: that AND is what keeps a Case Type's role list
    // narrowing-only.
    this.summarySections = SUMMARY_SECTIONS.filter(
      (s) => this.access[s] !== 'hidden' && showInSummary(s, config, roles)
    );

    this.loaded = true;

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
