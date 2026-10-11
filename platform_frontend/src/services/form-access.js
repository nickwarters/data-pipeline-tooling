// @ts-check
/**
 * Who may read, edit and create HR Forms. The one place the rule lives: every
 * Forms view asks this module and none re-derives it.
 *
 * This is a JavaScript gate, not a permission boundary. Every member of a Form
 * list's access group can read every row through REST; what this module
 * decides is what the application shows and lets a person change.
 *
 * Access reads only the application's own people columns, `Employee`,
 * `CurrentFirstLineManager` and `CurrentSecondLineManager`. `FirstLineManager`
 * and `SecondLineManager` are a record of who the managers were when the Form
 * was completed and grant nothing, so a manager who has moved on stops seeing
 * the Form the moment the current columns stop naming them.
 *
 * | Who                       | Read      | Edit while open | Create |
 * | ------------------------- | --------- | --------------- | ------ |
 * | Employee                  | yes       | yes             | yes    |
 * | Current first line mgr    | yes       | yes             | yes    |
 * | Current second line mgr   | yes       | no              | yes    |
 * | Forms control group       | every one | no              | yes    |
 * | Manager at completion     | no        | no              |        |
 *
 * A person holding several roles on one Form gets the most permissive, so a
 * control-group member edits their own Form as its Employee. Without Forms
 * access a person holds no role on any Form, whatever its columns say.
 */

import {
  CLOSED_FORM_STATUSES,
  FORM_OWNED_FIELDS,
} from '../../form-types/contract.js';
import { toBareAccount } from './account-name.js';

/** @typedef {import('./permissions.js').Capabilities} Capabilities */
/** @typedef {import('../sharepoint-client.js').FormItem} FormItem */
/** @typedef {import('../../form-types/contract.js').FormField} FormField */

/**
 * The roles a person can hold on one Form, most permissive first. The order is
 * what `role` picks from when a person holds several.
 *
 * @typedef {'employee' | 'firstLineManager' | 'secondLineManager' | 'formsControl'} FormRole
 */

/** @type {readonly FormRole[]} */
const ROLE_ORDER = Object.freeze([
  'employee',
  'firstLineManager',
  'secondLineManager',
  'formsControl',
]);

/** The roles that may edit an open Form. */
const EDITORS = new Set(['employee', 'firstLineManager']);

/**
 * What one person may do with one Form.
 *
 * - `role`: the most permissive role they hold, for a "Your role" column, or
 *   `null` when they hold none.
 * - `locked`: the Form is Completed, Void or Cancelled, and nobody edits it.
 * - `canEdit`: they may change the Form at all, and press the buttons that
 *   complete, void or cancel it.
 * - `canEditField(field)`: they may change that one field.
 *
 * @typedef {{
 * roles: FormRole[],
 * role: FormRole | null,
 * canRead: boolean,
 * locked: boolean,
 * canEdit: boolean,
 * canEditField: (field: Pick<FormField, 'itemField' | 'editableBy'>) => boolean
 * }} FormAccess
 */

/**
 * @param {FormItem} form
 * @param {string} me the viewer's account, in any spelling the directory uses
 * @param {Capabilities} caps
 * @returns {FormAccess}
 */
export function formAccess(form, me, caps) {
  const roles = rolesOn(form, me, caps);
  const locked = isLocked(form);
  const isEditor = roles.some((role) => EDITORS.has(role));
  const canEdit = isEditor && !locked;
  return {
    roles,
    role: roles[0] ?? null,
    canRead: roles.length > 0,
    locked,
    canEdit,
    canEditField(field) {
      if (!canEdit) return false;
      // Nobody edits the application's own columns after creation, bar the
      // title: the current managers are kept by a process outside the app,
      // and Status moves only through the lifecycle buttons.
      const owned = FORM_OWNED_FIELDS[field.itemField];
      if (owned) return owned.editableWhileOpen === true;
      if (field.editableBy === 'employee') return roles.includes('employee');
      if (field.editableBy === 'manager') {
        return roles.includes('firstLineManager');
      }
      return true;
    },
  };
}

/**
 * Whether a person may edit a Form while it is open, by the roles its people
 * columns give them alone. The page uses it to say what a current manager may
 * do, so it shows the rule above rather than restating it.
 *
 * @param {FormItem} form
 * @param {string} account
 * @returns {boolean}
 */
export function editsWhileOpen(form, account) {
  const roles = rolesOn(form, account, {
    canAccessForms: true,
    isFormsControl: false,
  });
  return roles.some((role) => EDITORS.has(role));
}

/**
 * Whether a Person value names the account, compared as the access rule
 * compares them.
 *
 * @param {unknown} value
 * @param {string} account
 * @returns {boolean}
 */
export function namesAccount(value, account) {
  return sameAccount(account)(value);
}

/**
 * Whether a person may start a new Form. Everyone the matrix names may, so it
 * is the Forms area itself that decides.
 *
 * @param {Capabilities} caps
 * @returns {boolean}
 */
export function canCreateForms(caps) {
  return caps.canAccessForms;
}

/**
 * @param {FormItem} form
 * @param {string} me
 * @param {Pick<Capabilities, 'canAccessForms' | 'isFormsControl'>} caps
 * @returns {FormRole[]}
 */
function rolesOn(form, me, caps) {
  if (!caps.canAccessForms) return [];
  const account = sameAccount(me);
  /** @type {Set<FormRole>} */
  const held = new Set();
  if (account(form.fields.Employee)) held.add('employee');
  if (account(form.fields.CurrentFirstLineManager)) {
    held.add('firstLineManager');
  }
  if (account(form.fields.CurrentSecondLineManager)) {
    held.add('secondLineManager');
  }
  if (caps.isFormsControl) held.add('formsControl');
  return ROLE_ORDER.filter((role) => held.has(role));
}

/**
 * A test for "this Person column holds me". Accounts are compared bare and
 * without regard to case, because a directory login is case-insensitive and
 * the same person arrives as `i:0#.w|corp\Sam`, `corp\sam` or `sam`.
 *
 * @param {string} me
 * @returns {(value: unknown) => boolean}
 */
function sameAccount(me) {
  const mine = toBareAccount(me).toLowerCase();
  return (value) => {
    if (mine === '') return false;
    const login = /** @type {{ loginName?: unknown } | null} */ (value)
      ?.loginName;
    return (
      typeof login === 'string' && toBareAccount(login).toLowerCase() === mine
    );
  };
}

/** @param {FormItem} form */
function isLocked(form) {
  return CLOSED_FORM_STATUSES.includes(String(form.fields.Status ?? ''));
}
