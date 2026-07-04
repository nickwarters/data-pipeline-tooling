// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  commit,
  currentBank,
} from '../../question-bank/question-bank-store.js';
import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/**
 * @param {{ question: any, outcomeOptions: import('../../sharepoint-client.js').OutcomeOption[], ensureActionObjects: (q: any) => void, nextActionId: (q: any) => string }} props
 * @returns {HTMLElement | undefined}
 */
export function RemediationEditor(props) {
  const q = props.question;
  if (!q) return;

  const count = (q.remediationActions || []).length;

  const freeRow = h(
    'div',
    { class: 'rem-free-row' },
    h(
      'div',
      {},
      h('div', { className: 'rem-free-title' }, 'Allow free-form remediation'),
      h(
        'div',
        { className: 'rem-free-help' },
        'Reviewers can write their own remediation alongside any canned actions.'
      )
    ),
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
    h(
      'h4',
      {},
      'Remediation Actions ',
      h(
        'span',
        { className: 'rem-count' },
        `(${count}${q.allowFreeFormRemediation ? ' + free-form' : ''})`
      )
    ),
    freeRow
  );

  if (q.failureCriteria) {
    wrap.appendChild(renderNoActionOutcome(q, props.outcomeOptions));
  }

  if (q.allowFreeFormRemediation) {
    wrap.appendChild(
      h(
        'div',
        { class: 'rem-free-preview' },
        h(
          'div',
          { className: 'rem-free-preview-eyebrow' },
          'Reviewer will see'
        ),
        h(
          'div',
          { className: 'rem-free-preview-body' },
          '"Describe a remediation in your own words…"'
        )
      )
    );
  }

  normaliseConfiguredActions(q.remediationActions || [], q.id).forEach(
    (/** @type {any} */ action, /** @type {number} */ idx) => {
      const inp = /** @type {any} */ (
        h('input', {
          value: action.text,
          onchange: (/** @type {any} */ e) =>
            commit(() => {
              props.ensureActionObjects(q);
              q.remediationActions[idx].text = e.target.value;
            }),
        })
      );
      wrap.appendChild(
        h(
          'div',
          { class: 'rem-item' },
          inp,
          renderActionOutcome(q, action, idx, props.outcomeOptions, () =>
            props.ensureActionObjects(q)
          ),
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
              id: props.nextActionId(q),
              text: 'New action',
            });
          }),
      },
      '+ canned action'
    )
  );

  return wrap;
}

export class CORARemediationEditor extends ShellElement {
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
    return RemediationEditor({
      question: this.question,
      outcomeOptions: currentBank.get()?.outcomeOptions ?? [],
      ensureActionObjects: (q) => this._ensureActionObjects(q),
      nextActionId: (q) => this._nextActionId(q),
    });
  }

  /** @param {any} q */
  _renderNoActionOutcome(q) {
    return renderNoActionOutcome(q, currentBank.get()?.outcomeOptions ?? []);
  }

  /**
   * @param {any} q
   * @param {any} action
   * @param {number} idx
   */
  _renderActionOutcome(q, action, idx) {
    return renderActionOutcome(
      q,
      action,
      idx,
      currentBank.get()?.outcomeOptions ?? [],
      () => this._ensureActionObjects(q)
    );
  }

  /**
   * @param {string} value
   * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
   * @param {(id: string) => void} onChange
   */
  _outcomeSelect(value, outcomeOptions, onChange) {
    return outcomeSelect(value, outcomeOptions, onChange);
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

/** @param {any} q @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions */
export function renderNoActionOutcome(q, outcomeOptions) {
  return h(
    'div',
    { class: 'rem-outcome-block' },
    h('h5', {}, 'Default outcome when no action is selected'),
    outcomeSelect(q.outcome?.noActionOutcomeId ?? '', outcomeOptions, (id) =>
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

/** @param {any} q @param {any} action @param {number} idx @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions @param {() => void} ensureActionObjects */
export function renderActionOutcome(
  q,
  action,
  idx,
  outcomeOptions,
  ensureActionObjects
) {
  return h(
    'div',
    { class: 'rem-action-outcome' },
    outcomeSelect(action.outcomeId ?? '', outcomeOptions, (id) =>
      commit(() => {
        ensureActionObjects();
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
 * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
 * @param {(id: string) => void} onChange
 */
export function outcomeSelect(value, outcomeOptions, onChange) {
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
      h('option', { value: option.id }, option.wording)
    )
  );
}

customElements.define('cora-remediation-editor', CORARemediationEditor);
