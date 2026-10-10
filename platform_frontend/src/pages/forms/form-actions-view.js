// @ts-check
/**
 * The Form Actions editor every Form Type shares. It holds nothing of its own:
 * every change hands back the whole list, because a Form's Actions are one
 * column and are saved as one value.
 */

import { h } from '../../lib/html.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';
import {
  FORM_ACTION_STATUSES,
  INITIAL_FORM_ACTION_STATUS,
  MAX_FORM_ACTIONS,
} from '../../../form-types/contract.js';

/** @typedef {import('../../sharepoint-client.js').FormAction} FormAction */

/**
 * @typedef {Object} FormActionsEditing
 * @property {number | null} removing The Action whose removal awaits a yes.
 * @property {(actions: FormAction[]) => void} onChange The whole new list.
 * @property {(index: number) => void} onRemoveAsked
 * @property {() => void} onRemoveWithdrawn
 */

/** @type {ReadonlyArray<{ key: keyof FormAction, label: string, type: string }>} */
const ACTION_FIELDS = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'dueDate', label: 'Due date', type: 'date' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'details', label: 'Details', type: 'textarea' },
];

/**
 * The editable Actions of an open Form, then the way to add another while
 * there is room for one.
 *
 * @param {string} id A prefix that keeps this section's ids unique on the page.
 * @param {readonly FormAction[]} actions
 * @param {FormActionsEditing} editing
 * @returns {Node[]}
 */
export function formActionsEditor(id, actions, editing) {
  const left = MAX_FORM_ACTIONS - actions.length;
  return [
    ...actions.map((action, index) =>
      actionCard(`${id}-${index}`, actions, index, editing)
    ),
    h(
      'div',
      { className: 'cora-form-action-add' },
      h(
        'button',
        {
          type: 'button',
          className: 'cora-btn-secondary',
          disabled: left <= 0,
          'aria-describedby': `${id}-left`,
          onclick: () =>
            editing.onChange([
              ...actions,
              {
                title: '',
                dueDate: '',
                status: INITIAL_FORM_ACTION_STATUS,
                details: '',
              },
            ]),
        },
        '+ Add action'
      ),
      h(
        'span',
        { className: 'cora-form-action-left', id: `${id}-left` },
        `${Math.max(left, 0)} of ${MAX_FORM_ACTIONS} left`
      )
    ),
  ];
}

/**
 * @param {string} id
 * @param {readonly FormAction[]} actions
 * @param {number} index
 * @param {FormActionsEditing} editing
 */
function actionCard(id, actions, index, editing) {
  const action = actions[index];
  const number = index + 1;
  const without = () => actions.filter((_, at) => at !== index);
  return h(
    'div',
    {
      className: 'cora-form-action-card cora-form-action-card--edit',
      role: 'group',
      'aria-labelledby': `${id}-heading`,
    },
    h(
      'div',
      { className: 'cora-form-action-head' },
      h('h3', { id: `${id}-heading` }, `Action ${number}`),
      h(
        'button',
        {
          type: 'button',
          className: 'cora-btn-secondary cora-form-action-remove',
          'aria-label': `Remove action ${number}`,
          // Only an Action someone has written in asks first; an empty one
          // has nothing to lose.
          onclick: () =>
            hasContent(action)
              ? editing.onRemoveAsked(index)
              : editing.onChange(without()),
        },
        'Remove'
      )
    ),
    h(
      'div',
      { className: 'cora-form-action-fields' },
      ...ACTION_FIELDS.map((field) =>
        h(
          'label',
          {
            className: `cora-form-control-group cora-form-action-${field.key}`,
          },
          h('span', { className: 'cora-form-label' }, field.label),
          buildCaptureControl(
            {
              key: field.key,
              label: field.label,
              type: /** @type {any} */ (field.type),
              options:
                field.key === 'status' ? statusChoices(action) : undefined,
            },
            action[field.key],
            (value) =>
              editing.onChange(
                actions.map((each, at) =>
                  at === index ? { ...each, [field.key]: value } : each
                )
              )
          )
        )
      )
    ),
    editing.removing === index
      ? h(
          'div',
          {
            className: 'cora-form-confirm',
            role: 'group',
            'aria-label': 'Confirm',
          },
          h(
            'p',
            {},
            h('strong', {}, `Remove action ${number}?`),
            ' What it says will be lost.'
          ),
          h(
            'div',
            { className: 'cora-form-footer-buttons' },
            h(
              'button',
              {
                type: 'button',
                className: 'cora-btn-secondary',
                onclick: () => editing.onRemoveWithdrawn(),
              },
              'Keep action'
            ),
            h(
              'button',
              { type: 'button', onclick: () => editing.onChange(without()) },
              'Yes, remove'
            )
          )
        )
      : null
  );
}

/**
 * The Statuses an Action may be set to. One stored outside them, from a list
 * edited by hand, is offered too, so opening the Form does not change it.
 *
 * @param {FormAction} action
 * @returns {string[]}
 */
function statusChoices(action) {
  return FORM_ACTION_STATUSES.includes(action.status) || !action.status
    ? [...FORM_ACTION_STATUSES]
    : [...FORM_ACTION_STATUSES, action.status];
}

/** @param {FormAction} action */
function hasContent(action) {
  return [action.title, action.dueDate, action.details].some(
    (value) => value.trim() !== ''
  );
}
