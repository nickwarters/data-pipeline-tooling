// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { commit, currentBank } from '../question-bank/question-bank-store.js';
import { normaliseConfiguredActions } from '../evaluators/configured-outcome.js';

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

    if (q.failureCriteria) {
      wrap.appendChild(this._renderNoActionOutcome(q));
    }

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

    normaliseConfiguredActions(q.remediationActions || [], q.id).forEach(
      (/** @type {any} */ action, /** @type {number} */ idx) => {
        const inp = /** @type {any} */ (h('input', { value: action.text }));
        inp.addEventListener('change', (/** @type {any} */ e) =>
          commit(() => {
            this._ensureActionObjects(q);
            q.remediationActions[idx].text = e.target.value;
          })
        );
        wrap.appendChild(
          h(
            'div',
            { class: 'rem-item' },
            inp,
            this._renderActionOutcome(q, action, idx),
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
              (q.remediationActions ||= []).push({
                id: this._nextActionId(q),
                text: 'New action',
              });
            }),
        },
        '+ canned action'
      )
    );

    return wrap;
  }

  /** @param {any} q */
  _renderNoActionOutcome(q) {
    const outcomeOptions = currentBank.get()?.outcomeOptions ?? [];
    return h(
      'div',
      { class: 'rem-outcome-block' },
      h('h5', {}, 'Default outcome when no action is selected'),
      this._outcomeSelect(
        q.outcome?.noActionOutcomeId ?? '',
        outcomeOptions,
        (id) =>
          commit(() => {
            q.outcome ??= {};
            if (id) q.outcome.noActionOutcomeId = id;
            else delete q.outcome.noActionOutcomeId;
            delete q.outcome.noAction;
            if (!Object.keys(q.outcome).length) delete q.outcome;
          })
      )
    );
  }

  /**
   * @param {any} q
   * @param {any} action
   * @param {number} idx
   */
  _renderActionOutcome(q, action, idx) {
    const outcomeOptions = currentBank.get()?.outcomeOptions ?? [];
    return h(
      'div',
      { class: 'rem-action-outcome' },
      this._outcomeSelect(action.outcomeId ?? '', outcomeOptions, (id) =>
        commit(() => {
          this._ensureActionObjects(q);
          const configured = q.remediationActions[idx];
          if (id) configured.outcomeId = id;
          else delete configured.outcomeId;
          delete configured.outcome;
        })
      )
    );
  }

  /**
   * @param {string} value
   * @param {import('../sharepoint-client.js').OutcomeOption[]} outcomeOptions
   * @param {(id: string) => void} onChange
   */
  _outcomeSelect(value, outcomeOptions, onChange) {
    return h(
      'select',
      {
        className: 'rem-outcome-select',
        value,
        onchange: (/** @type {any} */ e) => onChange(e.target.value),
        disabled: outcomeOptions.length === 0,
      },
      h(
        'option',
        { value: '' },
        outcomeOptions.length ? '—' : 'No outcomes configured'
      ),
      ...outcomeOptions.map((option) =>
        h(
          'option',
          { value: option.id },
          `${option.wording} (${option.verdict})`
        )
      )
    );
  }

  /** @param {any} q */
  _ensureActionObjects(q) {
    q.remediationActions = normaliseConfiguredActions(
      q.remediationActions || [],
      q.id
    );
  }

  /** @param {any} q */
  _nextActionId(q) {
    const ids = new Set(
      normaliseConfiguredActions(q.remediationActions || [], q.id).map(
        (a) => a.id
      )
    );
    let index = ids.size;
    let id = `${q.id}-ra-${index}`;
    while (ids.has(id)) {
      index += 1;
      id = `${q.id}-ra-${index}`;
    }
    return id;
  }
}

customElements.define('cr-remediation-editor', CRRemediationEditor);
