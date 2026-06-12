// @ts-check

/**
 * Section-level role-based access on the case page. UX-only per ADR-0010;
 * SharePoint list ACLs remain the real boundary. See ADR-0011 for design.
 *
 * @typedef {'details'|'questions'|'conversation'|'notes'|'remediation'|'summary'|'appeal'} Section
 * @typedef {'assignedReviewer'|'otherReviewer'|'responsibleParty'|'responsiblePartyManager'|'caseTypeOwner'|'qaReviewer'|'none'} Role
 * @typedef {'edit'|'override'|'read-only'|'hidden'} Mode
 */

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('./permissions.js').Capabilities} Capabilities */

/** @type {Section[]} */
export const SECTIONS = ['details', 'questions', 'conversation', 'notes', 'remediation', 'summary', 'appeal'];

/**
 * The Sections that can contribute a block to the read-only Summary Section
 * (ADR-0016), in render order. Conversation (a floating overlay, never a tab)
 * and Summary itself never appear as Summary blocks.
 * @type {Section[]}
 */
export const SUMMARY_SECTIONS = ['details', 'questions', 'remediation', 'notes'];

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
 * Default access matrix. Function-valued cells receive the CaseRow and return a Mode.
 * @type {Record<Section, Record<Role, Mode | ((c: CaseRow) => Mode)>>}
 */
const MATRIX = {
  details: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    responsibleParty: 'read-only',
    responsiblePartyManager: 'read-only',
    caseTypeOwner: 'read-only',
    qaReviewer: 'read-only',
    none: 'hidden',
  },
  // A QA Reviewer ("check the checker", ADR-0018) authors Answer Overrides on a
  // Completed Case via the function-valued `override` Mode — read-only while the
  // Case is still In-progress (nothing to correct yet). The Override appends to
  // `overrides[]`; the frozen original Answers are never mutated.
  questions: {
    assignedReviewer: 'edit',
    otherReviewer: 'read-only',
    responsibleParty: 'read-only',
    responsiblePartyManager: 'read-only',
    caseTypeOwner: 'read-only',
    qaReviewer: (c) => (c.status === 'Completed' ? 'override' : 'read-only'),
    none: 'hidden',
  },
  // The Conversation is the thread between the Assigned Reviewer and the Case's
  // Responsible Party (ADR-0011); a Responsible Party Manager is not a
  // participant, so they cannot post — not even read it.
  conversation: {
    assignedReviewer: 'edit',
    otherReviewer: 'read-only',
    responsibleParty: 'edit',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    qaReviewer: 'hidden',
    none: 'hidden',
  },
  notes: {
    assignedReviewer: 'edit',
    otherReviewer: 'read-only',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    qaReviewer: 'hidden',
    none: 'hidden',
  },
  // Remediation shares the QA Override path with questions: a fail→pass / pass→fail
  // Override revises which Remediation Actions apply (replace, never merge).
  remediation: {
    assignedReviewer: 'edit',
    otherReviewer: 'read-only',
    responsibleParty: 'read-only',
    responsiblePartyManager: 'read-only',
    caseTypeOwner: 'read-only',
    qaReviewer: (c) => (c.status === 'Completed' ? 'override' : 'read-only'),
    none: 'hidden',
  },
  // Summary is never `edit` — only `read-only` or `hidden` (ADR-0016). It
  // inherits the function-valued Outcome × Responsible Party cell that
  // previously governed the removed Outcome Section: hidden from the Responsible
  // Party (and their Manager) while In-progress, read-only once Completed.
  summary: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    responsibleParty: (c) => (c.status === 'Completed' ? 'read-only' : 'hidden'),
    responsiblePartyManager: (c) => (c.status === 'Completed' ? 'read-only' : 'hidden'),
    caseTypeOwner: 'read-only',
    qaReviewer: 'read-only',
    none: 'hidden',
  },
  // The Appeal Section (issue #132, ADR-0011): the Responsible Party or their
  // Manager may raise a case-level Appeal, but only against a Completed Case —
  // hidden while In-progress. The QA Reviewer resolves Appeals (issue #134) and
  // so gets `edit` on a Completed Case (read-only while In-progress — nothing to
  // appeal yet). Other reviewers and the Case Type Owner observe it read-only;
  // everyone else sees nothing.
  appeal: {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    responsibleParty: (c) => (c.status === 'Completed' ? 'edit' : 'hidden'),
    responsiblePartyManager: (c) => (c.status === 'Completed' ? 'edit' : 'hidden'),
    caseTypeOwner: 'read-only',
    qaReviewer: (c) => (c.status === 'Completed' ? 'edit' : 'read-only'),
    none: 'hidden',
  },
};

/**
 * Most-permissive wins. `override` (ADR-0018 QA correction) sits between
 * `read-only` and `edit`: a QA Reviewer who is also the Assigned Reviewer keeps
 * full `edit`, but `override` outranks any plain read-only role.
 * @type {Record<Mode, number>}
 */
const RANK = { edit: 3, override: 2, 'read-only': 1, hidden: 0 };

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
  // The QA Reviewers group is standalone (ADR-0018): a QA Reviewer authors Answer
  // Overrides regardless of whether they also reviewed or own the Case Type.
  if (capabilities.isQaReviewer) {
    roles.push('qaReviewer');
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
    const mode = typeof cell === 'function' ? cell(caseRow) : cell;
    if (RANK[mode] > RANK[best]) best = mode;
  }
  return best;
}
