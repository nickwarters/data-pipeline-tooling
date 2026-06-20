// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { commit } from '../question-bank/question-bank-store.js';

export class CRRemediationEditor extends ReactiveElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }

  _render() {
    const el = this.render();
    if (el) this.replaceChildren(el);
    else this.replaceChildren();
  }

  render() {
    const q = this.question;
    if (!q) return;

    const count = (q.remediationActions || []).length;

    const freeRow = h(
      'div',
      { class: 'rem-free-row' },
      h('div', {
        innerHTML:
          '<div class="rem-free-title">Allow free-form remediation</div>' +
          '<div class="rem-free-help">Reviewers can write their own remediation alongside any canned actions.</div>',
      }),
      h('div', {
        class: 'toggle' + (q.allowFreeFormRemediation ? ' on' : ''),
        onclick: () =>
          commit(() => {
            q.allowFreeFormRemediation = !q.allowFreeFormRemediation;
          }),
      })
    );

    const wrap = h(
      'div',
      { class: 'rem-block' },
      h('h4', {
        innerHTML: `Remediation Actions <span class="rem-count">(${count}${q.allowFreeFormRemediation ? ' + free-form' : ''})</span>`,
      }),
      freeRow
    );

    if (q.allowFreeFormRemediation) {
      wrap.appendChild(
        h('div', {
          class: 'rem-free-preview',
          innerHTML:
            '<div class="rem-free-preview-eyebrow">Reviewer will see</div>' +
            '<div class="rem-free-preview-body">"Describe a remediation in your own words…"</div>',
        })
      );
    }

    (q.remediationActions || []).forEach(
      (/** @type {string} */ r, /** @type {number} */ idx) => {
        const inp = /** @type {any} */ (h('input', { value: r }));
        inp.addEventListener('change', (/** @type {any} */ e) =>
          commit(() => {
            q.remediationActions[idx] = e.target.value;
          })
        );
        wrap.appendChild(
          h(
            'div',
            { class: 'rem-item' },
            inp,
            h(
              'span',
              {
                class: 'x',
                onclick: () =>
                  commit(() => {
                    q.remediationActions.splice(idx, 1);
                    if (q.remediationActions.length === 0)
                      delete q.remediationActions;
                  }),
              },
              '×'
            )
          )
        );
      }
    );

    if (count === 0 && !q.allowFreeFormRemediation) {
      wrap.appendChild(
        h(
          'div',
          { class: 'rem-empty' },
          '// no remediations — reviewers will see none on failure'
        )
      );
    }

    wrap.appendChild(
      h(
        'button',
        {
          class: 'tag-add rem-add',
          onclick: () =>
            commit(() => {
              (q.remediationActions ||= []).push('New action');
            }),
        },
        '+ canned action'
      )
    );

    return wrap;
  }
}

customElements.define('cr-remediation-editor', CRRemediationEditor);
