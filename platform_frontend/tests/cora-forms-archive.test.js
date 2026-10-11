// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
  queryByRole,
  tableHeaders,
} from './helpers/semantic-dom.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { MockSharePointClient, storedFormFields } =
  await import('../src/services/mock-sharepoint-client.js');
const { formLists } = await import('../dev/fixtures/forms.js');
const { oneToOne } = await import('../form-types/one-to-one.js');
const { bodyRows, mountFormsPage } = await import('./helpers/forms-page.js');

// Capability: the Forms archive lists the closed Forms a person took part in,
// or every closed Form for the control group, inside a closed-date window that
// every read carries, all read-only, a page at a time.

/** @param {any} [options] */
const archive = (persona = 'forms-employee', options = {}) =>
  mountFormsPage(persona, { tab: 'archive', ...options });

/**
 * A mock client that records the filter of every read it is asked for.
 *
 * @param {Record<string, any[]>} [lists]
 */
function recordingClient(lists = formLists) {
  const client = new MockSharePointClient({ personas: {}, formLists: lists });
  /** @type {any[]} */
  const filters = [];
  const listFormItems = client.listFormItems.bind(client);
  client.listFormItems = (formType, opts) => {
    filters.push(opts?.filter);
    return listFormItems(formType, opts);
  };
  return { client, filters };
}

/**
 * @param {number} count
 * @param {(i: number) => Record<string, any>} [fields]
 */
function closedForms(count, fields = () => ({})) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(700 + i),
    etag: '"1"',
    created: '2026-01-01T09:00:00Z',
    modified: '2026-01-01T09:00:00Z',
    fields: storedFormFields(oneToOne, {
      Employee: { loginName: `user-${i}`, displayName: `Person ${i}` },
      CurrentFirstLineManager: null,
      CurrentSecondLineManager: null,
      Status: 'Completed',
      DueDate: '2026-02-01',
      ClosedDate: '2026-02-01',
      ...fields(i),
    }),
  }));
}

test('the archive table names the managers at completion and has no due date', async () => {
  const page = await archive();
  assert.deepEqual(tableHeaders(page.render()), [
    ['Form', 'none', true],
    ['Employee', 'none', true],
    ['Closed on', 'none', true],
    ['Status', 'none', true],
    ['Managers at completion', 'none', false],
    ['Actions', 'none', false],
  ]);
});

test('the Employee sees their closed Forms in the window, latest closed first, each to view only', async () => {
  const page = await archive();
  assert.deepEqual(bodyRows(page.render()), [
    ['1-to-1', 'Sam Patel', '03/07/2026', 'Void', '—', 'View'],
    [
      '1-to-1First quarter check-in',
      'Sam Patel',
      '24/06/2026',
      'Completed',
      'Lee Morgan · Jo Reid',
      'View',
    ],
  ]);
});

test('the current first line manager sees the closed Forms they now manage', async () => {
  const page = await archive('forms-line-manager');
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => [cells[1], cells[3], cells[5]]),
    [
      ['Sam Patel', 'Void', 'View'],
      ['Sam Patel', 'Completed', 'View'],
    ]
  );
});

test('every read carries the closed-date window, and only the control group reads beyond their own Forms', async () => {
  const mine = recordingClient();
  await archive('forms-employee', { client: mine.client });
  assert.deepEqual(mine.filters, [
    {
      closed: true,
      window: { column: 'ClosedDate', from: '2025-10-10', to: '2026-10-10' },
      involving: 'user-forms-employee',
    },
  ]);

  const control = recordingClient();
  await archive('forms-control', { client: control.client });
  assert.deepEqual(control.filters, [
    {
      closed: true,
      window: { column: 'ClosedDate', from: '2025-10-10', to: '2026-10-10' },
    },
  ]);
});

test('changing the dates reads again, and a cleared date falls back to its default rather than widening the read', async () => {
  const { client, filters } = recordingClient();
  const page = await archive('forms-employee', { client });

  fireEvent(
    getByRole(page.render(), 'textbox', { name: 'Closed from' }),
    'change',
    { target: { value: '2025-01-01' } }
  );
  await page.until((route) => route.archive.status === 'loaded');
  assert.deepEqual(filters.at(-1).window, {
    column: 'ClosedDate',
    from: '2025-01-01',
    to: '2026-10-10',
  });
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[3]),
    ['Void', 'Completed', 'Cancelled']
  );

  fireEvent(
    getByRole(page.render(), 'textbox', { name: 'Closed from' }),
    'change',
    { target: { value: '' } }
  );
  await page.until(
    (route) =>
      route.archive.status === 'loaded' &&
      route.archive.window.from === '2025-10-10'
  );
  assert.deepEqual(filters.at(-1).window, {
    column: 'ClosedDate',
    from: '2025-10-10',
    to: '2026-10-10',
  });
});

/**
 * A page whose archive reads can be held, so a test decides the order their
 * replies arrive in. `settle(i, outcome)` lets the i-th held read answer, and
 * resolves once the page has handled that answer.
 */
async function heldArchive() {
  const client = new MockSharePointClient({ personas: {}, formLists });
  const listFormItems = client.listFormItems.bind(client);
  /** @type {Array<(outcome: 'reply' | 'fail') => void>} */
  const held = [];
  let hold = false;
  client.listFormItems = (formType, opts) => {
    const reply = listFormItems(formType, opts);
    if (!hold) return reply;
    return new Promise((resolve, reject) =>
      held.push((outcome) =>
        outcome === 'reply' ? resolve(reply) : reject(new Error('503'))
      )
    );
  };
  const page = await archive('forms-employee', { client });
  const startedBefore = page.actions.length;
  /** @param {string} value */
  const changeFrom = (value) => {
    hold = true;
    fireEvent(
      getByRole(page.render(), 'textbox', { name: 'Closed from' }),
      'change',
      { target: { value } }
    );
  };
  /**
   * @param {number} i
   * @param {'reply' | 'fail'} outcome
   */
  const settle = (i, outcome) => {
    const request = page.actions
      .slice(startedBefore)
      .filter((action) => action.type === 'forms/read-started')[i].request;
    held[i](outcome);
    return page.until(() =>
      page.actions.some(
        (action) =>
          action.request === request &&
          (action.type === 'forms/read-loaded' ||
            action.type === 'forms/read-failed')
      )
    );
  };
  return { page, changeFrom, settle };
}

test('a reply to dates the viewer has since changed is dropped', async () => {
  const { page, changeFrom, settle } = await heldArchive();
  changeFrom('2025-01-01');
  changeFrom('2026-07-01');
  await settle(1, 'reply');
  await settle(0, 'reply');
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[2]),
    ['03/07/2026']
  );
});

test('a failure of a read the viewer has since replaced is not reported', async () => {
  const { page, changeFrom, settle } = await heldArchive();
  changeFrom('2025-01-01');
  changeFrom('2026-07-01');
  await settle(1, 'reply');
  await settle(0, 'fail');
  assert.equal(queryByRole(page.render(), 'alert'), null);
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[2]),
    ['03/07/2026']
  );
});

test('the Status filter narrows to one closing Status', async () => {
  const page = await archive();
  fireEvent(
    getByRole(page.render(), 'combobox', { name: 'Status' }),
    'change',
    {
      target: { value: 'Completed' },
    }
  );
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[3]),
    ['Completed']
  );
});

test('the Employee filter narrows by name', async () => {
  const many = closedForms(3);
  const page = await archive('forms-control', {
    client: new MockSharePointClient({
      personas: {},
      formLists: { [oneToOne.listName]: many },
    }),
  });
  fireEvent(
    getByRole(page.render(), 'textbox', { name: 'Employee or title' }),
    'input',
    { target: { value: 'person 1' } }
  );
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[1]),
    ['Person 1']
  );
});

test('Load more appends the next page and goes once there are no more', async () => {
  const page = await archive('forms-control', {
    client: new MockSharePointClient({
      personas: {},
      formLists: { [oneToOne.listName]: closedForms(51) },
    }),
  });
  assert.equal(bodyRows(page.render()).length, 50);
  assert.match(page.render().textContent ?? '', /Showing 50/);

  fireEvent(getByRole(page.render(), 'button', { name: 'Load more' }), 'click');
  await page.until((route) => route.archive.loaded[0].items.length === 51);
  const view = page.render();
  assert.equal(bodyRows(view).length, 51);
  assert.equal(queryByRole(view, 'button', { name: 'Load more' }), null);
});

test('the control group is told the archive spans every Form', async () => {
  const control = (await archive('forms-control')).render().textContent ?? '';
  assert.match(control, /Every Form that is/);
  assert.doesNotMatch(control, /Forms you’ve been part of/);
  const employee = (await archive()).render().textContent ?? '';
  assert.match(employee, /Forms you’ve been part of/);
  assert.doesNotMatch(employee, /Every Form that is/);
});

test('the Archive tab is selected, and the Outstanding tab goes back to the dashboard', async () => {
  const page = await archive();
  const tabs = queryAllByRole(page.render(), 'tab');
  assert.deepEqual(
    tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')]),
    [
      ['Outstanding', 'false'],
      ['Archive', 'true'],
    ]
  );
  fireEvent(getByRole(page.render(), 'tab', { name: 'Outstanding' }), 'click');
  assert.equal(location.hash, '#/forms');
});

test('the Outstanding tab is the default and offers the archive', async () => {
  const page = await mountFormsPage('forms-employee');
  fireEvent(getByRole(page.render(), 'tab', { name: 'Archive' }), 'click');
  assert.equal(location.hash, '#/forms?tab=archive');
});

test('a failed archive read says so', async () => {
  const client = new MockSharePointClient({ personas: {}, formLists });
  client.listFormItems = async () => {
    throw new Error('503');
  };
  const page = await archive('forms-employee', { client });
  assert.match(
    getByRole(page.render(), 'alert').textContent ?? '',
    /could not be loaded/
  );
});

test('sorting the archive by Employee orders its rows', async () => {
  const page = await archive('forms-control', {
    client: new MockSharePointClient({
      personas: {},
      formLists: {
        [oneToOne.listName]: closedForms(2, (i) => ({
          Employee: {
            loginName: `u${i}`,
            displayName: i === 0 ? 'Zed' : 'Amy',
          },
          ClosedDate: i === 0 ? '2026-03-01' : '2026-02-01',
        })),
      },
    }),
  });
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[1]),
    ['Zed', 'Amy']
  );
  fireEvent(getByRole(page.render(), 'button', { name: 'Employee' }), 'click');
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[1]),
    ['Amy', 'Zed']
  );
});

test('with more than one Form Type the archive narrows to the chosen one', async () => {
  const coaching = {
    ...oneToOne,
    slug: 'coaching',
    formName: 'Coaching',
    listName: 'Coaching',
  };
  const page = await archive('forms-control', {
    formTypes: [oneToOne, coaching],
    client: new MockSharePointClient({
      personas: {},
      formLists: {
        [oneToOne.listName]: closedForms(1),
        Coaching: closedForms(1, () => ({ ClosedDate: '2026-03-01' })),
      },
    }),
  });
  assert.deepEqual(
    bodyRows(page.render()).map((cells) => cells[0]),
    ['Coaching', '1-to-1']
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
