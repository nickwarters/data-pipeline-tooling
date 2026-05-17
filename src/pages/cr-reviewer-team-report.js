// @ts-check
import { CRElement } from '../components/cr-element.js';

export class CRReviewerTeamReport extends CRElement {
  connectedCallback() {
    const h1 = document.createElement('h1');
    h1.textContent = 'Reviewer Team Performance';

    const back = document.createElement('a');
    back.setAttribute('href', '#/reports');
    back.textContent = '← Back to Reports';

    const placeholder = document.createElement('p');
    placeholder.textContent = 'This report is coming soon.';

    this.replaceChildren(h1, back, placeholder);
  }
}

customElements.define('cr-reviewer-team-report', CRReviewerTeamReport);
