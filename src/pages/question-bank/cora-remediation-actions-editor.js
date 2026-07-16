// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/**
 * Bank-editor widget: edits the **Remediation Actions** attached to a Question
 * Definition. Not to be confused with the case-review remediation section
 * (`components/sections/cora-remediation-section.js`). Actions attach to
 * the question and are surfaced against failed Answers, but they do **not** drive
 * the Outcome — the response does (question bank redesign) — so there is no
 * per-action or no-action Outcome selector here.
 *
 * Mutations flow up through `onCommit` (the mounting page passes the bank
 * editor's `commit`); this component has no store dependency.
 *
 * @param {{ question: any, onCommit: (fn: () => void) => void, ensureActionObjects: (q: any) => void, nextActionId: (q: any) => string }} props
 * @returns {HTMLElement | undefined}
 */
export function RemediationActionsEditor(props) {
  const commit = props.onCommit;
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
    h('button', {
      class: 'toggle' + (q.allowFreeFormRemediation ? ' on' : ''),
      role: 'switch',
      'aria-checked': String(Boolean(q.allowFreeFormRemediation)),
      'aria-label': 'Allow free-form remediation',
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
          'aria-label': `Remediation action ${idx + 1}`,
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
          h(
            'button',
            {
              class: 'x',
              'aria-label': `Remove remediation action ${idx + 1}`,
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
      EmptyState('// no remediations — reviewers will see none on failure', {
        tag: 'div',
        className: 'rem-empty',
      })
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

export class CORARemediationActionsEditor extends ShellElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
    /**
     * Mutation sink. Defaults to "just apply the mutation" so the component
     * works standalone; the bank editor injects the store's `commit()` to add
     * re-render broadcast and focus preservation.
     * @type {(fn: () => void) => void}
     */
    this.onCommit = (fn) => fn();
  }

  render() {
    return RemediationActionsEditor({
      question: this.question,
      onCommit: this.onCommit,
      ensureActionObjects: (q) => this._ensureActionObjects(q),
      nextActionId: (q) => this._nextActionId(q),
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

customElements.define(
  'cora-remediation-actions-editor',
  CORARemediationActionsEditor
);
