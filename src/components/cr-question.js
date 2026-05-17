// @ts-check
import { CRElement } from './cr-element.js';
import { isFailure } from '../evaluators/failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

const YES_NO_NA = ['Yes', 'No', 'NA'];

export class CRQuestion extends CRElement {
  constructor() {
    super();
    /** @type {QuestionDefinition | null} */
    this.question = null;
    /** @type {string | string[]} */
    this.currentValue = '';
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'edit';
  }

  connectedCallback() {
    this._render();
  }

  /**
   * Forwards programmatic focus to the first input so screen-reader users land
   * inside the radio group when a conditional question appears.
   */
  focus() {
    const input = /** @type {HTMLElement | null} */ (
      /** @type {any} */ (this).querySelector('input')
    );
    if (input) input.focus();
  }

  _render() {
    const q = this.question;
    if (!q) return;

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'cr-question';
    fieldset.id = `cr-q-${q.id}`;
    fieldset.setAttribute('role', q.responseType === 'multi-choice' ? 'group' : 'radiogroup');
    fieldset.setAttribute('aria-required', 'true');

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

    /** @type {HTMLElement[]} */
    const children = [fieldset];
    const panel = this._renderRemediationPanel(q);
    if (panel) children.push(panel);
    this.replaceChildren(...children);
  }

  /**
   * Renders an "Actions required" panel below the question when the current
   * answer is a failure and the question has remediationActions defined.
   * Returns null if no panel should be shown.
   * @param {QuestionDefinition} q
   * @returns {HTMLElement | null}
   */
  _renderRemediationPanel(q) {
    if (!q.remediationActions?.length) return null;
    const answer = { value: this.currentValue };
    if (!isFailure(q, answer)) return null;

    const panel = document.createElement('details');
    panel.className = 'cr-remediation-panel';
    /** @type {any} */ (panel).open = true;

    const summary = document.createElement('summary');
    summary.textContent = 'Actions required';
    panel.appendChild(summary);

    const ul = document.createElement('ul');
    for (const text of q.remediationActions) {
      const li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    }
    panel.appendChild(ul);
    return panel;
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
      if (this.access === 'read-only') radio.disabled = true;
      radio.addEventListener('change', () => {
        if (this.access === 'read-only') return;
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
      if (this.access === 'read-only') checkbox.disabled = true;
      checkbox.addEventListener('change', () => {
        if (this.access === 'read-only') return;
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
