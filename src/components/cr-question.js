// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { normaliseConfiguredActions } from '../evaluators/configured-outcome.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

const YES_NO_NA = ['Yes', 'No', 'NA'];

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRQuestion extends ReactiveElement {
  constructor() {
    super();
    /** @type {QuestionDefinition | null} */
    this.question = null;
    /** @type {string | string[]} */
    this.currentValue = '';
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'edit';
  }

  // Preserve manual _render for existing tests that bypass reactive updates
  _render() {
    const content = this.render();
    if (content) {
      if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        // @ts-ignore
        this.replaceChildren(content);
      }
    } else {
      this.replaceChildren();
    }
  }

  focus() {
    const input = /** @type {HTMLElement | null} */ (
      this.querySelector('input')
    );
    if (input) input.focus();
  }

  /** @returns {Node[] | undefined} */
  render() {
    const q = this.question;
    if (!q) return;

    return [
      h(
        'fieldset',
        {
          class: 'cr-question',
          id: `cr-q-${q.id}`,
          role: q.responseType === 'multi-choice' ? 'group' : 'radiogroup',
          'aria-required': 'true',
        },
        h('legend', {}, q.text),
        q.responseType === 'multi-choice'
          ? this._renderMultiChoice(q)
          : this._renderSingleChoice(q)
      ),
      this._renderRemediationPanel(q),
    ].filter((node) => node !== null);
  }

  /**
   * @param {QuestionDefinition} q
   */
  _renderRemediationPanel(q) {
    if (!q.remediationActions?.length) return null;
    const answer = { value: this.currentValue };
    if (!isFailure(q, answer)) return null;

    return h(
      'details',
      { class: 'cr-remediation-panel', open: true },
      h('summary', {}, 'Actions required'),
      h(
        'ul',
        {},
        normaliseConfiguredActions(q.remediationActions, q.id).map((action) =>
          h('li', {}, action.text)
        )
      )
    );
  }

  /**
   * @param {QuestionDefinition} q
   */
  _renderSingleChoice(q) {
    const options =
      q.responseType === 'yes-no-na' ? YES_NO_NA : (q.options ?? []);
    const current =
      typeof this.currentValue === 'string' ? this.currentValue : '';

    return options.map((opt, i) =>
      h(
        'label',
        {},
        h('input', {
          type: 'radio',
          name: `cr-q-${q.id}`,
          value: opt,
          'data-focus-key': `answer:${q.id}:${i}`,
          checked: current === opt,
          disabled: this.access === 'read-only',
          onchange: () => {
            if (this.access === 'read-only') return;
            this.dispatchEvent(
              new CustomEvent('cr-answer', {
                detail: { questionId: q.id, value: opt },
                bubbles: true,
              })
            );
          },
        }),
        h('span', {}, ` ${opt}`)
      )
    );
  }

  /**
   * @param {QuestionDefinition} q
   */
  _renderMultiChoice(q) {
    const options = q.options ?? [];
    const selected = new Set(
      Array.isArray(this.currentValue) ? this.currentValue : []
    );

    return options.map((opt, i) =>
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          name: `cr-q-${q.id}`,
          value: opt,
          'data-focus-key': `answer:${q.id}:${i}`,
          checked: selected.has(opt),
          disabled: this.access === 'read-only',
          onchange: (/** @type {any} */ e) => {
            if (this.access === 'read-only') return;
            const next = new Set(selected);
            if (e.target.checked) next.add(opt);
            else next.delete(opt);
            const value = options.filter((o) => next.has(o));
            this.dispatchEvent(
              new CustomEvent('cr-answer', {
                detail: { questionId: q.id, value },
                bubbles: true,
              })
            );
          },
        }),
        h('span', {}, ` ${opt}`)
      )
    );
  }
}

customElements.define('cr-question', CRQuestion);
