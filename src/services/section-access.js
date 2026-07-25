// @ts-check
/**
 * Section-level role-based access on the case page. UX-only per the architecture decision;
 * SharePoint list ACLs remain the real boundary. See the architecture decision for design.
 *
 * @typedef {'details'|'questions'|'issues'|'summary'|'remediation'|'notes'|'conversation'|'appealRequest'|'appealReview'|'amendOutcome'} Section
 * @typedef {'assignedReviewer'|'otherReviewer'|'reviewerManager'|'responsibleParty'|'responsiblePartyManager'|'caseTypeOwner'|'journeyOwner'|'controls'|'none'} Role
 * @typedef {'edit'|'read-only'|'hidden'} Mode
 */

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('./permissions.js').Capabilities} Capabilities */

import { hasRemediation } from '../evaluators/remediation-status.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import {
  sectionIds,
  summaryBlockIds,
  sectionById,
} from '../lib/section-registry.js';

/**
 * A Case is **reportable** once it has passed the freeze milestone:
 * either the Reviewer has sent Remediation Actions (`'Actions In Progress'`) or
 * the Case has been completed outright (`'Completed'`). Equivalently
 * `reportable ⟺ status ∈ { 'Actions In Progress', 'Completed' }`.
 *
 * Before that (`'In-progress'`) the Answers are live: a newly-applicable
 * Question Definition still applies and blocks completion. From reportable on,
 * the Answers and Outcome snapshot are frozen and no new Question reopens the
 * Case. Both the access matrix (freeze/gate cells below) and `CaseMachine` key
 * off this predicate rather than a hard-coded status string.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function isReportable(status) {
  return (
    status === CASE_STATUS.ACTIONS_IN_PROGRESS ||
    status === CASE_STATUS.COMPLETED
  );
}

/**
 * The Sections that exist on the Case Review page, in canonical order. Derived
 * from the data-driven Section registry (ADR-0032) — the single source of truth
 * for Section existence — rather than restated here.
 * @type {Section[]}
 */
export const SECTIONS = sectionIds();

/**
 * The role a Case Type routes appeal-raising to: the
 * **Journey Owner** for Complaints-style journeys, otherwise the **Responsible
 * Party Manager**. Declared per Case Type as `caseTypeConfig.appeal.raisedBy`;
 * defaults to `responsiblePartyManager` when the Case Type does not configure an
 * appeal flow. The `appealRequest` matrix cell reads this to decide which role
 * gets `edit`.
 *
 * @param {CaseTypeConfig} config
 * @returns {'journeyOwner' | 'responsiblePartyManager'}
 */
function appealRaiser(config) {
  return config.appeal?.raisedBy ?? 'responsiblePartyManager';
}

/**
 * Whether the Case currently has an unresolved Appeal. Controls may
 * only `edit` the Appeal Review Section while an Appeal is open; otherwise the
 * Section is observed read-only.
 *
 * @param {CaseRow} caseRow
 * @returns {boolean}
 */
function hasOpenAppeal(caseRow) {
  return (caseRow.appeals ?? []).some((a) => a.state !== 'resolved');
}

/**
 * Whether the Case has remediation to track: ≥1 Answer carrying a
 * Reviewer-selected Remediation Action or free-form remediation text, **and** the
 * Case past the reportable milestone (i.e. the actions have been *sent*).
 *
 * Both halves matter. While the Case is `In-progress` the Reviewer is still
 * choosing actions on the Issues tab, so there is nothing to track yet; and
 * remediation is optional, so a reportable Case may carry none at all.
 *
 * Note the store: the Reviewer's selections live on `answer.remediationActions`
 * / `answer.freeFormRemediation` (what the Issues tab writes), **not** in an
 * `actions`-typed Issue Capture Field. Gating on the latter is what kept this
 * Section hidden on every real Case (#499).
 *
 * @param {CaseRow} caseRow
 * @returns {boolean}
 */
function hasTrackableRemediation(caseRow) {
  return isReportable(caseRow.status) && hasRemediation(caseRow.answers);
}

/**
 * The Remediation cell shared by every role that only *observes* the tracking
 * breakdown — which is everyone except the Assigned Reviewer, who resolves it.
 *
 * @param {CaseRow} c
 * @returns {Mode}
 */
const observesRemediation = (c) =>
  hasTrackableRemediation(c) ? 'read-only' : 'hidden';

/**
 * Which of the Remediation Section's two renderings a viewer gets (#499).
 *
 * - `reviewer` — the Assigned Reviewer, other Reviewers, a Reviewer Manager, the
 *   Case Type Owner and Controls: the breakdown plus (when the mode is `edit`)
 *   the per-Question resolution controls.
 * - `responsibleParty` — the Responsible Party doing the work, their Manager and
 *   the Journey Owner: the same breakdown without the Reviewer's fields, plus a
 *   pointer to the Conversation, which is their interface for discussing the
 *   remediation and reporting it done.
 *
 * Reviewer-side wins for a viewer holding roles on both sides, mirroring the
 * most-permissive rule in `evaluateAccess`.
 *
 * @param {Role[]} roles
 * @returns {'reviewer' | 'responsibleParty'}
 */
export function remediationAudience(roles) {
  /** @type {Role[]} */
  const reviewerSide = [
    'assignedReviewer',
    'otherReviewer',
    'reviewerManager',
    'caseTypeOwner',
    'controls',
  ];
  return roles.some((role) => reviewerSide.includes(role))
    ? 'reviewer'
    : 'responsibleParty';
}

/**
 * The Sections that can contribute a block to the read-only Summary Section
 *, in render order. Conversation (a floating overlay, never a tab)
 * and Summary itself never appear as Summary blocks. Derived from the Section
 * registry (ADR-0032) rather than restated here.
 * @type {Section[]}
 */
export const SUMMARY_SECTIONS = summaryBlockIds();

/**
 * Whether a Section contributes a block to the Summary Section.
 * Membership in the Case Type's `sections` config object is the allow-list; a
 * Section absent from a defined `sections` is never in Summary. For a member (or
 * when `sections` is undefined, i.e. all enabled) the explicit `showInSummary`
 * flag wins, otherwise the default applies: Notes is off, every other block
 * Section is on.
 *
 * @param {Section} section
 * @param {CaseTypeConfig} caseTypeConfig
 * @returns {boolean}
 */
export function showInSummary(section, caseTypeConfig) {
  const sections = caseTypeConfig.sections;
  if (sections && !(section in sections)) return false;
  const explicit = sections?.[section]?.showInSummary;
  if (explicit !== undefined) return explicit;
  return sectionById(section)?.showInSummaryDefault ?? true;
}

/**
 * Default access matrix. Function-valued cells receive the CaseRow and CaseTypeConfig and return a Mode.
 * Keyed by the Section ids owned by the registry (ADR-0032); a contract test
 * asserts `Object.keys(MATRIX)` equals the registry's Section ids so the two
 * never drift. Exported for that assertion — the RBAC policy itself stays here,
 * not in the registry.
 * @type {Record<Section, Record<Role, Mode | ((c: CaseRow, config: CaseTypeConfig) => Mode)>>}
 */
export const MATRIX = {
  // Case Details. Observed read-only by the reviewing/owning/Controls
  // roles; the Responsible Party (Adviser) and their Manager no longer see a
  // standalone Details tab — those fields are folded into the Summary they read
  //.
  details: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Review (the Questions Section). The Assigned Reviewer edits it until the Case
  // is **reportable**, after which the Answers freeze and it goes
  // read-only. Controls, the Case Type Owner and the Journey Owner observe the
  // reviewed Answers read-only; the Adviser and their Manager do not see it
  //.
  questions: {
    assignedReviewer: (c) => (isReportable(c.status) ? 'read-only' : 'edit'),
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Issues — *capture*: failed Answers + their Issue Capture
  // Groups/Fields + the Responsible Party selector. Reviewer-editable
  // until the Case is reportable, then read-only. Observed read-only by
  // Controls, the Case Type Owner and the Journey Owner; hidden from the Adviser
  // and their Manager.
  issues: {
    assignedReviewer: (c) => (isReportable(c.status) ? 'read-only' : 'edit'),
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Summary is never `edit` — only `read-only` or `hidden`. It
  // inherits the function-valued Outcome × Responsible Party gate that governed
  // the removed Outcome Section: hidden from the Adviser while In-progress,
  // read-only once **reportable**, so they can see it while
  // remediation is underway. Their Manager gets a narrower gate — read-only only
  // once the Case is fully `Completed`. The Journey Owner reads
  // every Summary of their case type(s), so `journeyOwner: read-only`
  // makes the per-Case link resolve.
  summary: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: (c) => (isReportable(c.status) ? 'read-only' : 'hidden'),
    responsiblePartyManager: (c) =>
      c.status === CASE_STATUS.COMPLETED ? 'read-only' : 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Remediation — *tracking*: lists every **sent** Remediation Action;
  // the Assigned Reviewer resolves each. The tab is hidden entirely until actions
  // have been sent, then `edit` while `Actions In Progress` and `read-only` once
  // `Completed`. The Responsible Party (and their Manager) never see it — they do
  // the work off-system and report back via the Conversation (D10). Other
  // reviewers, the Case Type Owner, the Journey Owner and Controls observe it
  // read-only.
  remediation: {
    assignedReviewer: (c) => {
      if (!hasTrackableRemediation(c)) return 'hidden';
      return c.status === CASE_STATUS.ACTIONS_IN_PROGRESS
        ? 'edit'
        : 'read-only';
    },
    otherReviewer: observesRemediation,
    reviewerManager: observesRemediation,
    // The party who actually does the remediation work — and the two roles who
    // chase it — read the same breakdown, minus the Reviewer's resolution
    // controls. The view routes them to the Conversation instead
    // (`remediationAudience`, #499).
    responsibleParty: observesRemediation,
    responsiblePartyManager: observesRemediation,
    caseTypeOwner: observesRemediation,
    journeyOwner: observesRemediation,
    controls: observesRemediation,
    none: 'hidden',
  },
  // Notes — reviewer working notes. The Assigned Reviewer edits them until the
  // Case is `Completed`, then read-only. Other reviewers and the Case Type Owner
  // observe them read-only; the Journey Owner and Controls do not see them, nor
  // do the Adviser and their Manager.
  notes: {
    assignedReviewer: (c) =>
      c.status === CASE_STATUS.COMPLETED ? 'read-only' : 'edit',
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: 'hidden',
    controls: 'hidden',
    none: 'hidden',
  },
  // The Conversation is the thread between the Assigned Reviewer and the Case's
  // Responsible Party (Adviser); both post subject to the Case Type's
  // `allowMessagesWhen` status gate. A Responsible Party Manager is not a
  // participant, so they cannot see it. Other reviewers, the Case Type Owner, the
  // Journey Owner and Controls observe it read-only.
  conversation: {
    assignedReviewer: (c, config) => {
      const allowed = config.sections?.conversation?.allowMessagesWhen;
      if (allowed && !allowed.includes(c.status)) return 'read-only';
      return 'edit';
    },
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: (c, config) => {
      const allowed = config.sections?.conversation?.allowMessagesWhen;
      if (allowed && !allowed.includes(c.status)) return 'read-only';
      return 'edit';
    },
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Appeal Request — where a Completed Case's Outcome is appealed. The
  // raiser is configured per Case Type (`appeal.raisedBy`): the Journey Owner for
  // Complaints-style journeys, otherwise the Responsible Party Manager. Only that
  // role gets `edit`, and only on a `Completed` Case. The Assigned Reviewer, Case
  // Type Owner, Controls and a non-raiser Journey Owner observe it read-only; the
  // Adviser, their non-raiser Manager and other reviewers see nothing.
  appealRequest: {
    assignedReviewer: 'read-only',
    otherReviewer: 'hidden',
    reviewerManager: 'hidden',
    responsibleParty: 'hidden',
    responsiblePartyManager: (c, config) =>
      appealRaiser(config) === 'responsiblePartyManager' &&
      c.status === CASE_STATUS.COMPLETED
        ? 'edit'
        : 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: (c, config) =>
      appealRaiser(config) === 'journeyOwner' &&
      c.status === CASE_STATUS.COMPLETED
        ? 'edit'
        : 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Appeal Review — where **Controls** resolves an open Appeal on a
  // `Completed` Case, then (on agree) authors the case-level Amended Outcome.
  // Controls gets `edit` only while an Appeal is open; otherwise it, the Assigned
  // Reviewer, the Case Type Owner, the Journey Owner and the raiser's Manager
  // observe it read-only. The Adviser and other reviewers see nothing.
  appealReview: {
    assignedReviewer: 'read-only',
    otherReviewer: 'hidden',
    reviewerManager: 'hidden',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'read-only',
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: (c) =>
      c.status === CASE_STATUS.COMPLETED && hasOpenAppeal(c)
        ? 'edit'
        : 'read-only',
    none: 'hidden',
  },
  // Amend Outcome — the case-level corrective Outcome. **Controls**
  // is the only role that sees this tab: `edit` on a `Completed` Case, `hidden`
  // otherwise. Everyone else is `hidden` — observers see the resulting Current
  // Outcome in the read-only Summary, not this tab.
  amendOutcome: {
    assignedReviewer: 'hidden',
    otherReviewer: 'hidden',
    reviewerManager: 'hidden',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'hidden',
    journeyOwner: 'hidden',
    controls: (c) => (c.status === CASE_STATUS.COMPLETED ? 'edit' : 'hidden'),
    none: 'hidden',
  },
};

/**
 * Most-permissive wins across a viewer's roles.
 * @type {Record<Mode, number>}
 */
const RANK = { edit: 3, 'read-only': 1, hidden: 0 };

/**
 * Resolve the viewer's roles for this specific Case.
 * @param {CaseRow} caseRow
 * @param {string} userId
 * @param {Capabilities} capabilities
 * @returns {Role[]}
 */
export function resolveRoles(caseRow, userId, capabilities) {
  /** @type {Role[]} */
  const roles = [];
  if (caseRow.assignedReviewer === userId) {
    roles.push('assignedReviewer');
  } else if (capabilities.isReviewer) {
    roles.push('otherReviewer');
  }
  // A Reviewer Manager oversees the reviewing function rather than any one Case,
  // so the role is held from group membership alone and composes with whatever
  // else the viewer is on this Case (#499). Across the matrix it observes
  // exactly what a non-assigned Reviewer observes.
  if (capabilities.isReviewerManager) {
    roles.push('reviewerManager');
  }
  if (caseRow.responsibleParty === userId) {
    roles.push('responsibleParty');
  }
  // The "Responsible Party X is managed by Manager Y" relationship is
  // denormalised onto the Case row (CONTEXT.md), so the Manager role is resolved
  // from the row field rather than group membership alone — mirroring how the
  // Responsible Party role is matched.
  if (caseRow.responsiblePartyManager === userId) {
    roles.push('responsiblePartyManager');
  }
  if (capabilities.ownedCaseTypes.includes(caseRow.caseType)) {
    roles.push('caseTypeOwner');
  }
  // The Journey Owner owns a Case Type's end-to-end journey; the role
  // is resolved the same way as the Case Type Owner, from the per-Case-Type
  // `JourneyOwner - <type>` group membership (capabilities.ownedJourneyCaseTypes).
  if (capabilities.ownedJourneyCaseTypes.includes(caseRow.caseType)) {
    roles.push('journeyOwner');
  }
  // The Controls group is a standalone functional role held
  // regardless of whether the user also reviewed or owns the Case Type.
  if (capabilities.isControls) {
    roles.push('controls');
  }
  return roles.length ? roles : ['none'];
}

/**
 * Resolve the effective access mode for a section given the viewer's roles.
 * @param {Section} section
 * @param {Role[]} roles
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} caseTypeConfig
 * @returns {Mode}
 */
export function evaluateAccess(section, roles, caseRow, caseTypeConfig) {
  if (caseTypeConfig.sections && !(section in caseTypeConfig.sections)) {
    return 'hidden';
  }
  /** @type {Mode} */
  let best = 'hidden';
  for (const role of roles) {
    const cell = MATRIX[section][role];
    const mode =
      typeof cell === 'function' ? cell(caseRow, caseTypeConfig) : cell;
    if (RANK[mode] > RANK[best]) best = mode;
  }
  return best;
}
