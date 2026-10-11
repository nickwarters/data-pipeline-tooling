// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
  queryByRole,
} from './helpers/semantic-dom.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { formsClient, mountFormRoute } = await import('./helpers/form-page.js');
const { oneToOne } = await import('../form-types/one-to-one.js');
const { makeChrome, makePermissions } = await import('./helpers/fixtures.js');

// Capability: New form asks only who a Form is for, fills the managers in from
// the directory, says who will see it, and creates it with both manager pairs
// before opening it.

/**
 * Pick someone in one of New form's people pickers.
 *
 * @param {any} t the test context, whose timers are mocked
 * @param {any} page
 * @param {string} label
 * @param {string} query
 * @param {RegExp} match
 */
async function pick(t, page, label, query, match) {
  fireEvent(
    getByRole(page.render(), 'combobox', {
      name: `Search people for ${label}`,
    }),
    'input',
    { target: { value: query } }
  );
  t.mock.timers.tick(200);
  await page.until((/** @type {any} */ route) =>
    Object.values(route.peopleSearch).some(
      (search) => /** @type {any} */ (search).status === 'success'
    )
  );
  fireEvent(getByRole(page.render(), 'option', { name: match }), 'click');
}

/** Choose Sam Patel and wait for their managers to be filled in. */
async function chooseSam(/** @type {any} */ t, /** @type {any} */ page) {
  await pick(t, page, 'Employee', 'sam', /Sam Patel/);
  await page.until(
    (/** @type {any} */ route) => route.people.secondLineManager !== null
  );
}

/**
 * Press Create and wait for the write to answer. The page opens the new Form
 * in its own handler for that answer, which runs before this one.
 *
 * @param {any} page
 */
async function create(page) {
  const create = page.client.createFormItem.bind(page.client);
  /** @type {Promise<any> | null} */
  let written = null;
  page.client.createFormItem = (/** @type {any[]} */ ...args) =>
    (written = create(...args));
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Create 1-to-1' }),
    'click'
  );
  return /** @type {any} */ (await written);
}

/** @param {any} page @param {string} dueDate */
function setDueDate(page, dueDate) {
  fireEvent(
    getByRole(page.render(), 'textbox', { name: 'Due date' }),
    'change',
    { target: { value: dueDate } }
  );
}

test('choosing the Employee fills in both managers from the directory, saying where from', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mountFormRoute('forms-control');
  await chooseSam(t, page);
  const view = page.render();
  assert.match(view.textContent ?? '', /First line manager\s*Ana Lopez/);
  assert.match(view.textContent ?? '', /Filled in from Sam Patel’s profile/);
  assert.match(view.textContent ?? '', /Second line manager\s*Jo Reid/);
  assert.match(view.textContent ?? '', /Filled in from Ana Lopez’s profile/);
  page.leave();
});

test('creating writes the chosen managers as both the current managers and the record, then opens the Form', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mountFormRoute('forms-control');
  await chooseSam(t, page);
  setDueDate(page, '2026-10-31');
  const item = await create(page);
  assert.equal(location.hash, `#/forms/one-to-one/${item.id}`);

  const created = await page.client.getFormItem(oneToOne, item.id);
  assert.ok(created);
  const name = (/** @type {string} */ column) =>
    /** @type {any} */ (created.fields[column])?.displayName ?? null;
  assert.deepEqual(
    [
      'Employee',
      'CurrentFirstLineManager',
      'FirstLineManager',
      'CurrentSecondLineManager',
      'SecondLineManager',
    ].map(name),
    ['Sam Patel', 'Ana Lopez', 'Ana Lopez', 'Jo Reid', 'Jo Reid']
  );
  assert.equal(created.fields.Status, 'Pending');
  assert.equal(created.fields.DueDate, '2026-10-31');
  page.leave();
});

test('a title typed at creation is written with the Form, trimmed, and none is written when left blank', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [typed, stored] of [
    ['  Return to work after leave ', 'Return to work after leave'],
    ['   ', undefined],
  ]) {
    const page = mountFormRoute('forms-control');
    await chooseSam(t, page);
    setDueDate(page, '2026-10-31');
    fireEvent(
      getByRole(page.render(), 'textbox', { name: 'Title (optional)' }),
      'input',
      { target: { value: typed } }
    );
    const item = await create(page);
    const created = await page.client.getFormItem(oneToOne, item.id);
    assert.equal(created?.fields.FormTitle || undefined, stored, typed);
    page.leave();
  }
});

test('a filled-in manager can be changed before creating, and the change is what is written', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mountFormRoute('forms-employee');
  await chooseSam(t, page);
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Clear First line manager' }),
    'click'
  );
  await pick(t, page, 'First line manager', 'lee', /Lee Morgan/);
  assert.doesNotMatch(
    page.render().textContent ?? '',
    /Filled in from Sam Patel’s profile/
  );
  setDueDate(page, '2026-11-15');
  const item = await create(page);
  const created = /** @type {any} */ (
    await page.client.getFormItem(oneToOne, item.id)
  );
  assert.equal(created.fields.FirstLineManager.displayName, 'Lee Morgan');
  assert.equal(
    created.fields.CurrentFirstLineManager.displayName,
    'Lee Morgan'
  );
  page.leave();
});

test('the Form cannot be created until it has an Employee, a first line manager and a due date', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mountFormRoute('forms-employee');
  const create = () =>
    getByRole(page.render(), 'button', { name: 'Create 1-to-1' });
  assert.equal(create().disabled, true);
  page.client.createFormItem = async () => {
    throw new Error('a Form that is not ready must never be written');
  };
  fireEvent(create(), 'click');
  assert.equal(page.route.creating, false);
  await chooseSam(t, page);
  assert.equal(create().disabled, true);
  setDueDate(page, '2026-10-31');
  assert.equal(create().disabled, false);
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Clear First line manager' }),
    'click'
  );
  assert.equal(create().disabled, true);
  page.leave();
});

test('the creator is told who will be able to see the Form', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mountFormRoute('forms-control');
  assert.match(
    page.render().textContent ?? '',
    /Only the employee, their current managers and the Forms control group will be able to see this form\./
  );
  await chooseSam(t, page);
  assert.match(
    page.render().textContent ?? '',
    /Only Sam Patel, Ana Lopez, Jo Reid and the Forms control group will be able to see this form\./
  );
  page.leave();
});

test('a directory that cannot answer leaves the managers for the creator to choose', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = formsClient();
  client.resolveManagers = async () => {
    throw new Error('503');
  };
  const page = mountFormRoute('forms-control', { client });
  await pick(t, page, 'Employee', 'sam', /Sam Patel/);
  await page.until(() =>
    page.actions.some((action) => action.type === 'new-form/managers-found')
  );
  assert.ok(
    getByRole(page.render(), 'combobox', {
      name: 'Search people for First line manager',
    })
  );
  page.leave();
});

test('an Employee with no manager in the directory leaves both managers empty', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mountFormRoute('forms-control');
  await pick(t, page, 'Employee', 'kim', /Kim Shaw/);
  await page.until(() =>
    page.actions.some((action) => action.type === 'new-form/managers-found')
  );
  assert.equal(page.route.people.firstLineManager, null);
  assert.equal(page.route.people.secondLineManager, null);
  page.leave();
});

test('a lookup for an Employee since replaced does not fill in their managers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = formsClient();
  const resolve = client.resolveManagers.bind(client);
  /** @type {() => void} */
  let releaseSam = () => {};
  // Sam's lookup is held until Ana's has answered.
  client.resolveManagers = (/** @type {string[]} */ accounts) =>
    accounts[0] === 'user-forms-employee'
      ? new Promise((answer) => (releaseSam = () => answer(resolve(accounts))))
      : resolve(accounts);
  const page = mountFormRoute('forms-control', { client });
  await pick(t, page, 'Employee', 'sam', /Sam Patel/);
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Clear Employee' }),
    'click'
  );
  await pick(t, page, 'Employee', 'ana', /Ana Lopez/);
  await page.until(
    (route) => route.people.firstLineManager?.displayName === 'Jo Reid'
  );
  releaseSam();
  await page.until(
    () =>
      page.actions.filter((action) => action.type === 'new-form/managers-found')
        .length === 2
  );
  assert.equal(page.route.people.employee.displayName, 'Ana Lopez');
  assert.equal(page.route.people.firstLineManager.displayName, 'Jo Reid');
  // Ana's manager has none, so Sam's second line manager would show through.
  assert.equal(page.route.people.secondLineManager, null);
  page.leave();
});

test('a failed create says so and lets the creator try again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = formsClient();
  client.createFormItem = async () => {
    throw new Error('503');
  };
  const page = mountFormRoute('forms-control', { client });
  await chooseSam(t, page);
  setDueDate(page, '2026-10-31');
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Create 1-to-1' }),
    'click'
  );
  await page.until((route) => route.error !== null);
  assert.match(
    getByRole(page.render(), 'alert').textContent ?? '',
    /could not be created/
  );
  assert.equal(
    getByRole(page.render(), 'button', { name: 'Create 1-to-1' }).disabled,
    false
  );
  page.leave();
});

test('each Form Type can be chosen, and the button names the one chosen', () => {
  const coaching = { ...oneToOne, slug: 'coaching', formName: 'Coaching' };
  const page = mountFormRoute('forms-employee', {
    formTypes: [oneToOne, coaching],
  });
  const radios = queryAllByRole(page.render(), 'radio');
  assert.deepEqual(
    radios.map((radio) => radio.checked),
    [true, false]
  );
  fireEvent(getByRole(page.render(), 'radio', { name: 'Coaching' }), 'change');
  assert.ok(getByRole(page.render(), 'button', { name: 'Create Coaching' }));
  page.leave();
});

test('Cancel goes back to the Forms dashboard', () => {
  const page = mountFormRoute('forms-employee');
  fireEvent(getByRole(page.render(), 'button', { name: 'Cancel' }), 'click');
  assert.equal(location.hash, '#/forms');
  page.leave();
});

test('with no Form Types, or no right to create one, there is nothing to start', () => {
  const none = mountFormRoute('forms-employee', { formTypes: [] });
  assert.match(
    none.render().textContent ?? '',
    /There are no forms to start yet\./
  );
  const refused = mountFormRoute('forms-employee', {
    chrome: makeChrome({
      currentUser: { id: 'user-x', displayName: 'X' },
      permissions: makePermissions({ canAccessForms: false }),
    }),
  });
  assert.match(refused.render().textContent ?? '', /You can’t start a form\./);
  assert.equal(
    queryByRole(refused.render(), 'button', { name: 'Create 1-to-1' }),
    null
  );
});

test('a manager the directory cannot name is shown by their account', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = formsClient();
  client.resolveUsers = async () => ({});
  const page = mountFormRoute('forms-control', { client });
  await chooseSam(t, page);
  assert.equal(
    page.route.people.firstLineManager.displayName,
    'user-forms-flm'
  );
});

test('the button says the Form is being created until the write answers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mountFormRoute('forms-control');
  await chooseSam(t, page);
  setDueDate(page, '2026-10-31');
  const item = await create(page);
  assert.ok(item);
  // The page has moved on to the new Form by now; what it drew while waiting
  // is what the creator saw.
  assert.equal(page.route.creating, true);
  assert.ok(getByRole(page.render(), 'button', { name: 'Creating…' }));
});

test('an action meant for another page leaves New form as it was', () => {
  const page = mountFormRoute('forms-employee');
  const before = page.state;
  page.dispatch({ type: 'form/loaded', item: null });
  assert.equal(page.state, before);
  page.leave();
});

test('with no Form Types configured there is nothing to start', () => {
  const page = mountFormRoute('forms-employee', { formTypes: null });
  assert.match(
    page.render().textContent ?? '',
    /There are no forms to start yet\./
  );
  page.leave();
});
