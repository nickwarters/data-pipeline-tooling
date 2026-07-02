// @ts-check
import { h } from '../lib/html.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

/**
 * Role-gated landing page. Renders one structural section per capability the
 * current user holds, each with a primary link to that role's main surface.
 * Visitors (no role) get an explainer only; access is managed out-of-band by
 * their team, so there is no in-app access-request affordance.
 * @param {{ capabilities: Capabilities | null }} props
 * @returns {Node[]}
 */
export function HomePage({ capabilities }) {
  if (!capabilities) {
    return [];
  }

  /** @type {Node[]} */
  const sections = [];

  if (capabilities.isReviewer) {
    sections.push(roleSection('Reviewer', '#/dashboard'));
  }
  if (capabilities.isReviewerManager) {
    sections.push(roleSection('Reviewer Manager', '#/reports/reviewer-team'));
  }
  if (capabilities.isResponsiblePartyManager) {
    sections.push(
      roleSection(
        'Responsible Party Manager',
        '#/reports/responsible-party-team'
      )
    );
  }
  if (capabilities.isAdviser) {
    sections.push(roleSection('Responsible Party', '#/my-cases'));
  }
  if (capabilities.ownedCaseTypes.length > 0) {
    sections.push(roleSection('Case Type Owner', '#/question-bank'));
  }
  if (capabilities.ownedJourneyCaseTypes.length > 0) {
    sections.push(roleSection('Journey Owner', '#/journey-cases'));
  }
  if (capabilities.isMaintainer) {
    sections.push(roleSection('Maintainer', '#/question-bank'));
  }
  if (capabilities.isVisitor) {
    sections.push(visitorSection());
  }

  return sections;
}

/**
 * @param {string} roleName
 * @param {string} href
 * @returns {Node}
 */
function roleSection(roleName, href) {
  return h(
    'section',
    { className: 'cr-home__role' },
    h('h2', {}, roleName),
    h('a', { href }, roleName)
  );
}

/** @returns {Node} */
function visitorSection() {
  return h(
    'section',
    { className: 'cr-home__role' },
    h('h2', {}, 'Visitor'),
    h(
      'p',
      {},
      "You're signed in, but your account isn't enrolled in any Case Review ",
      "role yet. Access is managed by your team — once you're enrolled, your ",
      'tools will appear here.'
    )
  );
}
