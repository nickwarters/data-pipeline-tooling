// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./sharepoint-client.js').QuestionDefinition} QuestionDefinition */

const YES_NO_NA = ['Yes', 'No', 'NA'];

export class CRQuestion extends CRElement {
  constructor() {
    super();
    /** @type {QuestionDefinition | null} */
    this.question = null;
    /** @type {string | string[]} */
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

    if (q.responseType === 'multi-choice') {
      this._renderMultiChoice(fieldset, q);
    } else {
      // yes-no-na has a fixed option set; single-choice uses the definition's options.
      const options = q.responseType === 'yes-no-na' ? YES_NO_NA : (q.options ?? []);
      this._renderSingleChoice(fieldset, q, options);
    }

    this.replaceChildren(fieldset);
  }

  /**
   * @param {HTMLElement} fieldset
   * @param {QuestionDefinition} q
   * @param {string[]} options
   */
  _renderSingleChoice(fieldset, q, options) {
    const current = typeof this.currentValue === 'string' ? this.currentValue : '';
    for (const opt of options) {
      const label = document.createElement('label');
      const radio = /** @type {HTMLInputElement} */ (document.createElement('input'));
      radio.type = 'radio';
      radio.name = `cr-q-${q.id}`;
      radio.value = opt;
      radio.checked = current === opt;
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
  }

  /**
   * @param {HTMLElement} fieldset
   * @param {QuestionDefinition} q
   */
  _renderMultiChoice(fieldset, q) {
    const options = q.options ?? [];
    const selected = new Set(Array.isArray(this.currentValue) ? this.currentValue : []);
    for (const opt of options) {
      const label = document.createElement('label');
      const checkbox = /** @type {HTMLInputElement} */ (document.createElement('input'));
      checkbox.type = 'checkbox';
      checkbox.name = `cr-q-${q.id}`;
      checkbox.value = opt;
      checkbox.checked = selected.has(opt);
      checkbox.addEventListener('change', () => {
        const next = new Set(selected);
        if (checkbox.checked) next.add(opt);
        else next.delete(opt);
        // Preserve the catalogue order rather than insertion order.
        const value = options.filter(o => next.has(o));
        this.dispatchEvent(new CustomEvent('cr-answer', {
          detail: { questionId: q.id, value },
          bubbles: true,
        }));
      });
      const span = document.createElement('span');
      span.textContent = ` ${opt}`;
      label.appendChild(checkbox);
      label.appendChild(span);
      fieldset.appendChild(label);
    }
  }
}

customElements.define('cr-question', CRQuestion);
