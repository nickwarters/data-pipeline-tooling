// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./sharepoint-client.js').QuestionDefinition} QuestionDefinition */

export class CRQuestion extends CRElement {
  constructor() {
    super();
    /** @type {QuestionDefinition | null} */
    this.question = null;
    /** @type {string} */
    this.currentValue = '';
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const q = this.question;
    if (!q) return;

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'cr-question';

    const legend = document.createElement('legend');
    legend.textContent = q.text;
    fieldset.appendChild(legend);

    for (const opt of ['Yes', 'No', 'NA']) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `cr-q-${q.id}`;
      radio.value = opt;
      radio.checked = this.currentValue === opt;
      radio.addEventListener('change', () => {
        this.dispatchEvent(new CustomEvent('cr-answer', {
          detail: { questionId: q.id, value: opt },
          bubbles: true,
        }));
      });
      const span = document.createElement('span');
      span.textContent = ` ${opt}`;
      label.appendChild(radio);
      label.appendChild(span);
      fieldset.appendChild(label);
    }

    this.replaceChildren(fieldset);
  }
}

customElements.define('cr-question', CRQuestion);
