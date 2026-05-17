// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { commit } from './question-bank-store.js';

export class CRRemediationEditor extends CRElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const q = this.question;
    if (!q) return;
    const wrap = el('div', { class: 'rem-block' });
    const count = (q.remediationActions || []).length;
    wrap.appendChild(el('h4', {
      html: `Remediation Actions <span class="rem-count">(${count}${q.allowFreeFormRemediation ? ' + free-form' : ''})</span>`,
    }));

    const freeRow = el('div', { class: 'rem-free-row' },
      el('div', { html:
        '<div class="rem-free-title">Allow free-form remediation</div>' +
        '<div class="rem-free-help">Reviewers can write their own remediation alongside any canned actions.</div>' }),
      el('div', { class: 'toggle' + (q.allowFreeFormRemediation ? ' on' : ''),
        onclick: () => commit(() => { q.allowFreeFormRemediation = !q.allowFreeFormRemediation; }) }),
    );
    wrap.appendChild(freeRow);

    if (q.allowFreeFormRemediation) {
      wrap.appendChild(el('div', { class: 'rem-free-preview', html:
        '<div class="rem-free-preview-eyebrow">Reviewer will see</div>' +
        '<div class="rem-free-preview-body">"Describe a remediation in your own words…"</div>' }));
    }

    (q.remediationActions || []).forEach((/** @type {string} */ r, /** @type {number} */ idx) => {
      const inp = /** @type {any} */ (el('input', { value: r }));
      inp.addEventListener('change', (/** @type {any} */ e) =>
        commit(() => { q.remediationActions[idx] = e.target.value; }));
      wrap.appendChild(el('div', { class: 'rem-item' },
        inp,
        el('span', { class: 'x', onclick: () => commit(() => {
          q.remediationActions.splice(idx, 1);
          if (q.remediationActions.length === 0) delete q.remediationActions;
        }) }, '×'),
      ));
    });

    if (count === 0 && !q.allowFreeFormRemediation) {
      wrap.appendChild(el('div', { class: 'rem-empty' },
        '// no remediations — reviewers will see none on failure'));
    }

    wrap.appendChild(el('button', { class: 'tag-add rem-add',
      onclick: () => commit(() => { (q.remediationActions ||= []).push('New action'); }) },
      '+ canned action'));

    this.replaceChildren(wrap);
  }
}

customElements.define('cr-remediation-editor', CRRemediationEditor);
