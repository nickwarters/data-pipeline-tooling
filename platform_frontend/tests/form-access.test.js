// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCreateForms, formAccess } from '../src/services/form-access.js';
import {
  CLOSED_FORM_STATUSES,
  FORM_OWNED_FIELDS,
  formFields,
} from '../form-types/contract.js';
import { APP_CONFIG } from '../src/app-config.js';
import { makePermissions } from './helpers/fixtures.js';

// Capability: one rule decides who may read, edit and create a Form, from the
// Form's current people and the viewer's Forms groups.

/** @typedef {import('../src/sharepoint-client.js').FormItem} FormItem */

const SAM = { loginName: 'sam', displayName: 'Sam Patel' };
const ANA = { loginName: 'ana', displayName: 'Ana Lopez' };
const JO = { loginName: 'jo', displayName: 'Jo Reid' };
const LEE = { loginName: 'lee', displayName: 'Lee Morgan' };

/** @param {Record<string, unknown>} [fields] @returns {FormItem} */
function form(fields = {}) {
  return {
    id: '1',
    etag: '"1"',
    created: null,
    modified: null,
    problems: [],
    fields: /** @type {any} */ ({
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      // The managers at completion: a record, never access.
      FirstLineManager: LEE,
      SecondLineManager: LEE,
      Status: 'Pending',
      ...fields,
    }),
  };
}

const FORMS = makePermissions({ isReviewer: false, canAccessForms: true });
const CONTROL = makePermissions({
  isReviewer: false,
  canAccessForms: true,
  isFormsControl: true,
});

/**
 * Every row of the access matrix, as the viewer and the capabilities they
 * hold. Each cell is asserted on its own, so inverting one rule fails one row.
 */
const MATRIX = [
  { who: 'the Employee', me: 'sam', caps: FORMS, read: true, edit: true },
  {
    who: 'the current first line manager',
    me: 'ana',
    caps: FORMS,
    read: true,
    edit: true,
  },
  {
    who: 'the current second line manager',
    me: 'jo',
    caps: FORMS,
    read: true,
    edit: false,
  },
  {
    who: 'a Forms control group member on nobody’s Form',
    me: 'kim',
    caps: CONTROL,
    read: true,
    edit: false,
  },
  {
    who: 'the manager at completion who is no longer current',
    me: 'lee',
    caps: FORMS,
    read: false,
    edit: false,
  },
  {
    who: 'someone with Forms access the Form does not name',
    me: 'ola',
    caps: FORMS,
    read: false,
    edit: false,
  },
];

for (const row of MATRIX) {
  test(`${row.who} ${row.read ? 'can' : 'cannot'} read an open Form`, () => {
    assert.equal(formAccess(form(), row.me, row.caps).canRead, row.read);
  });

  test(`${row.who} ${row.edit ? 'can' : 'cannot'} edit an open Form`, () => {
    assert.equal(formAccess(form(), row.me, row.caps).canEdit, row.edit);
  });

  test(`${row.who} can create a Form`, () => {
    assert.equal(canCreateForms(row.caps), true);
  });
}

test('without Forms access nobody holds a role on a Form, whatever it names', () => {
  const none = makePermissions({ isReviewer: false });
  for (const me of ['sam', 'ana', 'jo']) {
    const access = formAccess(form(), me, none);
    assert.equal(access.canRead, false, me);
    assert.equal(access.canEdit, false, me);
    assert.equal(access.role, null, me);
  }
  assert.equal(canCreateForms(none), false);
});

test('a closing Status locks the Form for every editor, the control group included', () => {
  for (const Status of CLOSED_FORM_STATUSES) {
    for (const [me, caps] of /** @type {const} */ ([
      ['sam', FORMS],
      ['ana', FORMS],
      ['sam', CONTROL],
    ])) {
      const access = formAccess(form({ Status }), me, caps);
      assert.equal(access.locked, true, `${Status} ${me}`);
      assert.equal(access.canEdit, false, `${Status} ${me}`);
      assert.equal(access.canRead, true, `${Status} ${me}`);
    }
  }
});

test('a Form with no Status yet is open', () => {
  const access = formAccess(form({ Status: null }), 'sam', FORMS);
  assert.equal(access.locked, false);
  assert.equal(access.canEdit, true);
});

test('a manager at completion regains nothing from the completion columns', () => {
  // Lee is recorded as both managers at completion and is current on nothing.
  const access = formAccess(form({ Status: 'Completed' }), 'lee', FORMS);
  assert.equal(access.canRead, false);
  assert.deepEqual(access.roles, []);
});

test('a control-group member who is the Employee edits their own Form', () => {
  const access = formAccess(form(), 'sam', CONTROL);
  assert.equal(access.canEdit, true);
  assert.deepEqual(access.roles, ['employee', 'formsControl']);
  assert.equal(access.role, 'employee');
});

test('the role shown is the most permissive the viewer holds', () => {
  const ownManager = form({ CurrentSecondLineManager: ANA });
  assert.equal(formAccess(ownManager, 'ana', FORMS).role, 'firstLineManager');
  assert.equal(formAccess(form(), 'jo', CONTROL).role, 'secondLineManager');
  assert.equal(formAccess(form(), 'kim', CONTROL).role, 'formsControl');
});

test('an account matches whatever spelling of it the directory hands back', () => {
  for (const me of ['SAM', 'corp\\sam', 'i:0#.w|corp\\Sam']) {
    assert.equal(formAccess(form(), me, FORMS).role, 'employee', me);
  }
  const claims = form({ Employee: { loginName: 'i:0#.w|corp\\SAM' } });
  assert.equal(formAccess(claims, 'sam', FORMS).role, 'employee');
});

test('an empty Person column and an unknown viewer match nobody', () => {
  const empty = form({ Employee: null, CurrentSecondLineManager: {} });
  assert.equal(formAccess(empty, 'sam', FORMS).canRead, false);
  assert.equal(formAccess(form(), '', FORMS).canRead, false);
});

for (const definition of APP_CONFIG.formTypes) {
  const fields = formFields(definition);

  test(`${definition.formName}: an employee-only field is editable by the Employee alone`, () => {
    for (const field of fields.filter((f) => f.editableBy === 'employee')) {
      assert.equal(formAccess(form(), 'sam', FORMS).canEditField(field), true);
      assert.equal(formAccess(form(), 'ana', FORMS).canEditField(field), false);
    }
  });

  test(`${definition.formName}: a manager-only field is editable by the current first line manager alone`, () => {
    for (const field of fields.filter((f) => f.editableBy === 'manager')) {
      assert.equal(formAccess(form(), 'ana', FORMS).canEditField(field), true);
      assert.equal(formAccess(form(), 'sam', FORMS).canEditField(field), false);
    }
  });

  test(`${definition.formName}: every other field is editable by both editors and nobody else`, () => {
    const shared = fields.filter(
      (f) =>
        f.editableBy === undefined &&
        !['Employee', 'DueDate'].includes(f.itemField)
    );
    assert.ok(shared.length > 0);
    for (const field of shared) {
      for (const me of ['sam', 'ana']) {
        assert.equal(
          formAccess(form(), me, FORMS).canEditField(field),
          true,
          `${me} ${field.itemField}`
        );
      }
      assert.equal(formAccess(form(), 'jo', FORMS).canEditField(field), false);
      assert.equal(
        formAccess(form(), 'kim', CONTROL).canEditField(field),
        false
      );
    }
  });

  test(`${definition.formName}: no field is editable once the Form is locked`, () => {
    for (const field of fields) {
      for (const me of ['sam', 'ana']) {
        assert.equal(
          formAccess(form({ Status: 'Completed' }), me, FORMS).canEditField(
            field
          ),
          false,
          `${me} ${field.itemField}`
        );
      }
    }
  });
}

test('the application’s own columns are never editable, even by an editor', () => {
  for (const itemField of Object.keys(FORM_OWNED_FIELDS)) {
    for (const me of ['sam', 'ana']) {
      assert.equal(
        formAccess(form(), me, FORMS).canEditField({ itemField }),
        false,
        `${me} ${itemField}`
      );
    }
  }
});
