// @ts-check
import { h } from '../../lib/html.js';
import {
  ACCESS_ROLES,
  describeChange,
  grantNote,
  planGrant,
  planRevoke,
} from '../../services/access-roles.js';

/** @typedef {import('../../services/access-roles.js').RoleRef} RoleRef */
/** @typedef {import('../../services/access-roles.js').CaseTypeRef} CaseTypeRef */

/**
 * The open change form; `fixed` means it was opened from a held role (Remove or Complete), so the role cannot be re-chosen.
 *
 * @typedef {{
 *   action: 'grant' | 'revoke',
 *   role: string,
 *   caseType: string,
 *   fixed: boolean,
 *   reason: string,
 *   saving: boolean,
 *   error: string | null,
 * }} ChangeForm
 */

/** @type {ChangeForm} */
export const EMPTY_CHANGE_FORM = Object.freeze({
  action: 'grant',
  role: '',
  caseType: '',
  fixed: false,
  reason: '',
  saving: false,
  error: null,
});

/**
 * The role the form names, or `null` until a role and, where it needs one, a Case Type are chosen.
 *
 * @param {ChangeForm} form
 * @returns {RoleRef | null}
 */
export function formRole(form) {
  const spec = ACCESS_ROLES.find((role) => role.id === form.role);
  if (!spec) return null;
  if (!spec.perCaseType) return { id: spec.id, caseType: null };
  if (form.caseType !== '') return { id: spec.id, caseType: form.caseType };
  // A held Reviewer with no Case Type is removed from a fixed form that names none.
  return form.fixed ? { id: spec.id, caseType: null } : null;
}

/**
 * Why the form's change cannot be made, or `null` when it can.
 *
 * @param {ChangeForm} form
 * @param {readonly string[]} groups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {string | null}
 */
function blockedReason(form, groups, caseTypes) {
  const role = formRole(form);
  if (!role) return null;
  return (
    form.action === 'grant'
      ? planGrant(role, groups, caseTypes)
      : planRevoke(role, groups, caseTypes)
  ).refusal;
}

/**
 * @param {ChangeForm} form
 * @param {readonly string[]} groups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {boolean} whether the form names a role, a reason, and a change that can be made
 */
export function formIsReady(form, groups, caseTypes) {
  return (
    formRole(form) !== null &&
    form.reason.trim() !== '' &&
    blockedReason(form, groups, caseTypes) === null
  );
}

/**
 * @param {string} label
 * @param {string} value
 * @param {Array<{ value: string, text: string }>} options
 * @param {(value: string) => void} onChange
 * @returns {HTMLElement}
 */
function selectField(label, value, options, onChange) {
  return h(
    'label',
    { className: 'cora-access-field' },
    h('span', {}, label),
    h(
      'select',
      {
        className: 'cora-access-input',
        value,
        onchange: (/** @type {any} */ ev) => onChange(ev.target.value),
      },
      ...options.map((option) =>
        h('option', { value: option.value }, option.text)
      )
    )
  );
}

/**
 * The form that gives a role, or takes one away, with a reason that is always required.
 *
 * @param {ChangeForm} form
 * @param {{ personName: string, groups: readonly string[], caseTypes: readonly CaseTypeRef[] }} subject
 * @param {{
 *   onRole: (role: string) => void,
 *   onCaseType: (caseType: string) => void,
 *   onReason: (reason: string) => void,
 *   onSubmit: () => void,
 *   onCancel: () => void,
 * }} handlers
 * @returns {HTMLElement}
 */
export function changeFormView(
  form,
  { personName, groups, caseTypes },
  handlers
) {
  const role = formRole(form);
  const spec = ACCESS_ROLES.find((candidate) => candidate.id === form.role);
  const sentence = role
    ? describeChange(form.action, role, personName, caseTypes).imperative
    : null;
  const blocked = blockedReason(form, groups, caseTypes);
  const note =
    role && form.action === 'grant' ? grantNote(role, caseTypes) : null;
  const ready = formIsReady(form, groups, caseTypes) && !form.saving;
  // A fixed form already says what it does in its heading, so its button stays short.
  const submitLabel =
    !form.fixed && sentence
      ? sentence
      : form.action === 'grant'
        ? 'Give access'
        : 'Remove access';
  return h(
    'section',
    {
      className: 'cora-access-form',
      'aria-labelledby': 'cora-access-form-title',
    },
    h(
      'h2',
      { id: 'cora-access-form-title' },
      form.fixed && sentence ? sentence : `Give ${personName} access`
    ),
    !form.fixed &&
      selectField(
        'Role',
        form.role,
        [
          { value: '', text: 'Choose a role' },
          ...ACCESS_ROLES.map(({ id, label }) => ({ value: id, text: label })),
        ],
        handlers.onRole
      ),
    !form.fixed &&
      spec?.perCaseType === true &&
      selectField(
        'Case Type',
        form.caseType,
        [
          { value: '', text: 'Choose a Case Type' },
          ...caseTypes.map(({ slug, displayName }) => ({
            value: slug,
            text: displayName,
          })),
        ],
        handlers.onCaseType
      ),
    note && h('p', { className: 'cora-access-note' }, note),
    blocked && h('p', { className: 'cora-access-blocked' }, blocked),
    h(
      'label',
      { className: 'cora-access-field' },
      h('span', {}, 'Reason'),
      h('textarea', {
        className: 'cora-access-reason',
        value: form.reason,
        disabled: form.saving,
        oninput: (/** @type {any} */ ev) => handlers.onReason(ev.target.value),
      })
    ),
    form.error &&
      h('p', { className: 'cora-access-error', role: 'alert' }, form.error),
    h(
      'div',
      { className: 'cora-access-form-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'cora-access-submit',
          disabled: !ready,
          onclick: () => handlers.onSubmit(),
        },
        form.saving ? 'Saving…' : submitLabel
      ),
      form.fixed &&
        h(
          'button',
          {
            type: 'button',
            className: 'cora-btn-secondary cora-access-cancel',
            disabled: form.saving,
            onclick: () => handlers.onCancel(),
          },
          'Cancel'
        )
    )
  );
}
