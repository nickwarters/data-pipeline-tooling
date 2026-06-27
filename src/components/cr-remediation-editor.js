// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { commit } from '../question-bank/question-bank-store.js';
import {
  DEFAULT_OUTCOME_RANK,
  defaultWordingFor,
  normaliseConfiguredActions,
} from '../evaluators/configured-outcome.js';

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
    const descriptor = q.outcome?.noAction;
    return h(
      'div',
      { class: 'rem-outcome-block' },
      h('h5', {}, 'Default outcome when no action is selected'),
      this._outcomeFields({
        descriptor,
        onEnable: () => {
          q.outcome ??= {};
          q.outcome.noAction = {
            verdict: 'fail',
            wording: 'Fail',
            rank: DEFAULT_OUTCOME_RANK.fail,
          };
        },
        onDisable: () => {
          if (!q.outcome) return;
          delete q.outcome.noAction;
          if (!Object.keys(q.outcome).length) delete q.outcome;
        },
      })
    );
  }

  /**
   * @param {any} q
   * @param {any} action
   * @param {number} idx
   */
  _renderActionOutcome(q, action, idx) {
    return h(
      'div',
      { class: 'rem-action-outcome' },
      this._outcomeFields({
        descriptor: action.outcome,
        onEnable: () => {
          this._ensureActionObjects(q);
          const configured = q.remediationActions[idx];
          configured.outcome = {
            verdict: 'fail',
            wording: defaultWordingFor('fail'),
            rank: DEFAULT_OUTCOME_RANK.fail,
          };
        },
        onDisable: () => {
          this._ensureActionObjects(q);
          delete q.remediationActions[idx].outcome;
        },
        compact: true,
      })
    );
  }

  /**
   * @param {{
   *   descriptor: any,
   *   onEnable: () => void,
   *   onDisable: () => void,
   *   compact?: boolean,
   * }} opts
   */
  _outcomeFields(opts) {
    if (!opts.descriptor) {
      return h(
        'button',
        {
          class: 'tag-add rem-outcome-add',
          onclick: () => commit(opts.onEnable),
        },
        opts.compact ? '+ outcome' : '+ default outcome'
      );
    }

    return h(
      'div',
      { class: opts.compact ? 'rem-outcome-grid compact' : 'rem-outcome-grid' },
      this._field(
        'Verdict',
        this._select(
          ['pass', 'refer', 'fail'],
          opts.descriptor.verdict,
          (/** @type {string} */ verdict) =>
            commit(() => {
              opts.descriptor.verdict = verdict;
              opts.descriptor.wording ||= defaultWordingFor(
                /** @type {'pass'|'refer'|'fail'} */ (verdict)
              );
              opts.descriptor.rank =
                opts.descriptor.rank ??
                DEFAULT_OUTCOME_RANK[
                  /** @type {'pass'|'refer'|'fail'} */ (verdict)
                ];
            })
        )
      ),
      this._field(
        'Wording',
        this._input(opts.descriptor.wording || '', (v) =>
          commit(() => {
            opts.descriptor.wording = v;
          })
        )
      ),
      this._field(
        'Rank',
        h('input', {
          type: 'number',
          value: String(
            opts.descriptor.rank ??
              DEFAULT_OUTCOME_RANK[
                /** @type {'pass'|'refer'|'fail'} */ (opts.descriptor.verdict)
              ]
          ),
          onchange: (/** @type {any} */ e) =>
            commit(() => {
              const parsed = Number(e.target.value);
              if (Number.isFinite(parsed)) opts.descriptor.rank = parsed;
              else delete opts.descriptor.rank;
            }),
        })
      ),
      h(
        'button',
        {
          class: 'icon-btn danger',
          title: 'Remove outcome',
          onclick: () => commit(opts.onDisable),
        },
        '×'
      )
    );
  }

  /**
   * @param {string} label
   * @param {HTMLElement} control
   */
  _field(label, control) {
    return h(
      'label',
      { class: 'rem-outcome-field' },
      h('span', {}, label),
      control
    );
  }

  /**
   * @param {string[]} options
   * @param {string} value
   * @param {(value: string) => void} onChange
   */
  _select(options, value, onChange) {
    return h(
      'select',
      { onchange: (/** @type {any} */ e) => onChange(e.target.value) },
      ...options.map((option) =>
        h('option', { value: option, selected: option === value }, option)
      )
    );
  }

  /**
   * @param {string} value
   * @param {(value: string) => void} onChange
   */
  _input(value, onChange) {
    return h('input', {
      value,
      onchange: (/** @type {any} */ e) => onChange(e.target.value),
    });
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
