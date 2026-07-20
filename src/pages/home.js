// @ts-check
import { h } from '../lib/html.js';

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */

/**
 * @typedef {Object} HomeState
 * @property {ChromeState} chrome
 * @property {{ home: Record<string, never> }} routes
 */

/**
 * Role-gated landing page. Permissions come from the shared chrome slice.
 *
 * @param {HomeState} state
 * @returns {HTMLElement}
 */
export function homeView(state) {
  const capabilities = state.chrome.permissions;
  /** @type {Node[]} */
  const sections = [];

  if (capabilities.isReviewer) {
    sections.push(roleSection('Reviewer', '#/dashboard'));
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

  return h('div', { className: 'cora-home' }, ...sections);
}

/**
 * @param {string} roleName
 * @param {string} href
 * @returns {Node}
 */
function roleSection(roleName, href) {
  return h(
    'section',
    { className: 'cora-home__role' },
    h('h2', {}, roleName),
    h('a', { href }, roleName)
  );
}

/** @returns {Node} */
function visitorSection() {
  return h(
    'section',
    { className: 'cora-home__role' },
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

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @returns {{
 *   initialState: HomeState,
 *   reducer: (state: HomeState, action: unknown) => HomeState,
 *   view: (state: HomeState) => HTMLElement,
 * }}
 */
export function createRouteSlice(_params, context) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: { home: {} },
    },
    reducer: (state) => state,
    view: homeView,
  };
}
