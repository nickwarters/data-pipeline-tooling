// @ts-check
// TODO(simplify-ui): Keep service access as explicit plain dependencies
// passed into route shells/function components. The simplified UI should not
// require component authors to understand service classes, global singletons,
// or lifecycle wiring to perform ordinary reads and writes.

/**
 * Section-level role-based access on the case page. UX-only per ADR-0010;
 * SharePoint list ACLs remain the real boundary. See ADR-0011 for design.
 *
 * @typedef {'details'|'questions'|'conversation'|'notes'|'issues'|'remediation'|'summary'|'appeal'} Section
 * @typedef {'assignedReviewer'|'otherReviewer'|'responsibleParty'|'responsiblePartyManager'|'caseTypeOwner'|'controls'|'none'} Role
 * @typedef {'edit'|'read-only'|'hidden'} Mode
 */

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('./permissions.js').Capabilities} Capabilities */

import { allSentActions } from '../evaluators/remediation-actions.js';

/**
 * A Case is **reportable** (ADR-0023) once it has passed the freeze milestone:
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
  return status === 'Actions In Progress' || status === 'Completed';
}

/** @type {Section[]} */
export const SECTIONS = [
  'details',
  'questions',
  'conversation',
  'notes',
  'issues',
  'remediation',
  'summary',
  'appeal',
];

/**
 * Whether the Case carries ≥1 **sent** Remediation Action across its Answers
 * (ADR-0024). The Remediation *tracking* Section is meaningful only once actions
 * have been sent, so it is hidden entirely when the Case has none.
 *
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
 * @returns {boolean}
 */
function hasSentActions(caseRow, config) {
  return allSentActions(caseRow.answers, config.captureGroups).length > 0;
}

/**
 * The Sections that can contribute a block to the read-only Summary Section
 * (ADR-0016), in render order. Conversation (a floating overlay, never a tab)
 * and Summary itself never appear as Summary blocks.
 * @type {Section[]}
 */
export const SUMMARY_SECTIONS = [
  'details',
  'questions',
  'issues',
  'remediation',
  'notes',
];

/**
 * Whether a Section contributes a block to the Summary Section (ADR-0016).
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
  return section !== 'notes';
}

/**
 * Default access matrix. Function-valued cells receive the CaseRow and CaseTypeConfig and return a Mode.
 * @type {Record<Section, Record<Role, Mode | ((c: CaseRow, config: CaseTypeConfig) => Mode)>>}
 */
const MATRIX = {
  details: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    responsibleParty: 'read-only',
    responsiblePartyManager: 'read-only',
    caseTypeOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Controls (ADR-0022) observe the reviewed Answers read-only. Post-completion
  // corrections are no longer per-Answer overrides (ADR-0026 retires QA Check +
  // Answer Override); a case-level Amended Outcome will supply corrections via its
  // own Section in a later slice.
  questions: {
    assignedReviewer: 'edit',
    otherReviewer: 'read-only',
    responsibleParty: 'read-only',
    responsiblePartyManager: 'read-only',
    caseTypeOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // The Conversation is the thread between the Assigned Reviewer and the Case's
  // Responsible Party (ADR-0011); a Responsible Party Manager is not a
  // participant, so they cannot post — not even read it.
  conversation: {
    assignedReviewer: (c, config) => {
      const allowed = config.sections?.conversation?.allowMessagesWhen;
      if (allowed && !allowed.includes(c.status)) return 'read-only';
      return 'edit';
    },
    otherReviewer: 'read-only',
    responsibleParty: (c, config) => {
      const allowed = config.sections?.conversation?.allowMessagesWhen;
      if (allowed && !allowed.includes(c.status)) return 'read-only';
      return 'edit';
    },
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    controls: 'hidden',
    none: 'hidden',
  },
  notes: {
    assignedReviewer: 'edit',
    otherReviewer: 'read-only',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    controls: 'hidden',
    none: 'hidden',
  },
  // Issues (ADR-0024, formerly the single `remediation` key) — *capture*: failed
  // Answers + their Issue Capture Groups/Fields (ADR-0020) + the Responsible
  // Party selector. Reviewer-editable until the Case is reportable; observed
  // read-only by Controls (see `questions`).
  issues: {
    assignedReviewer: 'edit',
    otherReviewer: 'read-only',
    responsibleParty: 'read-only',
    responsiblePartyManager: 'read-only',
    caseTypeOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Remediation (ADR-0024) — *tracking*: lists every **sent** Remediation Action;
  // the Assigned Reviewer resolves each. The tab is hidden entirely until actions
  // have been sent, then `edit` while `Actions In Progress` and `read-only` once
  // `Completed`. The Responsible Party (and their Manager) never see it — they do
  // the work off-system and report back via the Conversation (D10). Other
  // reviewers, the Case Type Owner and Controls observe it read-only.
  remediation: {
    assignedReviewer: (c, config) => {
      if (!hasSentActions(c, config)) return 'hidden';
      return c.status === 'Actions In Progress' ? 'edit' : 'read-only';
    },
    otherReviewer: (c, config) =>
      hasSentActions(c, config) ? 'read-only' : 'hidden',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: (c, config) =>
      hasSentActions(c, config) ? 'read-only' : 'hidden',
    controls: (c, config) =>
      hasSentActions(c, config) ? 'read-only' : 'hidden',
    none: 'hidden',
  },
  // Summary is never `edit` — only `read-only` or `hidden` (ADR-0016). It
  // inherits the function-valued Outcome × Responsible Party cell that
  // previously governed the removed Outcome Section: hidden from the Responsible
  // Party (and their Manager) while In-progress, read-only once the Case is
  // reportable. ADR-0023 widened the gate from `Completed` to `reportable`, so
  // the Adviser can see the Summary while remediation is underway (Actions In
  // Progress), not only after the Case finally closes.
  summary: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    responsibleParty: (c) => (isReportable(c.status) ? 'read-only' : 'hidden'),
    responsiblePartyManager: (c) =>
      isReportable(c.status) ? 'read-only' : 'hidden',
    caseTypeOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // The Appeal Section (issue #132, ADR-0011): the Responsible Party or their
  // Manager may raise a case-level Appeal, but only against a Completed Case —
  // hidden while In-progress. Other reviewers, the Case Type Owner and Controls
  // observe it read-only; everyone else sees nothing.
  //
  // Appeal *resolution* is parked: it previously ran through the retired QA
  // Reviewer + Answer Override machinery (ADR-0018). Under ADR-0027 the resolver
  // is Controls via a dedicated Appeal Review tab, rebuilt in a later slice — so
  // Controls is read-only here for now rather than a resolver.
  appeal: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    responsibleParty: (c) => (c.status === 'Completed' ? 'edit' : 'hidden'),
    responsiblePartyManager: (c) =>
      c.status === 'Completed' ? 'edit' : 'hidden',
    caseTypeOwner: 'read-only',
    controls: 'read-only',
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
  // The Controls group (ADR-0022) is a standalone functional role held
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
