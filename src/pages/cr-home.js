// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

/**
 * Role-gated landing page. Renders one structural section per capability the
 * current user holds, each with a primary link to that role's main surface.
 * Visitors (no role) get an explainer only; access is managed out-of-band by
 * their team, so there is no in-app access-request affordance.
 */
export class CRHome extends ReactiveElement {
  constructor() {
    super();
    /** @type {Capabilities | null} */
    this.capabilities = null;
  }

  render() {
    const caps = this.capabilities;
    if (!caps) {
      return [];
    }

    /** @type {import('../lib/html.js').VNode[]} */
    const sections = [];

    if (caps.isReviewer) {
      sections.push(this._roleSection('Reviewer', '#/dashboard'));
    }
    if (caps.isReviewerManager) {
      sections.push(this._roleSection('Reviewer Manager', '#/reports/reviewer-team'));
    }
    if (caps.isResponsiblePartyManager) {
      sections.push(
        this._roleSection('Responsible Party Manager', '#/reports/responsible-party-team')
      );
    }
    if (caps.isResponsibleParty) {
      sections.push(this._roleSection('Responsible Party', '#/my-cases'));
    }
    if (caps.ownedCaseTypes.length > 0) {
      sections.push(this._roleSection('Case Type Owner', '#/question-bank'));
    }
    if (caps.isMaintainer) {
      sections.push(this._roleSection('Maintainer', '#/question-bank'));
    }
    if (caps.isVisitor) {
      sections.push(this._visitorSection());
    }

    return sections;
  }

  /**
   * @param {string} roleName
   * @param {string} href
   * @returns {import('../lib/html.js').VNode}
   */
  _roleSection(roleName, href) {
    return h('section', { className: 'cr-home__role' },
      h('h2', {}, roleName),
      h('a', { href }, roleName)
    );
  }

  /** @returns {import('../lib/html.js').VNode} */
  _visitorSection() {
    return h('section', { className: 'cr-home__role' },
      h('h2', {}, 'Visitor'),
      h('p', {},
        "You're signed in, but your account isn't enrolled in any Case Review ",
        "role yet. Access is managed by your team — once you're enrolled, your ",
        "tools will appear here."
      )
    );
  }
}

customElements.define('cr-home', CRHome);
