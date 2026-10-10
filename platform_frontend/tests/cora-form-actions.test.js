// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
  queryAllByTag,
  queryByRole,
} from './helpers/semantic-dom.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { formsClient, openForm } = await import('./helpers/form-page.js');
const { oneToOne } = await import('../form-types/one-to-one.js');
const { FORM_ACTION_STATUSES, MAX_FORM_ACTIONS } =
  await import('../form-types/contract.js');
const { encodeText } = await import('../src/services/form-encoding.js');
const { formLists } = await import('../dev/fixtures/forms.js');

// Capability: every Form Type shares one Actions editor. Its editors add up to
// the framework's cap, change and remove Form Actions, and each change saves
// the whole list as the one value it is stored as; everyone else reads them.

/** The editor's card for one Form Action, by its number. */
function card(/** @type {HTMLElement} */ view, /** @type {number} */ number) {
  return getByRole(view, 'group', { name: `Action ${number}` });
}

/**
 * Record every write the page makes, by the columns it names.
 *
 * @param {any} page
 * @returns {Array<Record<string, any>>}
 */
function recordWrites(page) {
  /** @type {Array<Record<string, any>>} */
  const writes = [];
  const patch = page.client.patchFormItem.bind(page.client);
  page.client.patchFormItem = (/** @type {any[]} */ ...args) => {
    writes.push(args[2]);
    return patch(...args);
  };
  return writes;
}

/** Let the save pause pass and wait for the write to land. */
async function save(/** @type {any} */ t, /** @type {any} */ page) {
  t.mock.timers.tick(1500);
  await page.until(
    (/** @type {any} */ route) =>
      route.saveStatus === 'saved' && route.lastSavedAt !== null
  );
}

/** @param {any} page */
async function storedActions(page) {
  return (await page.client.getFormItem(oneToOne, page.route.id))?.fields
    .Actions;
}

/**
 * Change one input of an Action's card.
 *
 * @param {any} page
 * @param {number} number
 * @param {string} role
 * @param {string} name
 * @param {string} value
 */
function change(page, number, role, name, value) {
  fireEvent(getByRole(card(page.render(), number), role, { name }), 'change', {
    target: { value },
  });
}

/**
 * A client whose Form 101 holds `encoded` in its Actions column, as a list
 * edited by hand might.
 *
 * @param {string | null} encoded
 */
function storingActions(encoded) {
  const lists = structuredClone(formLists);
  const row = lists[oneToOne.listName].find((item) => item.id === '101');
  /** @type {any} */ (row).fields.Actions = encoded;
  return formsClient(lists);
}

test('an added Form Action is saved with the others as one list, Pending until its status changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-employee', '101');
  const writes = recordWrites(page);
  fireEvent(
    getByRole(page.render(), 'button', { name: '+ Add action' }),
    'click'
  );
  change(page, 2, 'textbox', 'Title', 'Shadow a QA review');
  change(page, 2, 'textbox', 'Due date', '2026-10-24');
  await save(t, page);

  assert.deepEqual(
    writes.map((fields) => Object.keys(fields)),
    [['Actions']]
  );
  assert.deepEqual(await storedActions(page), [
    {
      title: 'Book the SQL course',
      dueDate: '2026-10-15',
      status: 'Pending',
      details: 'Ask about the October intake.',
    },
    {
      title: 'Shadow a QA review',
      dueDate: '2026-10-24',
      status: 'Pending',
      details: '',
    },
  ]);
});

test('Form Actions can be added only until the cap, and the editor says how many are left', async () => {
  const page = await openForm('forms-employee', '102');
  const add = () =>
    getByRole(page.render(), 'button', { name: '+ Add action' });
  for (let held = 0; held < MAX_FORM_ACTIONS; held += 1) {
    assert.match(
      page.render().querySelector('.cora-form-action-left')?.textContent ?? '',
      new RegExp(`^${MAX_FORM_ACTIONS - held} of ${MAX_FORM_ACTIONS} left$`)
    );
    assert.equal(add().disabled, false);
    fireEvent(add(), 'click');
  }
  assert.equal(add().disabled, true);
  assert.ok(card(page.render(), MAX_FORM_ACTIONS));
  assert.equal(
    queryByRole(page.render(), 'group', {
      name: `Action ${MAX_FORM_ACTIONS + 1}`,
    }),
    null
  );
});

test('each of an Action’s details is edited in its own card and saved as the whole list', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-line-manager', '101');
  const writes = recordWrites(page);
  change(page, 1, 'combobox', 'Status', 'Completed');
  change(page, 1, 'textbox', 'Details', 'Booked for the 14th.');
  await save(t, page);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].Actions, [
    {
      title: 'Book the SQL course',
      dueDate: '2026-10-15',
      status: 'Completed',
      details: 'Booked for the 14th.',
    },
  ]);
});

test('an Action’s status is chosen from the Form Action Statuses', async () => {
  const view = (await openForm('forms-employee', '101')).render();
  const options = queryAllByTag(
    getByRole(card(view, 1), 'combobox', { name: 'Status' }),
    'option'
  )
    .map((option) => option.value)
    .filter(Boolean);
  assert.deepEqual(options, [...FORM_ACTION_STATUSES]);
});

test('a status stored outside the Form Action Statuses is offered too, so opening the Form keeps it', async () => {
  const client = storingActions(
    encodeText(
      JSON.stringify([
        { title: 'Old', dueDate: '', status: 'In progress', details: '' },
      ])
    )
  );
  const view = (await openForm('forms-employee', '101', { client })).render();
  const status = getByRole(card(view, 1), 'combobox', { name: 'Status' });
  assert.equal(status.value, 'In progress');
  assert.deepEqual(
    queryAllByTag(status, 'option')
      .map((option) => option.value)
      .filter(Boolean),
    [...FORM_ACTION_STATUSES, 'In progress']
  );
});

test('an empty Action is removed at once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-employee', '101');
  fireEvent(
    getByRole(page.render(), 'button', { name: '+ Add action' }),
    'click'
  );
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Remove action 2' }),
    'click'
  );
  await save(t, page);
  assert.equal((await storedActions(page)).length, 1);
});

test('removing an Action with something written in it asks first, and can be withdrawn', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-employee', '101');
  const writes = recordWrites(page);
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Remove action 1' }),
    'click'
  );
  assert.match(
    page.render().textContent ?? '',
    /Remove action 1\? What it says will be lost\./
  );
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Keep action' }),
    'click'
  );
  assert.equal(
    queryByRole(page.render(), 'button', { name: 'Yes, remove' }),
    null
  );
  assert.deepEqual(writes, []);

  fireEvent(
    getByRole(page.render(), 'button', { name: 'Remove action 1' }),
    'click'
  );
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Yes, remove' }),
    'click'
  );
  await save(t, page);
  assert.deepEqual(await storedActions(page), []);
  assert.match(page.render().textContent ?? '', /3 of 3 left/);
});

test('a removal still waiting for its yes is dropped when the list changes under it', async () => {
  const page = await openForm('forms-employee', '101');
  fireEvent(
    getByRole(page.render(), 'button', { name: '+ Add action' }),
    'click'
  );
  change(page, 2, 'textbox', 'Title', 'Second');
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Remove action 2' }),
    'click'
  );
  change(page, 1, 'textbox', 'Title', 'First, renamed');
  assert.equal(
    queryByRole(page.render(), 'button', { name: 'Yes, remove' }),
    null
  );
});

/** A client whose Form 101 has been completed. */
function completed101() {
  const lists = structuredClone(formLists);
  const row = lists[oneToOne.listName].find((item) => item.id === '101');
  Object.assign(/** @type {any} */ (row).fields, {
    Status: 'Completed',
    ClosedDate: '2026-10-09',
  });
  return formsClient(lists);
}

for (const [persona, client, why] of [
  ['forms-second-line-manager', undefined, 'may only read the Form'],
  ['forms-control', undefined, 'may only read the Form'],
  ['forms-employee', completed101, 'the Form is locked'],
]) {
  test(`${persona} reads the Actions as text, with nothing to add or remove, when ${why}`, async () => {
    const view = (
      await openForm(/** @type {string} */ (persona), '101', {
        client: typeof client === 'function' ? client() : undefined,
      })
    ).render();
    const actions = /** @type {HTMLElement} */ (
      view.querySelector('.cora-form-actions')
    );
    assert.equal(
      queryByRole(actions, 'button', { name: '+ Add action' }),
      null
    );
    assert.equal(
      queryByRole(actions, 'button', { name: 'Remove action 1' }),
      null
    );
    assert.deepEqual(queryAllByRole(actions, 'textbox'), []);
    assert.match(
      actions.textContent ?? '',
      /Book the SQL courseDue 15\/10\/2026Pending/
    );
  });
}

for (const [what, encoded] of [
  ['that is not JSON', encodeText('[{"title": "Half')],
  [
    `holding more than ${MAX_FORM_ACTIONS}`,
    encodeText(
      JSON.stringify(
        Array.from({ length: MAX_FORM_ACTIONS + 1 }, (_, index) => ({
          title: `Action ${index + 1}`,
          dueDate: '',
          status: 'Pending',
          details: '',
        }))
      )
    ),
  ],
]) {
  test(`stored Actions ${what} are reported, left alone, and the rest of the Form still works`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = storingActions(encoded);
    const page = await openForm('forms-employee', '101', { client });
    const writes = recordWrites(page);
    const view = page.render();

    assert.match(
      getByRole(view, 'alert').textContent ?? '',
      /could not be read .* left as stored/
    );
    assert.equal(queryByRole(view, 'button', { name: '+ Add action' }), null);
    fireEvent(getByRole(view, 'textbox', { name: 'Agenda' }), 'change', {
      target: { value: 'Still saved' },
    });
    await save(t, page);
    assert.deepEqual(
      writes.map((fields) => Object.keys(fields)),
      [['Agenda']]
    );
  });
}
