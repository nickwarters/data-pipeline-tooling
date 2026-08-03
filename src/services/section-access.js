// @ts-check
/**
 * Section-level role-based access on the case page. UX-only; SharePoint list
 * ACLs remain the real boundary.
 *
 * The Section id union is projected from `SECTION_REGISTRY` rather
 * than restated here; `MATRIX` below is contract-tested to have exactly its keys.
 *
 * @typedef {import('../lib/section-registry.js').Section} Section
 * @typedef {'edit'|'read-only'|'hidden'} Mode
 */

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('./permissions.js').Capabilities} Capabilities */

import { hasTrackableRemediation } from '../evaluators/remediation-status.js';
import { openAppealOf } from '../evaluators/appeal-state.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import {
  sectionIds,
  summaryBlockIds,
  sectionById,
} from '../lib/section-registry.js';

/**
 * The closed set of roles a viewer can hold on a Case, in the order every
 * `MATRIX` row is keyed. The vocabulary is code-owned: a Case Type may select
 * from it (a Summary block can name the roles it is composed for) but may not
 * add to it, because each name only means something to the matrix below and to
 * `resolveRoles`. A contract test holds the matrix rows and this list together.
 *
 * A role is not a group. Half of these derive from the Case row rather than
 * from directory membership — see `resolveRoles` for which, and why.
 */
export const ROLES = Object.freeze(
  /** @type {const} */ ([
    'assignedReviewer',
    'otherReviewer',
    'reviewerManager',
    'responsibleParty',
    'responsiblePartyManager',
    'caseTypeOwner',
    'journeyOwner',
    'controls',
    'none',
  ])
);

/** @typedef {(typeof ROLES)[number]} Role */

/**
 * A Case is **reportable** once it has passed the freeze milestone: the Reviewer
 * has sent Remediation Actions (`'Actions In Progress'`) or the Case is
 * `'Completed'`.
 *
 * Before that the Answers are live and a newly-applicable Question Definition
 * still blocks completion. From reportable on, the Answers and Outcome snapshot
 * are frozen. The matrix below and `CaseMachine` both key off this predicate
 * rather than a hard-coded status string.
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
 * The Sections that exist on the Case Review page, in canonical order, derived
 * from the Section registry.
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
 * Whether the Case has remediation to track: the Remediation tab would render
 * **≥1 row**, and the Case is past the reportable milestone.
 *
 * Both halves matter. While the Case is `In-progress` the Reviewer is still
 * choosing actions on the Issues tab, so there is nothing to track yet; and
 * remediation is optional, so a reportable Case may carry none at all.
 *
 * The gate asks the *catalogue*, not the Answers blob alone: a Question
 * deprecated or made inapplicable since the Reviewer wrote it must not keep the
 * tab open on a row the tab will not render. The gate and the rows are the same
 * question asked once.
 *
 * Named for the tab, not the rows: the evaluator's `hasTrackableRemediation`
 * answers only the second half, and this file imports it. Two names, because
 * they are two questions.
 *
 * @param {CaseRow} caseRow
 * @param {QuestionDefinition[]} catalogue
 * @returns {boolean}
 */
function remediationTabIsLive(caseRow, catalogue) {
  return (
    isReportable(caseRow.status) &&
    hasTrackableRemediation(catalogue, caseRow.answers)
  );
}

/**
 * The Remediation cell shared by every role that only *observes* the tracking
 * breakdown — which is everyone except the Assigned Reviewer, who resolves it.
 *
 * @param {CaseRow} c
 * @param {CaseTypeConfig} _config
 * @param {QuestionDefinition[]} catalogue
 * @returns {Mode}
 */
const observesRemediation = (c, _config, catalogue) =>
  remediationTabIsLive(c, catalogue) ? 'read-only' : 'hidden';

/**
 * Which of the Remediation Section's two renderings a viewer gets.
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
 * The Conversation cell shared by every participant in the thread: they post
 * unless the Case Type's `allowMessagesWhen` gate excludes the current status,
 * in which case the thread is still readable.
 *
 * @param {CaseRow} c
 * @param {CaseTypeConfig} config
 * @returns {Mode}
 */
const postsWhenAllowed = (c, config) => {
  const allowed = config.sections?.conversation?.allowMessagesWhen;
  return allowed && !allowed.includes(c.status) ? 'read-only' : 'edit';
};

/**
 * The Sections that can contribute a block to the read-only Summary Section, in
 * render order. Conversation (a floating overlay, never a tab) and Summary
 * itself never appear as Summary blocks. Derived from the Section registry
 * rather than restated here.
 * @type {Section[]}
 */
export const SUMMARY_SECTIONS = summaryBlockIds();

/**
 * Whether a Section contributes a block to the Summary Section.
 * Membership in the Case Type's `sections` config object is the allow-list; a
 * Section absent from a defined `sections` is never in Summary. For a member (or
 * when `sections` is undefined, i.e. all enabled) `showInSummary` resolves three
 * ways:
 *
 * - a **role list** — the block is composed for those roles, and any one of the
 *   viewer's roles matching is enough, mirroring the most-permissive rule in
 *   `evaluateAccess`;
 * - a **boolean** — on or off for everyone who can see the Section at all;
 * - **absent** — the registry default applies: Notes is off, every other block
 *   Section is on.
 *
 * This composes the Summary; it does not grant sight of anything. Callers AND
 * the answer with the access matrix, so a role list can only ever subtract from
 * what a viewer already sees — a Case Type cannot name a role into a Section
 * the matrix hides from it. An omitted `roles` therefore resolves a role list to
 * false rather than true.
 *
 * @param {Section} section
 * @param {CaseTypeConfig} caseTypeConfig
 * @param {Role[]} [roles] The viewer's resolved roles for this Case.
 * @returns {boolean}
 */
export function showInSummary(section, caseTypeConfig, roles = []) {
  const sections = caseTypeConfig.sections;
  if (sections && !(section in sections)) return false;
  const explicit = sections?.[section]?.showInSummary;
  if (Array.isArray(explicit)) return roles.some((r) => explicit.includes(r));
  if (explicit !== undefined) return explicit;
  return sectionById(section)?.showInSummaryDefault ?? true;
}

/**
 * Default access matrix. Function-valued cells receive the CaseRow and
 * CaseTypeConfig and return a Mode. Keyed by the registry's Section ids; a
 * contract test asserts the two key sets never drift. The RBAC policy itself
 * stays here, not in the registry.
 * @type {Record<Section, Record<Role, Mode | ((c: CaseRow, config: CaseTypeConfig, catalogue: QuestionDefinition[]) => Mode)>>}
 */
export const MATRIX = {
  // Case Details. Observed read-only by the reviewing/owning/Controls roles;
  // for the Responsible Party and their Manager these fields are folded into
  // the Summary they read.
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
  // Review (the Questions Section). The Assigned Reviewer edits it until the
  // Case is reportable, after which the Answers freeze. Controls, the Case Type
  // Owner and the Journey Owner observe read-only; the Responsible Party side
  // does not see it.
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
  // Summary is never `edit` — only `read-only` or `hidden`. Hidden from the
  // Responsible Party while In-progress and read-only once reportable, so they
  // can see it while remediation is underway; their Manager gets the narrower
  // gate of `Completed`. The Journey Owner reads every Summary of their Case
  // Types, so the per-Case link resolves.
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
  // Remediation — *tracking*: lists every sent Remediation Action; the Assigned
  // Reviewer resolves each. Hidden until actions have been sent, then `edit`
  // while `Actions In Progress` and `read-only` once `Completed`. Everyone else
  // observes the same breakdown read-only.
  remediation: {
    assignedReviewer: (c, _config, catalogue) => {
      if (!remediationTabIsLive(c, catalogue)) return 'hidden';
      return c.status === CASE_STATUS.ACTIONS_IN_PROGRESS
        ? 'edit'
        : 'read-only';
    },
    otherReviewer: observesRemediation,
    reviewerManager: observesRemediation,
    // The party doing the work and the two roles who chase it read the same
    // breakdown without the Reviewer's resolution controls; the view routes them
    // to the Conversation instead (`remediationAudience`).
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
  // The Conversation is the thread between the Assigned Reviewer and the
  // Responsible Party side — including their Manager, who is routed here by the
  // Remediation tab to discuss remediation and report it done — each posting
  // subject to the Case Type's `allowMessagesWhen` status gate. Everyone else
  // observes it read-only.
  conversation: {
    assignedReviewer: postsWhenAllowed,
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: postsWhenAllowed,
    responsiblePartyManager: postsWhenAllowed,
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  },
  // Appeal Request — where a Completed Case's Outcome is appealed. The tab
  // belongs to the Case Type's configured `appeal.raisedBy` role and to nobody
  // else: `edit` on a `Completed` Case, hidden otherwise. It is a form for
  // raising an Appeal, not a record for observers to follow — Controls, who
  // resolves the Appeal, reads its contents on the Appeal Review tab.
  appealRequest: {
    assignedReviewer: 'hidden',
    otherReviewer: 'hidden',
    reviewerManager: 'hidden',
    responsibleParty: 'hidden',
    responsiblePartyManager: (c, config) =>
      appealRaiser(config) === 'responsiblePartyManager' &&
      c.status === CASE_STATUS.COMPLETED
        ? 'edit'
        : 'hidden',
    caseTypeOwner: 'hidden',
    journeyOwner: (c, config) =>
      appealRaiser(config) === 'journeyOwner' &&
      c.status === CASE_STATUS.COMPLETED
        ? 'edit'
        : 'hidden',
    controls: 'hidden',
    none: 'hidden',
  },
  // Appeal Review — where Controls resolves an open Appeal on a `Completed`
  // Case, then (on agree) authors the case-level Amended Outcome. Controls-only.
  // Hidden before the first Appeal, which would otherwise render an empty
  // resolution history on every un-appealed Case, and read-only once every
  // Appeal is resolved, so Controls can read back their own resolution.
  appealReview: {
    assignedReviewer: 'hidden',
    otherReviewer: 'hidden',
    reviewerManager: 'hidden',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'hidden',
    journeyOwner: 'hidden',
    controls: (c) => {
      if (!c.appeals?.length) return 'hidden';
      return c.status === CASE_STATUS.COMPLETED && Boolean(openAppealOf(c))
        ? 'edit'
        : 'read-only';
    },
    none: 'hidden',
  },
  // Amend Outcome — the case-level corrective Outcome. Controls is the only
  // role that sees this tab: `edit` once the Case is reportable, `hidden`
  // before — the Outcome snapshot this Section corrects does not exist until
  // the freeze. Everyone else reads the resulting Current Outcome in the
  // Summary.
  amendOutcome: {
    assignedReviewer: 'hidden',
    otherReviewer: 'hidden',
    reviewerManager: 'hidden',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'hidden',
    journeyOwner: 'hidden',
    controls: (c) => (isReportable(c.status) ? 'edit' : 'hidden'),
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
 *
 * This is the one place the platform-wide capability vocabulary and the
 * per-Case role vocabulary meet, and they are not two spellings of one list.
 * A capability is what a user is anywhere; a role is what they are *on this
 * Case*. So the derivation splits:
 *
 * - from the Case row — `assignedReviewer`, `reviewerManager`,
 *   `responsibleParty`, `responsiblePartyManager`. These are relationships to
 *   one Case, not directory membership, and no group grants them.
 * - from capabilities — `otherReviewer`, `caseTypeOwner`, `journeyOwner`,
 *   `controls`.
 *
 * `isReviewerManager` and `isResponsiblePartyManager` are deliberately NOT
 * consulted, despite existing as capabilities backed by real groups. Reading
 * them here would give every holder of those groups a role on every Case of
 * every Case Type, which is precisely what the row-based match avoids.
 * `isAdviser`, `isMaintainer`, `isVisitor` and `listAccessCaseTypes` are not
 * role sources either — the first three describe what a user does elsewhere in
 * the app, and the last only feeds `isReviewer`.
 *
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
  // "Reviewer X is managed by Reviewer Manager Y" is denormalised onto the Case
  // row (CONTEXT.md), so the role resolves from that field rather than the
  // platform-wide group: a manager reads the Cases of the Reviewers they manage,
  // not every Case of every Case Type.
  //
  // The field is a reporting snapshot, frozen at Reportable, and resolving a
  // read-only Role from it is deliberate — unlike the Responsible Party Manager
  // below, which is to resolve live from the directory because that Role
  // carries `edit` on the Conversation.
  if (caseRow.assignedReviewerManager === userId) {
    roles.push('reviewerManager');
  }
  if (caseRow.responsibleParty === userId) {
    roles.push('responsibleParty');
  }
  // Denormalised onto the Case row (CONTEXT.md), mirroring how the Responsible
  // Party role is matched.
  //
  // The row is the wrong authority for this Role: it carries `edit` on the
  // Conversation, so a stale row leaves a former manager posting on a live
  // thread. It is to resolve live from the Responsible Party's current manager,
  // failing closed. Not yet implemented.
  if (caseRow.responsiblePartyManager === userId) {
    roles.push('responsiblePartyManager');
  }
  if (capabilities.ownedCaseTypes.includes(caseRow.caseType)) {
    roles.push('caseTypeOwner');
  }
  // The Journey Owner owns a Case Type's end-to-end journey, resolved like the
  // Case Type Owner from `JourneyOwner - <type>` group membership.
  if (capabilities.ownedJourneyCaseTypes.includes(caseRow.caseType)) {
    roles.push('journeyOwner');
  }
  // Controls is a standalone functional role, held regardless of whether the
  // user also reviewed or owns the Case Type.
  if (capabilities.isControls) {
    roles.push('controls');
  }
  return roles.length ? roles : ['none'];
}

/**
 * Which side of the Conversation a viewer posts from, or `null` for someone on
 * neither side of the exchange.
 *
 * Awaiting Frontline means "the Reviewer asked the frontline something and no
 * reply has come back", so only those two sides move that clock. A Reviewer
 * Manager, Case Type Owner, Journey Owner or Controls may all post; none of
 * them is the Reviewer asking or the frontline answering.
 *
 * A viewer holding roles on both sides posts as the Reviewer, the same
 * reviewer-side-wins rule `remediationAudience` uses.
 *
 * @param {Role[]} roles
 * @returns {'reviewer' | 'responsibleParty' | null}
 */
export function conversationSideOf(roles) {
  if (roles.includes('assignedReviewer') || roles.includes('otherReviewer')) {
    return 'reviewer';
  }
  if (
    roles.includes('responsibleParty') ||
    roles.includes('responsiblePartyManager')
  ) {
    return 'responsibleParty';
  }
  return null;
}

/**
 * Resolve the effective access mode for a section given the viewer's roles.
 *
 * @param {Section} section
 * @param {Role[]} roles
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} caseTypeConfig
 * @param {QuestionDefinition[]} [catalogue] The Case's **resolved** Question
 *   catalogue, with `failureValues` derived. Only the Remediation cells read it.
 *   Absent means *no Questions*, so Remediation resolves `hidden`: pass it from
 *   any caller that renders the Section, and omit it only where the Section is
 *   out of scope.
 * @returns {Mode}
 */
export function evaluateAccess(
  section,
  roles,
  caseRow,
  caseTypeConfig,
  catalogue = []
) {
  if (caseTypeConfig.sections && !(section in caseTypeConfig.sections)) {
    return 'hidden';
  }
  /** @type {Mode} */
  let best = 'hidden';
  for (const role of roles) {
    const cell = MATRIX[section][role];
    const mode =
      typeof cell === 'function'
        ? cell(caseRow, caseTypeConfig, catalogue)
        : cell;
    if (RANK[mode] > RANK[best]) best = mode;
  }
  return best;
}
