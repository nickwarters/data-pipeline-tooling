// @ts-check
import { CRElement } from '../components/cr-element.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

/**
 * Role-gated landing page. Renders one structural section per capability the
 * current user holds, each with a primary link to that role's main surface.
 * Visitors (no role) get an explainer only; access is managed out-of-band by
 * their team, so there is no in-app access-request affordance.
 */
export class CRHome extends CRElement {
  constructor() {
    super();
    /** @type {Capabilities | null} */
    this.capabilities = null;
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const caps = this.capabilities;
    if (!caps) {
      this.replaceChildren();
      return;
    }

    /** @type {Element[]} */
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
      sections.push(this._roleSection('Responsible Party', '#/conversation'));
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

    this.replaceChildren(...sections);
  }

  /**
   * @param {string} roleName
   * @param {string} href
   * @returns {HTMLElement}
   */
  _roleSection(roleName, href) {
    const section = document.createElement('section');
    section.className = 'cr-home__role';

    const h2 = document.createElement('h2');
    h2.textContent = roleName;

    const a = document.createElement('a');
    a.href = href;
    a.textContent = roleName;

    section.append(h2, a);
    return section;
  }

  /** @returns {HTMLElement} */
  _visitorSection() {
    const section = document.createElement('section');
    section.className = 'cr-home__role';

    const h2 = document.createElement('h2');
    h2.textContent = 'Visitor';

    const explainer = document.createElement('p');
    explainer.textContent =
      "You're signed in, but your account isn't enrolled in any Case Review " +
      'role yet. Access is managed by your team — once you\'re enrolled, your ' +
      'tools will appear here.';

    section.append(h2, explainer);
    return section;
  }
}

customElements.define('cr-home', CRHome);
