// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  makeCaseRow,
  makeChrome,
  makePermissions,
} from './helpers/fixtures.js';
import {
  getByRole,
  queryAllByRole,
  queryByRole,
  textContent,
} from './helpers/semantic-dom.js';

installDom();

const { createRouteSlice } = await import('../src/pages/home.js');
const { homeCardsFor } = await import('../src/setup/register-routes.js');
const { APP_CONFIG } = await import('../src/app-config.js');
const { resolveCapabilities } = await import('../src/services/permissions.js');
const { MockSharePointClient } =
  await import('../src/services/mock-sharepoint-client.js');
const { personas } = await import('../dev/fixtures/personas.js');
const { formLists } = await import('../dev/fixtures/forms.js');
const { oneToOne } = await import('../form-types/one-to-one.js');

/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

// Capability: Home greets the person, says what needs them across Cases and
// Forms, and lays out a card for each page they may open, grouped by area. The
// cards come from the page configuration; their figures are the dashboards'
// own, read after the cards are drawn.

/** The dev fixtures are written against this day. */
const NOW = () => new Date(2026, 9, 10, 9, 15, 0);

const CASES = 'Cases-Home';
const SOURCES = [
  { slug: 'complaints', listName: CASES, displayName: 'Complaints' },
];

/**
 * @param {import('../src/sharepoint-client.js').CaseRow[]} cases
 */
function clientWith(cases = []) {
  return new MockSharePointClient({
    personas: {},
    lists: { [CASES]: cases },
    formLists,
  });
}

/**
 * Mount Home for one person, the way the store route does.
 *
 * @param {{
 *   capabilities: Capabilities,
 *   userId?: string,
 *   displayName?: string,
 *   client?: any,
 *   now?: () => Date,
 * }} who
 */
function mountHome({
  capabilities,
  userId = 'user-reviewer',
  displayName = 'Sam Patel',
  client = clientWith(),
  now = NOW,
}) {
  const context = /** @type {any} */ ({
    client,
    chrome: makeChrome({
      currentUser: { id: userId, displayName },
      permissions: capabilities,
    }),
    caseSources: SOURCES,
    formTypes: [oneToOne],
    homeCards: homeCardsFor(capabilities),
  });
  const slice = createRouteSlice({}, context, { now });
  let state = slice.initialState;
  let active = true;
  /** @type {(value?: unknown) => void} */
  let reachedAfterLeave = () => {};
  const afterLeave = new Promise((resolve) => {
    reachedAfterLeave = resolve;
  });
  /** @type {any[]} */
  const actions = [];
  /** @type {Set<() => void>} */
  const waiting = new Set();
  const controller = new AbortController();
  slice.start?.({
    dispatch: (/** @type {any} */ action) => {
      if (!active) reachedAfterLeave();
      actions.push(action);
      state = slice.reducer(state, action);
      for (const check of [...waiting]) check();
    },
    isActive: () => {
      if (!active) reachedAfterLeave();
      return active;
    },
    signal: controller.signal,
    context,
  });
  return {
    actions,
    render: () => slice.view(state),
    route: () => state.routes.home,
    /** Resolves once every figure read has answered. */
    read: () =>
      new Promise((resolve) => {
        const check = () => {
          if (state.routes.home.reading > 0) return;
          waiting.delete(check);
          resolve(undefined);
        };
        waiting.add(check);
        check();
      }),
    /** Leave the page, cutting its reads short unless `abort` is false. */
    leave: ({ abort = true } = {}) => {
      active = false;
      if (abort) controller.abort();
    },
    /** Resolves once the page next asks whether it is still showing, after leave. */
    afterLeave: () => afterLeave,
  };
}

/** @param {string} persona a key of the dev personas */
function mountAs(persona, options = {}) {
  const who = personas[persona];
  return mountHome({
    capabilities: resolveCapabilities(who.groups),
    userId: who.userId,
    displayName: who.displayName,
    ...options,
  });
}

/** @param {HTMLElement} view */
function areaTitles(view) {
  return [...view.querySelectorAll('h2')].map((heading) => heading.textContent);
}

/** @param {HTMLElement} view */
function cardLinks(view) {
  return [...view.querySelectorAll('.cora-home-card-link')].map((link) =>
    link.getAttribute('href')
  );
}

/** @param {HTMLElement} view @param {string} title */
function figuresOn(view, title) {
  const card = getByRole(view, 'article', { name: title });
  return [...card.querySelectorAll('li')].map((item) => item.textContent);
}

/** @param {HTMLElement} view */
function attention(view) {
  const row = queryByRole(view, 'region', { name: 'Needs your attention' });
  return row
    ? queryAllByRole(row, 'link').map((link) => [
        link.getAttribute('href'),
        textContent(link),
      ])
    : null;
}

test('a person with no role is told how access works, and offered nothing to open', () => {
  const view = mountAs('visitor').render();

  assert.deepEqual(areaTitles(view), ['Visitor']);
  assert.match(view.textContent ?? '', /Access is managed by your team/);
  assert.deepEqual(queryAllByRole(view, 'link'), []);
  assert.equal(attention(view), null);
});

test('every card a person is offered opens a page that lets them in, and each is drawn once', () => {
  for (const [persona, who] of Object.entries(personas)) {
    const capabilities = resolveCapabilities(who.groups);
    const cards = homeCardsFor(capabilities);
    for (const card of cards) {
      const page = APP_CONFIG.pagePlugins.find(
        (plugin) => plugin.id === card.id
      );
      assert.equal(
        page?.guard?.(capabilities) ?? true,
        true,
        `${persona}: ${card.id}`
      );
    }
    const view = mountHome({ capabilities }).render();
    assert.deepEqual(
      cardLinks(view).sort(),
      cards.map((card) => card.href).sort(),
      persona
    );
  }
});

test('someone whose only access is to Forms sees only People & development', () => {
  const view = mountAs('forms-employee').render();

  assert.deepEqual(areaTitles(view), ['People & development']);
  assert.deepEqual(cardLinks(view), ['#/forms', '#/forms/new']);
});

test('the areas are laid out Case Review, then People & development, then Admin', () => {
  const view = mountHome({
    capabilities: makePermissions({
      isMaintainer: true,
      canAccessForms: true,
      canSearchCases: true,
    }),
  }).render();

  assert.deepEqual(areaTitles(view), [
    'Case Review',
    'People & development',
    'Admin',
  ]);
});

test('the person is greeted by first name for the time of day, with the date written out', () => {
  const at = (/** @type {number} */ hour) =>
    mountAs('forms-employee', { now: () => new Date(2026, 9, 10, hour) })
      .render()
      .querySelector('h1')?.textContent;

  assert.equal(at(9), 'Good morning, Sam');
  assert.equal(at(12), 'Good afternoon, Sam');
  assert.equal(at(18), 'Good evening, Sam');
  assert.equal(
    mountHome({ capabilities: makePermissions(), displayName: '  ' })
      .render()
      .querySelector('h1')?.textContent,
    'Good morning'
  );
  assert.match(
    mountAs('forms-employee').render().textContent ?? '',
    /Saturday 10 October 2026/
  );
});

test('the cards are drawn before their figures are read, which fill in after', async () => {
  const home = mountAs('forms-employee');
  assert.deepEqual(figuresOn(home.render(), 'My forms'), []);

  await home.read();
  assert.deepEqual(figuresOn(home.render(), 'My forms'), [
    '1 Overdue',
    '1 Open actions',
  ]);
});

test('what is overdue or due this week, across Cases and Forms, leads the page and links to where it is', async () => {
  const home = mountHome({
    capabilities: makePermissions({ canAccessForms: true }),
    userId: 'user-forms-employee',
    client: clientWith([
      makeCaseRow({
        assignedReviewer: 'user-forms-employee',
        dueDate: '2026-10-01',
      }),
    ]),
  });
  await home.read();

  assert.deepEqual(attention(home.render()), [
    ['#/dashboard', '1 Case overdue Dashboard'],
    ['#/forms', '1 Form overdue My forms'],
  ]);
});

test('Forms due this week follow the late ones, counted together across a manager’s own and their reports’', async () => {
  const lists = structuredClone(formLists);
  for (const [id, due] of [
    ['102', '2026-10-12'],
    ['104', '2026-10-14'],
  ]) {
    const row = lists[oneToOne.listName].find((item) => item.id === id);
    /** @type {any} */ (row).fields.DueDate = due;
  }
  const home = mountAs('forms-line-manager', {
    client: new MockSharePointClient({ personas: {}, formLists: lists }),
  });
  await home.read();

  assert.deepEqual(attention(home.render()), [
    ['#/forms', '1 Form overdue My forms'],
    ['#/forms', '2 Forms due this week My forms'],
  ]);
});

test('when nothing is overdue or due, Home says so once every figure is read', async () => {
  const home = mountHome({ capabilities: makePermissions() });
  assert.doesNotMatch(home.render().textContent ?? '', /Nothing is overdue/);

  await home.read();
  assert.equal(attention(home.render()), null);
  assert.match(
    home.render().textContent ?? '',
    /Nothing is overdue or due this week\./
  );
});

test('someone whose cards carry no figures is told nothing about what is due', async () => {
  const home = mountAs('maintainer');
  await home.read();

  assert.equal(attention(home.render()), null);
  assert.doesNotMatch(home.render().textContent ?? '', /Nothing is overdue/);
});

test('a figure that cannot be read leaves its card, and never claims nothing is due', async () => {
  const client = clientWith();
  client.listFormItems = async () => {
    throw new Error('list unavailable');
  };
  const home = mountAs('forms-employee', { client });
  await home.read();

  const view = home.render();
  assert.deepEqual(figuresOn(view, 'My forms'), []);
  assert.ok(getByRole(view, 'link', { name: 'Open forms →' }));
  assert.doesNotMatch(view.textContent ?? '', /Nothing is overdue/);
});

test('with no client to read through, Home draws its cards and reads nothing', () => {
  const home = mountAs('forms-employee', { client: null });
  assert.equal(home.route().reading, 0);
  assert.deepEqual(home.actions, []);
  assert.deepEqual(cardLinks(home.render()), ['#/forms', '#/forms/new']);
});

test('figures that answer after the person has left are dropped', async () => {
  /** @type {(value: any) => void} */
  let answer = () => {};
  const client = clientWith();
  client.listFormItems = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  const home = mountAs('forms-employee', { client });
  home.leave({ abort: false });
  answer({ items: [], next: null });
  await home.afterLeave();

  assert.deepEqual(home.actions, []);
});

test('a read that fails after the person has left is dropped', async () => {
  /** @type {(error: Error) => void} */
  let fail = () => {};
  const client = clientWith();
  client.listFormItems = () =>
    new Promise((_resolve, reject) => {
      fail = reject;
    });
  const home = mountAs('forms-employee', { client });
  home.leave({ abort: false });
  fail(new Error('list unavailable'));
  await home.afterLeave();

  assert.deepEqual(home.actions, []);
});

test('a read cut short by leaving is not reported as a failure', async () => {
  const home = mountAs('forms-employee');
  home.leave();
  await home.afterLeave();

  assert.deepEqual(home.actions, []);
});
