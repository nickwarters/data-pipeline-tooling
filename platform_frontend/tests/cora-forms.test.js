// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByTag,
  queryByRole,
  tableHeaders,
} from './helpers/semantic-dom.js';
import { makeChrome } from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice } = await import('../src/pages/cora-forms.js');
const { MockSharePointClient, storedFormFields } =
  await import('../src/services/mock-sharepoint-client.js');
const { resolveCapabilities } = await import('../src/services/permissions.js');
const { personas } = await import('../dev/fixtures/personas.js');
const { formLists } = await import('../dev/fixtures/forms.js');
const { oneToOne } = await import('../form-types/one-to-one.js');
const {
  NOW,
  bodyRows,
  mountFormsPage: mount,
} = await import('./helpers/forms-page.js');

// Capability: the Forms dashboard shows each person the open Forms they are
// on, in the role they hold, with Open for an editor and View for a reader,
// and lets the Forms control group page through every open Form.

test('the table has the six columns of the dashboard, the action unsortable', async () => {
  const page = await mount('forms-employee');
  assert.deepEqual(tableHeaders(page.render()), [
    ['Form', 'none', true],
    ['Employee', 'none', true],
    ['Your role', 'none', true],
    ['Due date', 'none', true],
    ['Status', 'none', true],
    ['Actions', 'none', false],
  ]);
});

test('the Employee sees their own open Forms, soonest first, and not the closed one', async () => {
  const page = await mount('forms-employee');
  assert.deepEqual(bodyRows(page.render()), [
    [
      '1-to-1',
      'Sam Patel',
      'Employee',
      '30/09/2026 · 10 days over',
      'Pending',
      'Open',
    ],
    ['1-to-1', 'Sam Patel', 'Employee', '31/10/2026', 'Pending', 'Open'],
  ]);
});

test('the current first line manager sees their reports’ Forms as Manager and their own as Employee', async () => {
  const page = await mount('forms-line-manager');
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => [cells[1], cells[2], cells[5]]),
    [
      ['Sam Patel', 'Manager', 'Open'],
      ['Ana Lopez', 'Employee', 'Open'],
      ['Sam Patel', 'Manager', 'Open'],
    ]
  );
});

test('the current second line manager can only view, and edits the Form they manage directly', async () => {
  const page = await mount('forms-second-line-manager');
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => [cells[1], cells[2], cells[5]]),
    [
      ['Sam Patel', 'Second line manager · view only', 'View'],
      ['Ana Lopez', 'Manager', 'Open'],
      ['Sam Patel', 'Second line manager · view only', 'View'],
    ]
  );
});

test('an overdue Form’s row is tinted and no other is', async () => {
  const page = await mount('forms-employee');
  const body = queryAllByTag(page.render(), 'tbody')[0];
  assert.deepEqual(
    queryAllByTag(body, 'tr').map((row) =>
      row.className.includes('cora-case-row--overdue')
    ),
    [true, false]
  );
});

test('the lanes count what the viewer has to do, in each role they hold', async () => {
  const page = await mount('forms-line-manager');
  const strip = page.render().querySelector('.cora-kpi-strip');
  assert.ok(strip);
  const lanes = [...strip.querySelectorAll('.cora-kpi-lane')].map((lane) => [
    lane.querySelector('.cora-kpi-lane__role')?.textContent,
    [...lane.querySelectorAll('.cora-kpi-tile')].map(
      (tile) =>
        `${tile.querySelector('.cora-kpi-tile__count')?.textContent} ${tile.querySelector('.cora-kpi-tile__label')?.textContent}`
    ),
  ]);
  // Ana's own Form is due later than this week and has no Actions, so the
  // employee lane has nothing to show and is not drawn.
  assert.deepEqual(lanes, [['As manager', ['1 Overdue', '2 Open']]]);
});

test('the employee lane counts the Employee’s pending Form Actions', async () => {
  const page = await mount('forms-employee');
  const lane = page.render().querySelector('.cora-kpi-lane');
  assert.equal(
    lane?.querySelector('.cora-kpi-lane__role')?.textContent,
    'As employee'
  );
  assert.deepEqual(
    [...(lane?.querySelectorAll('.cora-kpi-tile__label') ?? [])].map(
      (label) => label.textContent
    ),
    ['Overdue', 'Open actions']
  );
});

test('the Open and View buttons go to the Form and name it for a screen reader', async () => {
  const page = await mount('forms-second-line-manager');
  const view = getByRole(page.render(), 'button', {
    name: 'View 1-to-1 for Sam Patel, due 30/09/2026',
  });
  fireEvent(view, 'click');
  assert.equal(location.hash, '#/forms/one-to-one/101');
});

test('everyone with Forms access is offered New form', async () => {
  const page = await mount('forms-second-line-manager');
  fireEvent(getByRole(page.render(), 'button', { name: 'New form' }), 'click');
  assert.equal(location.hash, '#/forms/new');
});

test('a person on no open Form is told so, with no lanes', async () => {
  const page = await mount('forms-control');
  const view = page.render();
  assert.equal(view.querySelector('.cora-kpi-strip'), null);
  assert.match(view.textContent ?? '', /You have no outstanding forms\./);
});

test('only the control group is offered every open Form', async () => {
  for (const persona of [
    'forms-employee',
    'forms-line-manager',
    'forms-second-line-manager',
  ]) {
    const page = await mount(persona);
    assert.equal(
      queryByRole(page.render(), 'combobox', { name: 'Which forms' }),
      null,
      persona
    );
  }
  const control = await mount('forms-control');
  assert.ok(queryByRole(control.render(), 'combobox', { name: 'Which forms' }));
});

test('the control group reads every open Form, view only, from the indexed columns', async () => {
  const client = new MockSharePointClient({ personas: {}, formLists });
  /** @type {any[]} */
  const reads = [];
  const listFormItems = client.listFormItems.bind(client);
  client.listFormItems = (formType, opts) => {
    reads.push(opts?.filter);
    return listFormItems(formType, opts);
  };
  const page = await mount('forms-control', { client });
  const scope = getByRole(page.render(), 'combobox', { name: 'Which forms' });
  fireEvent(scope, 'change', { target: { value: 'all' } });
  await page.until((route) => route.all.status === 'loaded');

  assert.deepEqual(reads.at(-1), { closed: false });
  const view = page.render();
  assert.equal(queryAllByTag(view, 'h2')[0].textContent, 'All open forms');
  assert.deepEqual(
    bodyRows(view).map((cells) => [cells[1], cells[2], cells[5]]),
    [
      ['Sam Patel', 'Forms control · view only', 'View'],
      ['Ana Lopez', 'Forms control · view only', 'View'],
      ['Sam Patel', 'Forms control · view only', 'View'],
    ]
  );
});

test('the control group pages through every open Form, keeping what is shown', async () => {
  const many = Array.from({ length: 101 }, (_, i) => ({
    id: String(500 + i),
    etag: '"1"',
    created: '2026-09-01T09:00:00Z',
    modified: '2026-09-01T09:00:00Z',
    fields: storedFormFields(oneToOne, {
      Employee: { loginName: `user-${i}`, displayName: `Person ${i}` },
      CurrentFirstLineManager: null,
      CurrentSecondLineManager: null,
      Status: 'Pending',
      DueDate: '2026-11-01',
    }),
  }));
  const client = new MockSharePointClient({
    personas: {},
    formLists: { [oneToOne.listName]: many },
  });
  const page = await mount('forms-control', { client });
  fireEvent(
    getByRole(page.render(), 'combobox', { name: 'Which forms' }),
    'change',
    { target: { value: 'all' } }
  );
  await page.until((route) => route.all.status === 'loaded');
  assert.equal(bodyRows(page.render()).length, 100);

  fireEvent(getByRole(page.render(), 'button', { name: 'Load more' }), 'click');
  await page.until((route) => route.all.loaded[0].items.length === 101);
  const view = page.render();
  assert.equal(bodyRows(view).length, 101);
  assert.equal(queryByRole(view, 'button', { name: 'Load more' }), null);
});

test('a failed read says so instead of showing an empty table', async () => {
  const client = new MockSharePointClient({ personas: {}, formLists });
  client.listFormItems = async () => {
    throw new Error('503');
  };
  const page = await mount('forms-employee', { client });
  const alert = getByRole(page.render(), 'alert');
  assert.match(alert.textContent ?? '', /could not be loaded/);
});

test('the table shows a loading state until the first read returns', () => {
  const who = personas['forms-employee'];
  const slice = createRouteSlice(
    {},
    /** @type {any} */ ({
      chrome: makeChrome({
        currentUser: { id: who.userId },
        permissions: resolveCapabilities(who.groups),
      }),
      formTypes: [oneToOne],
    }),
    { now: NOW }
  );
  const view = /** @type {HTMLElement} */ (
    slice.view(slice.initialState, /** @type {any} */ ({ dispatch() {} }))
  );
  assert.match(view.textContent ?? '', /Loading forms/);
});

test('the person filter narrows the table by employee name', async () => {
  const page = await mount('forms-line-manager');
  fireEvent(
    getByRole(page.render(), 'textbox', { name: 'Filter by person' }),
    'input',
    { target: { value: 'lopez' } }
  );
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[1]),
    ['Ana Lopez']
  );
});

test('a closed lane stays closed until it is opened again', async () => {
  const page = await mount('forms-line-manager');
  const header = () =>
    /** @type {HTMLElement} */ (
      page.render().querySelector('.cora-kpi-lane__header')
    );
  fireEvent(header(), 'click');
  assert.equal(header().getAttribute('aria-expanded'), 'false');
  fireEvent(header(), 'click');
  assert.equal(header().getAttribute('aria-expanded'), 'true');
});

test('sorting by a column orders the rows by it', async () => {
  const page = await mount('forms-line-manager');
  fireEvent(getByRole(page.render(), 'button', { name: 'Employee' }), 'click');
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[1]),
    ['Ana Lopez', 'Sam Patel', 'Sam Patel']
  );
});

test('with more than one Form Type the table can be narrowed to one, and each type is read', async () => {
  const coaching = {
    ...oneToOne,
    slug: 'coaching',
    formName: 'Coaching',
    listName: 'Coaching',
  };
  const client = new MockSharePointClient({
    personas: {},
    formLists: {
      ...formLists,
      Coaching: [
        {
          id: '900',
          etag: '"1"',
          created: '2026-09-01T09:00:00Z',
          modified: '2026-09-01T09:00:00Z',
          fields: storedFormFields(coaching, {
            Employee: {
              loginName: 'user-forms-employee',
              displayName: 'Sam Patel',
            },
            CurrentFirstLineManager: null,
            CurrentSecondLineManager: null,
            Status: 'Pending',
            DueDate: '2026-10-12',
          }),
        },
      ],
    },
  });
  const page = await mount('forms-employee', {
    client,
    formTypes: [oneToOne, coaching],
  });
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[0]),
    ['1-to-1', 'Coaching', '1-to-1']
  );

  fireEvent(
    getByRole(page.render(), 'combobox', { name: 'Form type' }),
    'change',
    { target: { value: 'coaching' } }
  );
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[0]),
    ['Coaching']
  );
});

test('with one Form Type there is no Form type filter to choose from', async () => {
  const page = await mount('forms-employee');
  assert.equal(
    queryByRole(page.render(), 'combobox', { name: 'Form type' }),
    null
  );
});

test('a failed read of every open Form says so, and choosing it again reads again', async () => {
  const client = new MockSharePointClient({ personas: {}, formLists });
  const listFormItems = client.listFormItems.bind(client);
  let failNext = false;
  client.listFormItems = (formType, opts) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error('503'));
    }
    return listFormItems(formType, opts);
  };
  const page = await mount('forms-control', { client });
  const choose = (/** @type {string} */ value) =>
    fireEvent(
      getByRole(page.render(), 'combobox', { name: 'Which forms' }),
      'change',
      { target: { value } }
    );

  failNext = true;
  choose('all');
  await page.until((route) => route.all.status === 'failed');
  assert.match(
    getByRole(page.render(), 'alert').textContent ?? '',
    /could not be loaded/
  );

  choose('mine');
  choose('all');
  await page.until((route) => route.all.status === 'loaded');
  assert.equal(bodyRows(page.render()).length, 3);
});

test('an action the page does not know leaves its state as it was', async () => {
  const page = await mount('forms-employee');
  const before = page.state;
  const slice = createRouteSlice(
    {},
    /** @type {any} */ ({ chrome: before.chrome })
  );
  assert.equal(slice.reducer(before, { type: 'something/else' }), before);
});
