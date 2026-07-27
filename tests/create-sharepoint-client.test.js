// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSharePointClient,
  partitionCasesByList,
} from '../src/services/create-sharepoint-client.js';

test('createSharePointClient: returns a Promise', () => {
  const result = createSharePointClient(new URLSearchParams(''));
  assert.ok(result instanceof Promise, 'should return a Promise');
  return result.then(() => {});
});

test('createSharePointClient: returns an object satisfying SharePointClient when mock=0', async () => {
  const client = await createSharePointClient(new URLSearchParams(''));
  assert.equal(typeof client.getCurrentUser, 'function');
  assert.equal(typeof client.getCurrentUserGroups, 'function');
  assert.equal(typeof client.getCase, 'function');
  assert.equal(typeof client.listCases, 'function');
  assert.equal(typeof client.patchCase, 'function');
  assert.equal(typeof client.listRoadmapItems, 'function');
});

test('createSharePointClient: returns a MockSharePointClient when mock=1', async () => {
  const { MockSharePointClient } =
    await import('../src/services/mock-sharepoint-client.js');
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  assert.ok(
    client instanceof MockSharePointClient,
    'should be a MockSharePointClient'
  );
});

test('createSharePointClient: returns an HttpSharePointClient when mock param is absent', async () => {
  const { HttpSharePointClient } =
    await import('../src/services/http-sharepoint-client.js');
  const client = await createSharePointClient(new URLSearchParams(''));
  assert.ok(
    client instanceof HttpSharePointClient,
    'should be an HttpSharePointClient'
  );
});

test('createSharePointClient: mock client uses asUser persona', async () => {
  const client = await createSharePointClient(
    new URLSearchParams('mock=1&asUser=owner')
  );
  // owner persona exists in fixtures/personas.js
  const user = await client.getCurrentUser();
  assert.ok(user.id, 'should return a user from the owner persona');
});

test('createSharePointClient: mock client defaults to reviewer persona when asUser is absent', async () => {
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  const user = await client.getCurrentUser();
  assert.ok(user.id, 'should return a user from the default reviewer persona');
});

test('createSharePointClient: mock client serves list-backed Case Types (issue #249)', async () => {
  const client = await createSharePointClient(new URLSearchParams('mock=1'));

  // complaints declares its own list (Cases-Complaints). Its Cases must be
  // readable list-scoped.
  const listScoped = await client.getCase('complaints-case-1', {
    listName: 'Cases-Complaints',
  });
  assert.ok(listScoped, 'list-backed Case is readable via its listName');
  assert.equal(listScoped?.caseType, 'complaints');

  // …and reading a list surfaces it (there is no default store to fall back
  // to — a read without listName now throws).
  const inList = await client.listCases({}, { listName: 'Cases-Complaints' });
  assert.ok(
    inList.some((c) => c.id === 'complaints-case-1'),
    'list-backed Case appears in its list-scoped listCases'
  );

  // There is no default store: a Case read without a listName fails loudly.
  await assert.rejects(
    () => client.getCase('complaints-case-1'),
    /listName is required/
  );
});

test('partitionCasesByList: routes every Case to its named list store (total, no default bucket)', async () => {
  /** @type {any} */
  const cases = [
    { id: 'a', caseType: 'alpha', answers: {} },
    { id: 'b', caseType: 'beta', answers: {} },
    { id: 'a2', caseType: 'alpha', answers: {} },
  ];
  /** @param {string} slug */
  const loadCaseTypeConfig = async (slug) =>
    /** @type {any} */ ({
      listName: slug === 'alpha' ? 'Cases-Alpha' : 'Cases-Beta',
    });

  const lists = await partitionCasesByList(cases, loadCaseTypeConfig);

  assert.deepEqual(
    lists['Cases-Alpha'].map((c) => c.id),
    ['a', 'a2']
  );
  assert.deepEqual(
    lists['Cases-Beta'].map((c) => c.id),
    ['b']
  );
});

/**
 * Run `fn` with `console.error` captured, returning what it logged. The
 * containment path reports to the console and takes no reporter seam, so this
 * is how a test reads what it said — and it keeps a deliberate failure from
 * printing noise into an otherwise clean run.
 *
 * @param {() => Promise<any>} fn
 * @returns {Promise<{ result: any, logged: any[][] }>}
 */
async function captureConsoleError(fn) {
  const original = console.error;
  /** @type {any[][]} */
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

test('partitionCasesByList: contains a Case Type whose config declares no listName', async () => {
  /** @type {any} */
  const cases = [
    { id: 'a', caseType: 'listless', answers: {} },
    { id: 'b', caseType: 'beta', answers: {} },
  ];
  /** @param {string} slug */
  const loadCaseTypeConfig = async (slug) =>
    /** @type {any} */ (slug === 'beta' ? { listName: 'Cases-Beta' } : {});

  const { result: lists, logged } = await captureConsoleError(() =>
    partitionCasesByList(cases, loadCaseTypeConfig)
  );

  assert.deepEqual(
    Object.keys(lists),
    ['Cases-Beta'],
    'the good type survives'
  );
  assert.equal(logged.length, 1, 'the listless Case Type is reported');
  assert.ok(
    logged[0].some((arg) => String(arg).includes('listless')),
    'the report names the Case Type'
  );
  assert.ok(
    logged[0].some((arg) => /declares no listName/.test(String(arg?.message))),
    'and carries the reason'
  );
});

test('partitionCasesByList: a Case Type module that throws costs only its own Cases (#493)', async () => {
  // ?mock=1 boot ran this 33 lines BEFORE #493's containment, inside
  // `createSharePointClient`, so a Case Type module that throws still took the
  // whole app down in the dev loop — in the feature whose entire point is that
  // boot survives one.
  /** @type {any} */
  const cases = [
    { id: 'a', caseType: 'boom', answers: {} },
    { id: 'b', caseType: 'beta', answers: {} },
  ];
  /** @param {string} slug */
  const loadCaseTypeConfig = async (slug) => {
    if (slug === 'boom') throw new SyntaxError('boom is broken');
    return /** @type {any} */ ({ listName: 'Cases-Beta' });
  };
  const { result: lists, logged } = await captureConsoleError(() =>
    partitionCasesByList(cases, loadCaseTypeConfig)
  );

  assert.deepEqual(Object.keys(lists), ['Cases-Beta']);
  assert.deepEqual(
    lists['Cases-Beta'].map((/** @type {any} */ c) => c.id),
    ['b']
  );
  // The raw error must still reach whoever fixes it, not just the Case count.
  assert.equal(logged.length, 1);
  assert.ok(logged[0].some((arg) => String(arg).includes('boom')));
  assert.ok(logged[0].some((arg) => arg instanceof SyntaxError));
});

test('partitionCasesByList: a Case Type contained here yields no list at all', async () => {
  // Dropping never widens access: with no listName there is no store, and there
  // is no default bucket to pool the Cases into (#249).
  /** @type {any} */
  const cases = [{ id: 'a', caseType: 'boom', answers: {} }];

  const { result: lists } = await captureConsoleError(() =>
    partitionCasesByList(cases, async () => {
      throw new SyntaxError('boom is broken');
    })
  );

  assert.deepEqual(lists, {}, 'no Cases, and no throw');
});

test('createSharePointClient: passes the environment listPrefix and exportBasePath to the HTTP client (#366)', async () => {
  const { resolveEnvironment } = await import('../src/config/environment.js');
  const client = /** @type {any} */ (
    await createSharePointClient(
      new URLSearchParams(''),
      resolveEnvironment('uat')
    )
  );
  assert.equal(client._listPrefix, 'uat_');
  assert.equal(
    client._exportBasePath,
    '/Style%20Library/case-review-uat/case-types'
  );
});

test('createSharePointClient: defaults to the prod environment (#366)', async () => {
  const client = /** @type {any} */ (
    await createSharePointClient(new URLSearchParams(''))
  );
  assert.equal(client._listPrefix, '');
  assert.equal(
    client._exportBasePath,
    '/Style%20Library/case-review/case-types'
  );
});

test('createSharePointClient: environment does not affect the mock client (#366)', async () => {
  const { MockSharePointClient } =
    await import('../src/services/mock-sharepoint-client.js');
  const { resolveEnvironment } = await import('../src/config/environment.js');
  const client = await createSharePointClient(
    new URLSearchParams('mock=1'),
    resolveEnvironment('uat')
  );
  assert.ok(client instanceof MockSharePointClient);
});

test('createSharePointClient: HTTP client scopes API calls to the host web via _spPageContextInfo (#464)', async () => {
  // On a site-path deployment (e.g. /sites/cora) a root-relative
  // `/_api/web/currentUser` hits the web application root, where the user has
  // no access — an NTLM 401 credential-prompt loop at boot. The client must
  // take its webUrl from the SharePoint host page context.
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  g._spPageContextInfo = { webServerRelativeUrl: '/sites/cora' };
  try {
    const client = /** @type {any} */ (
      await createSharePointClient(new URLSearchParams(''))
    );
    assert.equal(client._webUrl, '/sites/cora');
  } finally {
    delete g._spPageContextInfo;
  }
});

test('createSharePointClient: falls back to webAbsoluteUrl when webServerRelativeUrl is absent (#464)', async () => {
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  g._spPageContextInfo = {
    webAbsoluteUrl: 'https://sp.example.com/sites/cora',
  };
  try {
    const client = /** @type {any} */ (
      await createSharePointClient(new URLSearchParams(''))
    );
    assert.equal(client._webUrl, 'https://sp.example.com/sites/cora');
  } finally {
    delete g._spPageContextInfo;
  }
});

test('createSharePointClient: webUrl is empty when no SharePoint page context exists (#464)', async () => {
  // Dev loop / non-SharePoint host: root-relative URLs are the best available
  // guess and preserve the pre-fix behaviour.
  const client = /** @type {any} */ (
    await createSharePointClient(new URLSearchParams(''))
  );
  assert.equal(client._webUrl, '');
});

test('createSharePointClient: a root-web page context yields an empty webUrl, not a bare slash (#464)', async () => {
  // _spPageContextInfo.webServerRelativeUrl is '/' at a root site; the client
  // constructor strips trailing slashes so URLs never double up.
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  g._spPageContextInfo = { webServerRelativeUrl: '/' };
  try {
    const client = /** @type {any} */ (
      await createSharePointClient(new URLSearchParams(''))
    );
    assert.equal(client._webUrl, '');
  } finally {
    delete g._spPageContextInfo;
  }
});

test('createSharePointClient: mock client searchPeople is backed by the people fixture', async () => {
  const { people } = await import('../dev/fixtures/people.js');
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  const sample = people[0];
  const results = await client.searchPeople(sample.displayName.split(' ')[0]);
  assert.ok(
    results.length > 0,
    'fixture-backed search returns at least one match'
  );
  assert.ok(
    results.every(
      (r) => typeof r.loginName === 'string' && r.loginName.length > 0
    )
  );
});

test('createSharePointClient: mock client serves roadmap fixtures', async () => {
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  const rows = await client.listRoadmapItems();
  assert.ok(rows.length >= 3);
  assert.deepEqual(
    new Set(rows.map((row) => row.status)),
    new Set(['LIVE', 'IN PROGRESS', 'UPCOMING'])
  );
});
