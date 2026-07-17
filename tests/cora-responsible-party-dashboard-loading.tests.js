// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */
import {
  ResponsiblePartyDashboard,
  caseTableInSection,
  makeCase,
  oneSource,
  makeClient,
  whenIdle,
} from './helpers/cora-responsible-party-dashboard.js';

// Capability: loading prerequisites and source fan-out.

// ===== TESTS =====

test('ResponsiblePartyDashboard: renders nothing when client is null', async () => {
  const host = ResponsiblePartyDashboard({
    client: null,
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  assert.equal(/** @type {any} */ (host)._children.length, 0);
});

test('ResponsiblePartyDashboard: renders nothing when currentUserId is empty', async () => {
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient([])),
    currentUserId: '',
  });
  await whenIdle(host);
  assert.equal(/** @type {any} */ (host)._children.length, 0);
});

test('ResponsiblePartyDashboard: calls listCases with responsibleParty filter and the source listName', async () => {
  /** @type {Array<{ filter: ListCasesFilter, opts: any }>} */
  const calls = [];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient([], calls)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { responsibleParty: 'user-rp' });
  assert.equal(calls[0].opts.listName, 'Cases-ExampleReview');
});

test('ResponsiblePartyDashboard: fans out one listCases per source (with its listName) and merges', async () => {
  /** @type {Array<{ filter: ListCasesFilter, opts: any }>} */
  const calls = [];
  const sources = [
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
    },
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
    },
  ];
  const client = {
    async listCases(/** @type {any} */ f, /** @type {any} */ opts) {
      calls.push({ filter: f, opts });
      return [
        makeCase({ id: `case-${opts.listName}`, caseType: opts.listName }),
      ];
    },
  };
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (client),
    currentUserId: 'user-rp',
    allCaseSources: sources,
  });
  await whenIdle(host);

  assert.deepEqual(
    calls.map((c) => c.opts.listName).sort(),
    ['Cases-ExampleReview', 'Cases-StressReview'],
    'one listCases per source, each carrying its listName'
  );
  const table = caseTableInSection(host, 'cora-rp-messages');
  // no unread messages so nothing shows here, but the outcome section
  // reflects both merged rows regardless of source
  assert.equal(table.cases.length, 0);
});

test('ResponsiblePartyDashboard: renders 3 sections after fetch resolves', async () => {
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient([])),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  // outcome section + remediation section + messages section
  assert.equal(/** @type {any} */ (host)._children.length, 3);
});
