// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import './_register-example-review.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';
import { makeChrome, makePermissions } from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice } = await import('../src/pages/cora-access.js');
const { MockSharePointClient } =
  await import('../src/services/mock-sharepoint-client.js');
const { APP_CONFIG } = await import('../src/app-config.js');
const { permissions } = await import('../src/services/permissions.js');

const REVIEWERS_COMPLAINTS = 'Reviewers - Complaints';

/** The people every page test shares: a half-provisioned Reviewer, an owner, and someone with nothing. */
const PEOPLE = () => [
  {
    loginName: 'zara',
    displayName: 'Zara Fields',
    groups: [REVIEWERS_COMPLAINTS],
  },
  {
    loginName: 'owen',
    displayName: 'Owen Owner',
    groups: [REVIEWERS_COMPLAINTS, 'Reviewers', 'CaseTypeOwner - Complaints'],
  },
  { loginName: 'bea', displayName: 'Bea Newcomer', groups: [] },
  { loginName: 'lone', displayName: 'Lone Reader', groups: ['Reviewers'] },
];

/**
 * @param {{ account?: string, people?: any[], accessLog?: any[], readOnlyGroups?: string[], missingGroups?: string[], client?: any }} [setup]
 */
function live(setup = {}) {
  const client =
    setup.client ??
    new MockSharePointClient({
      personas: { maintainer: { groups: [], displayName: 'Robin Maintainer' } },
      persona: 'maintainer',
      people: setup.people ?? PEOPLE(),
      accessLog: setup.accessLog,
      readOnlyGroups: setup.readOnlyGroups,
      missingGroups: setup.missingGroups,
      now: () => new Date('2026-10-05T12:00:00Z'),
    });
  const ctx = /** @type {any} */ ({
    client,
    chrome: makeChrome({ permissions: { isMaintainer: true } }),
    caseSources: [],
  });
  const slice = createRouteSlice(
    setup.account ? { account: setup.account } : {},
    ctx
  );
  let state = slice.initialState;
  let active = true;
  const dispatch = (/** @type {any} */ action) => {
    state = slice.reducer(state, action);
  };
  const cleanup = slice.start(
    /** @type {any} */ ({
      dispatch,
      context: ctx,
      isActive: () => active,
    })
  );
  return {
    client,
    state: () => state,
    view: () => /** @type {any} */ (slice.view(state, { dispatch })),
    leave: () => {
      active = false;
      cleanup?.();
    },
  };
}

async function flush(n = 80) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

/** @param {ReturnType<typeof live>} page @param {string} name */
const button = (page, name) => getByRole(page.view(), 'button', { name });

/** @param {ReturnType<typeof live>} page @param {string} label @param {string} value */
function choose(page, label, value) {
  fireEvent(getByRole(page.view(), 'combobox', { name: label }), 'change', {
    target: { value },
  });
}

/** @param {ReturnType<typeof live>} page @param {string} reason */
function giveReason(page, reason) {
  fireEvent(page.view().querySelector('textarea'), 'input', {
    target: { value: reason },
  });
}

test('access route: only a Maintainer may open it or see its link', () => {
  const entry = APP_CONFIG.pagePlugins.find((plugin) => plugin.id === 'access');
  assert.ok(entry?.guard, 'the route is guarded, not just the link');
  assert.equal(entry.guard(makePermissions({ isMaintainer: true })), true);
  for (const other of [
    { isReviewer: true },
    { isControls: true, canSearchCases: true },
    { isReviewerManager: true },
    { isReviewer: false, ownedCaseTypes: ['complaints'] },
  ]) {
    assert.equal(
      entry.guard(makePermissions(other)),
      false,
      JSON.stringify(other)
    );
  }
  assert.equal(entry.nav?.label, 'Access');
  assert.ok(entry.paths.includes('#/access/:account'));
});

test('access: with nobody chosen it warns that roles are shared, offers a picker and shows who holds each role', async () => {
  const page = live();
  await flush();

  const view = page.view();
  assert.match(
    view.textContent,
    /Roles are shared by every environment\. Granting or removing a role here changes access in production, UAT and training alike\./
  );
  assert.match(view.textContent, /nested AD group are not shown/);
  assert.ok(getByRole(view, 'combobox', { name: 'Person' }));
  assert.equal(view.querySelector('.cora-access-person'), null);
  assert.equal(view.querySelector('.cora-access-form'), null);

  const holders = [...view.querySelectorAll('.cora-access-holder')].map(
    (item) => item.querySelector('summary')?.textContent
  );
  assert.ok(holders.includes('Reviewer, Complaints (2)'), String(holders));
  assert.ok(holders.includes('Case Type Owner, Complaints (1)'));
  assert.ok(holders.includes('Reviewer Manager (0)'));
  const [link] = view.querySelectorAll('a');
  assert.equal(link.getAttribute('href'), '#/access/owen');
});

test('access: the picker finds a person in the directory and choosing one opens their page', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = live();
  const search = getByRole(page.view(), 'combobox', { name: 'Person' });

  fireEvent(search, 'input', { target: { value: 'bea' } });
  t.mock.timers.tick(200);
  await flush();

  const [match] = queryAllByRole(page.view(), 'option');
  assert.match(match.textContent, /Bea Newcomer/);
  fireEvent(match, 'click');
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/access/bea');
  page.leave();
});

test('access: a person’s roles are read off their groups, in role and Case Type language', async () => {
  const page = live({ account: 'owen' });
  await flush();

  const view = page.view();
  assert.equal(view.querySelector('h2').textContent, 'Owen Owner');
  const roles = [...view.querySelectorAll('.cora-access-role')];
  assert.deepEqual(
    roles.map((role) => role.querySelector('strong').textContent),
    ['Reviewer, Complaints', 'Case Type Owner, Complaints']
  );
  assert.equal(
    view.querySelector('.cora-access-role--incomplete'),
    null,
    'a fully provisioned person has nothing flagged'
  );
  for (const group of [REVIEWERS_COMPLAINTS, 'CaseTypeOwner - Complaints']) {
    assert.ok(
      !view.textContent.includes(group),
      `${group} never appears in the page`
    );
  }
});

test('access: a half-provisioned role is flagged and completed in one click, still with a reason', async () => {
  const page = live({ account: 'zara' });
  await flush();

  assert.ok(page.view().querySelector('.cora-access-role--incomplete'));
  assert.match(page.view().textContent, /Incomplete/);
  fireEvent(
    button(page, 'Give Zara Fields Reviewer access to Complaints'),
    'click'
  );
  const submit = () => button(page, 'Give access');
  assert.equal(submit().disabled, true, 'no reason, no change');
  giveReason(page, 'Their site-wide access was never added.');
  assert.equal(submit().disabled, false);

  fireEvent(submit(), 'click');
  await flush();

  assert.deepEqual(await page.client.listUserGroups('zara'), [
    REVIEWERS_COMPLAINTS,
    'Reviewers',
  ]);
  assert.equal(
    page.view().querySelector('.cora-access-role--incomplete'),
    null
  );
  assert.equal(
    getByRole(page.view(), 'status').textContent,
    'Gave Zara Fields Reviewer access to Complaints.'
  );
});

test('access: a Reviewer with no Case Type is flagged and can only be removed', async () => {
  const page = live({ account: 'lone' });
  await flush();

  const view = page.view();
  assert.match(view.textContent, /Reviewer \(no Case Type\)/);
  assert.match(view.textContent, /not tied to a Case Type/);
  assert.equal(
    queryAllByRole(view, 'button', { name: /^Give Lone/ }).length,
    0,
    'there is nothing to complete'
  );

  fireEvent(button(page, "Remove Lone Reader's Reviewer access"), 'click');
  giveReason(page, 'Never worked a Case Type.');
  fireEvent(button(page, 'Remove access'), 'click');
  await flush();

  assert.deepEqual(await page.client.listUserGroups('lone'), []);
});

test('access: giving a role needs a role, a Case Type where it has one, and a reason, and the button says what it will do', async () => {
  const page = live({ account: 'bea' });
  await flush();
  const submit = () => page.view().querySelector('.cora-access-submit');

  assert.equal(submit().disabled, true);
  assert.equal(submit().textContent, 'Give access');
  choose(page, 'Role', 'case-type-owner');
  assert.equal(submit().disabled, true, 'a Case Type is still to choose');
  choose(page, 'Case Type', 'complaints');
  assert.equal(
    submit().textContent,
    'Make Bea Newcomer Case Type Owner for Complaints'
  );
  assert.match(
    page.view().textContent,
    /Also gives Reviewer access to Complaints when that is missing\./
  );
  assert.equal(submit().disabled, true, 'a reason is still to give');
  giveReason(page, '   ');
  assert.equal(submit().disabled, true, 'a blank reason is no reason');
  giveReason(page, 'Takes over the bank.');
  assert.equal(submit().disabled, false);
});

test('access: the Case Type choice lists the registry’s Case Types and is offered only for a role that has one', async () => {
  const page = live({ account: 'bea' });
  await flush();

  choose(page, 'Role', 'controls');
  assert.equal(
    queryAllByRole(page.view(), 'combobox', { name: 'Case Type' }).length,
    0
  );
  choose(page, 'Role', 'journey-owner');
  const options = [
    ...getByRole(page.view(), 'combobox', {
      name: 'Case Type',
    }).querySelectorAll('option'),
  ].map((option) => option.textContent);
  assert.deepEqual(options, [
    'Choose a Case Type',
    ...permissions.caseTypes.map((type) => type.displayName),
  ]);
});

test('access: a grant logs first, adds every group, then shows the role, the notice and the log', async () => {
  const page = live({ account: 'bea' });
  await flush();
  /** @type {string[]} */
  const order = [];
  const log = page.client.addAccessLogEntry.bind(page.client);
  const add = page.client.addGroupMember.bind(page.client);
  page.client.addAccessLogEntry = async (/** @type {any} */ entry) => {
    order.push(`log:${entry.outcome}`);
    return log(entry);
  };
  page.client.addGroupMember = async (
    /** @type {string} */ group,
    /** @type {string} */ account
  ) => {
    order.push(`add:${group}`);
    return add(group, account);
  };

  choose(page, 'Role', 'journey-owner');
  choose(page, 'Case Type', 'complaints');
  giveReason(page, 'Covers the journey.');
  fireEvent(
    button(page, 'Make Bea Newcomer Journey Owner for Complaints'),
    'click'
  );
  await flush();

  assert.deepEqual(order, [
    'log:recorded',
    'add:Frontline - Complaints',
    'add:JourneyOwner - Complaints',
  ]);
  const view = page.view();
  assert.equal(
    getByRole(view, 'status').textContent,
    'Made Bea Newcomer Journey Owner for Complaints.'
  );
  assert.deepEqual(
    [...view.querySelectorAll('.cora-access-role')].map(
      (row) => row.querySelector('strong').textContent
    ),
    ['Journey Owner, Complaints']
  );
  const entry = view.querySelector('.cora-access-log-entry');
  assert.match(
    entry.textContent,
    /Made Bea Newcomer Journey Owner for Complaints/
  );
  assert.match(entry.textContent, /Robin Maintainer, 5 Oct 2026/);
  assert.match(entry.textContent, /Covers the journey\./);
  assert.ok(
    !view.textContent.includes('JourneyOwner - Complaints'),
    'the log shows the role, not the group'
  );
  assert.equal(
    getByRole(view, 'combobox', { name: 'Role' }).value,
    '',
    'the form is empty again'
  );
  const holders = [...view.querySelectorAll('.cora-access-holder')].find(
    (item) =>
      item.querySelector('summary').textContent.startsWith('Journey Owner')
  );
  assert.match(
    holders.textContent,
    /Bea Newcomer/,
    'who holds the role is re-read'
  );
});

test('access: removing a role asks for a reason and takes the groups away', async () => {
  const page = live({ account: 'owen' });
  await flush();

  fireEvent(
    button(page, 'Remove Owen Owner as Case Type Owner for Complaints'),
    'click'
  );
  assert.equal(
    page.view().querySelector('#cora-access-form-title').textContent,
    'Remove Owen Owner as Case Type Owner for Complaints'
  );
  assert.equal(
    queryAllByRole(page.view(), 'combobox', { name: 'Role' }).length,
    0,
    'the role is fixed once chosen from a held role'
  );
  const submit = () => button(page, 'Remove access');
  assert.equal(submit().disabled, true);
  giveReason(page, 'Handed the bank over.');
  fireEvent(submit(), 'click');
  await flush();

  assert.deepEqual(await page.client.listUserGroups('owen'), [
    REVIEWERS_COMPLAINTS,
    'Reviewers',
  ]);
  assert.equal(
    getByRole(page.view(), 'status').textContent,
    'Removed Owen Owner as Case Type Owner for Complaints.'
  );
  const [entry] = await page.client.listAccessLog({ account: 'owen' });
  assert.equal(entry.action, 'revoke');
  assert.equal(entry.reason, 'Handed the bank over.');
});

test('access: Remove is disabled with the reason while another held role needs the access', async () => {
  const page = live({ account: 'owen' });
  await flush();

  const reviewerRow = page
    .view()
    .querySelectorAll('.cora-access-role')
    .find((/** @type {any} */ row) =>
      row.textContent.startsWith('Reviewer, Complaints')
    );
  assert.match(
    reviewerRow.textContent,
    /Remove Case Type Owner for Complaints first\./
  );
  assert.equal(reviewerRow.querySelector('.cora-access-remove').disabled, true);
});

test('access: a Cancel closes the form without changing anything', async () => {
  const page = live({ account: 'owen' });
  await flush();

  fireEvent(
    button(page, 'Remove Owen Owner as Case Type Owner for Complaints'),
    'click'
  );
  fireEvent(button(page, 'Cancel'), 'click');

  assert.equal(page.state().routes.access.form.fixed, false);
  assert.deepEqual(await page.client.listUserGroups('owen'), [
    REVIEWERS_COMPLAINTS,
    'Reviewers',
    'CaseTypeOwner - Complaints',
  ]);
});

test('access: a group the Maintainer cannot change refuses the change and names it as the detail', async () => {
  const page = live({ account: 'bea', readOnlyGroups: ['Controls'] });
  await flush();

  choose(page, 'Role', 'controls');
  giveReason(page, 'Joins Controls.');
  fireEvent(button(page, 'Give Bea Newcomer Controls access'), 'click');
  await flush();

  const alert = getByRole(page.view(), 'alert').textContent;
  assert.match(alert, /Nothing was changed/);
  assert.match(alert, /you cannot change who is in Controls/);
  assert.deepEqual(await page.client.listUserGroups('bea'), []);
  assert.deepEqual(await page.client.listAccessLog({ account: 'bea' }), []);
  assert.ok(page.view().querySelector('textarea'), 'the form stays open');
});

test('access: a change that fails part way is logged as partly applied and the page shows what is held', async () => {
  const page = live({ account: 'bea' });
  await flush();
  const add = page.client.addGroupMember.bind(page.client);
  page.client.addGroupMember = async (
    /** @type {string} */ group,
    /** @type {string} */ account
  ) =>
    group === 'Reviewers' ? { ok: false, status: 500 } : add(group, account);

  choose(page, 'Role', 'reviewer');
  choose(page, 'Case Type', 'complaints');
  giveReason(page, 'Joins.');
  fireEvent(
    button(page, 'Give Bea Newcomer Reviewer access to Complaints'),
    'click'
  );
  await flush();

  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /status 500.*only part/
  );
  const view = page.view();
  assert.match(view.textContent, /Partly applied/);
  assert.match(
    view.querySelector('.cora-access-role--incomplete').textContent,
    /Reviewer, Complaints/
  );
});

test('access: the access log lists every outcome, newest first, in role language', async () => {
  const page = live({
    account: 'zara',
    accessLog: [
      {
        id: '1',
        account: 'zara',
        targetName: 'Zara Fields',
        action: 'grant',
        role: 'reviewer',
        caseType: 'complaints',
        reason: 'First.',
        changes: [],
        outcome: 'recorded',
        relatesTo: null,
        createdAt: '2026-10-01T09:00:00Z',
        createdBy: 'Robin',
      },
      {
        id: '2',
        account: 'zara',
        targetName: 'Zara Fields',
        action: 'revoke',
        role: 'mystery',
        caseType: '',
        reason:
          'Could not change Reviewers (status 500), so nothing was changed.',
        changes: [],
        outcome: 'not-applied',
        relatesTo: '1',
        createdAt: '2026-10-02T09:00:00Z',
        createdBy: '',
      },
    ],
  });
  await flush();

  const entries = [...page.view().querySelectorAll('.cora-access-log-entry')];
  assert.equal(entries.length, 2);
  assert.match(entries[0].textContent, /Not applied/);
  assert.match(entries[0].textContent, /Unknown, /);
  assert.match(entries[0].textContent, /status 500/);
  assert.match(
    entries[1].textContent,
    /Gave Zara Fields Reviewer access to Complaints/
  );
});

test('access: a person with no roles and no history says so', async () => {
  const page = live({ account: 'bea' });
  await flush();

  assert.match(
    page.view().textContent,
    /Bea Newcomer has no internal CORA roles\./
  );
  assert.match(page.view().textContent, /No access changes have been recorded/);
});

test('access: reads that fail are reported where they would have appeared', async () => {
  const client = new MockSharePointClient({ personas: {}, people: PEOPLE() });
  client.listUserGroups = async () => {
    throw new Error('HTTP 500');
  };
  client.listAccessLog = async () => {
    throw new Error('HTTP 500');
  };
  client.listGroupMembers = async () => {
    throw new Error('HTTP 500');
  };
  const page = live({ account: 'zara', client });
  await flush();

  const alerts = queryAllByRole(page.view(), 'alert').map(
    (el) => el.textContent
  );
  assert.ok(alerts.some((text) => /Their roles could not be read/.test(text)));
  assert.ok(alerts.some((text) => /access log could not be loaded/.test(text)));
  assert.ok(
    alerts.some((text) => /Reviewer, Complaints: could not be read/.test(text))
  );
});

test('access: a change that throws unexpectedly reports it and leaves the form usable', async () => {
  const page = live({ account: 'bea' });
  await flush();
  page.client.getGroupEditability = /** @type {any} */ (async () => null);

  choose(page, 'Role', 'controls');
  giveReason(page, 'Joins.');
  fireEvent(button(page, 'Give Bea Newcomer Controls access'), 'click');
  await flush();

  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /Nothing more was done/
  );
  assert.equal(
    button(page, 'Give Bea Newcomer Controls access').disabled,
    false
  );
});

test('access: leaving the page stops every late answer from landing, and an unread name falls back to the account', async () => {
  const client = new MockSharePointClient({ personas: {}, people: PEOPLE() });
  client.resolveUsers = async () => {
    throw new Error('HTTP 500');
  };
  const page = live({ account: 'zara', client });
  page.leave();
  await flush();

  assert.equal(page.state().routes.access.groups, undefined);
  assert.equal(page.state().routes.access.personName, 'zara');
});

test('access: with no client the page still draws and reads nothing', () => {
  const ctx = /** @type {any} */ ({
    client: null,
    chrome: makeChrome({ permissions: { isMaintainer: true } }),
    caseSources: [],
  });
  const slice = createRouteSlice({}, ctx);
  const cleanup = slice.start(
    /** @type {any} */ ({
      dispatch: () => {},
      context: ctx,
      isActive: () => true,
    })
  );
  assert.equal(typeof cleanup, 'function');
  assert.ok(slice.view(slice.initialState, { dispatch: () => {} }));
  cleanup();
});

test('access: an outcome for a query the user has typed past is dropped', () => {
  const slice = createRouteSlice(
    {},
    /** @type {any} */ ({
      client: null,
      chrome: makeChrome(),
      caseSources: [],
    })
  );
  let state = slice.reducer(slice.initialState, {
    type: 'access/person-query',
    query: 'be',
  });
  const stale = {
    query: 'b',
    people: [],
    status: /** @type {const} */ ('success'),
  };
  state = slice.reducer(state, {
    type: 'access/person-results',
    search: stale,
  });
  assert.equal(state.routes.access.personSearch.query, 'be');
  assert.equal(state.routes.access.personSearch.status, 'idle');
});

test('access: before its reads answer the page says it is loading roles and the access log', () => {
  const page = live({ account: 'zara' });
  const text = page.view().textContent;
  assert.match(text, /Loading roles/);
  assert.match(text, /Loading the access log/);
});
