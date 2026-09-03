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
  reachedReportable,
  summarySectionsFor,
  SECTIONS,
} from '../services/section-access.js';
import { CaseMachine } from './case-machine.js';
import { resolveSectionLabels } from './section-labels.js';
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
 * @property {Capabilities} capabilities Resolved once at boot, before any route
 *   mounts, so there is no default here — a defaulted capability is a granted one.
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
     * Resolved Case Review display copy for this Case Type — every Section's
     * tab caption and panel heading, `DEFAULT_SECTION_LABELS` overridden by
     * `config.sectionLabels`. Populated once `config` loads; defaults until
     * then so components have something to render before `load()` resolves.
     * @type {import('../sharepoint-client.js').ResolvedSectionLabels}
     */
    this.sectionLabels = resolveSectionLabels(null);
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /**
     * The loaded Answers, handed to the store in `toStoreSnapshot()`. The
     * loader stops touching them at that point: the store is the owner.
     * @type {Record<string, Answer>}
     */
    this.answers = {};

    /** @type {string | null} */
    this.bankVersion = null;

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
      versionWarning: this.versionWarning,
      bankVersion: this.bankVersion,
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
    // newly-applicable Question Definition no longer reopens the Case. A Case
    // voided after that milestone keeps the snapshot it was stamped with,
    // which is why this asks whether the milestone was reached rather than
    // what the status is now.
    const stampedVersion =
      reachedReportable(caseRow) && caseRow.questionBankVersion
        ? caseRow.questionBankVersion
        : null;

    let config = routeConfig;
    let bankVersion;
    let versionedExport;
    try {
      [config, bankVersion, versionedExport] = await Promise.all([
        config ? Promise.resolve(config) : loadCaseTypeConfig(caseRow.caseType),
        this.client.getBankVersion(caseRow.caseType),
        stampedVersion
          ? this.client.getVersionedExport(caseRow.caseType, stampedVersion)
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
    this.bankVersion = bankVersion;

    validateCaptureGroups(config.captureGroups);
    validateGeneralQuestions(config.generalQuestions);

    if (stampedVersion && versionedExport) {
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
      if (stampedVersion && !versionedExport) {
        // Versioned file was stamped but not published — fall back with a warning.
        this.versionWarning = 'as-reviewed version unavailable';
        // A stamped-but-unpublished version means a publish went wrong. The
        // banner tells the reader; this is the only trace an operator gets.
        console.error(
          `[CORA] Case ${caseId}: as-reviewed Question Bank version ${stampedVersion} is stamped on the row but its versioned export could not be loaded. Falling back to the live Question Bank.`
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
      (stampedVersion && versionedExport
        ? (versionedExport.defaultOutcomeId ?? config.defaultOutcomeId)
        : config.defaultOutcomeId) ?? ''
    );

    // The `general:` answer-key namespace only isolates General Questions from
    // the catalogue while no Question Definition id can be mistaken for one.
    validateAnswerKeyNamespace(this.catalogue);

    this.answers = { ...caseRow.answers };

    const actualUserId = this.currentUserId || currentUser.id;

    // The resolved catalogue — live bank while In-progress, the stamped
    // versioned export once reportable, `failureValues` derived either way — is
    // what decides whether this Case carries remediation, so the lifecycle model
    // gets the same one the tabs render from.
    this.machine = new CaseMachine(
      caseRow,
      { id: actualUserId },
      this.capabilities,
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

    this.summarySections = summarySectionsFor(this.access, config, roles);

    this.loaded = true;

    await this._resolvePersonNames();
  }

  /**
   * Runs as the last step of the load, before the loader hands its Answers to
   * the store. Not persisted: a display-name refresh is presentation, not a
   * Reviewer edit.
   *
   * Covers every `person` Issue Capture Field on the Case in one batched call:
   * one cached-name problem, so one round trip to the directory.
   */
  async _resolvePersonNames() {
    const personKeys = this._personCaptureKeys();
    /** @type {string[]} */
    const accounts = [];
    /** @param {unknown} value */
    const collect = (value) => {
      const login = /** @type {any} */ (value)?.loginName;
      if (typeof login === 'string' && login && !accounts.includes(login)) {
        accounts.push(login);
      }
    };
    for (const answer of Object.values(this.answers)) {
      for (const key of personKeys) collect(answer.capture?.[key]);
    }
    if (accounts.length === 0) return;

    const resolved = await this.client.resolveUsers(accounts);
    /**
     * The same person with the directory's current name, or null when nothing
     * needs rewriting.
     * @param {unknown} value
     * @returns {{ loginName: string, displayName: string } | null}
     */
    const refreshed = (value) => {
      const party = /** @type {any} */ (value);
      const name = party?.loginName ? resolved[party.loginName] : null;
      return name && name !== party.displayName
        ? { ...party, displayName: name }
        : null;
    };

    let changed = false;
    /** @type {Record<string, Answer>} */
    const next = {};
    for (const [id, answer] of Object.entries(this.answers)) {
      let updated = answer;
      for (const key of personKeys) {
        const person = refreshed(answer.capture?.[key]);
        if (person) {
          updated = {
            ...updated,
            capture: { ...updated.capture, [key]: person },
          };
        }
      }
      if (updated !== answer) changed = true;
      next[id] = updated;
    }
    if (changed) this.answers = next;
  }

  /**
   * The capture field keys this Case Type declares as people. A key the config
   * does not name a person is left alone whatever it holds — the config is the
   * only authority on which values are accounts.
   *
   * @returns {string[]}
   */
  _personCaptureKeys() {
    return (this.config?.captureGroups ?? []).flatMap((group) =>
      group.fields.filter((f) => f.type === 'person').map((f) => f.key)
    );
  }
}
