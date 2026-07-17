// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ResponsiblePartyDashboard,
  todayStart,
  makeCase,
  oneSource,
  makeClient,
  outcomeTotal,
  outcomeCount,
  outcomeMonthRow,
  whenIdle,
} from './helpers/cora-responsible-party-dashboard.js';

// Capability: twelve-month outcome summaries.

test('ResponsiblePartyDashboard: outcome summary includes completed cases within last 12 months', async () => {
  const recentMonth = new Date(todayStart);
  recentMonth.setMonth(recentMonth.getMonth() - 2);
  const cases = [
    makeCase({
      id: 'c1',
      status: 'Completed',
      completedAt: recentMonth.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: recentMonth.toISOString(),
      outcome: 'Fail',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  assert.equal(outcomeTotal(host), 2);
});

test('ResponsiblePartyDashboard: outcome summary excludes completed cases older than 12 months', async () => {
  const old = new Date(todayStart);
  old.setMonth(old.getMonth() - 13);
  const recent = new Date(todayStart);
  recent.setMonth(recent.getMonth() - 1);
  const cases = [
    makeCase({
      id: 'c1',
      status: 'Completed',
      completedAt: old.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: recent.toISOString(),
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  assert.equal(outcomeTotal(host), 1, 'only the recent case counts');
});

test('ResponsiblePartyDashboard: outcome summary excludes in-progress cases', async () => {
  const cases = [
    makeCase({ id: 'c1', status: 'In-progress', completedAt: null }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  assert.equal(outcomeTotal(host), 1);
});

test('ResponsiblePartyDashboard: outcome summary groups by outcome type', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c3',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Fail',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  assert.equal(outcomeCount(host, 'Pass'), 2);
  assert.equal(outcomeCount(host, 'Fail'), 1);
});

test('ResponsiblePartyDashboard: two completed cases in same month+outcome increments count (covers ?? 0 and !monthMap[month] false branch)', async () => {
  const recentMonth = new Date();
  recentMonth.setDate(1);
  const iso = recentMonth.toISOString().slice(0, 10);

  const cases = [
    makeCase({
      id: 'c1',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: `${iso}T10:00:00Z`,
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: `${iso}T11:00:00Z`,
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);

  assert.equal(outcomeTotal(host), 2);
  assert.equal(
    outcomeCount(host, 'Pass'),
    2,
    'two cases with same outcome increment count'
  );
  const month = iso.slice(0, 7);
  const monthRow = outcomeMonthRow(host, month);
  assert.equal(
    monthRow?.['Pass'],
    2,
    'same outcome in same month accumulates count'
  );
});

test('ResponsiblePartyDashboard: case with null outcome uses "Unknown" label', async () => {
  const recentMonth = new Date();
  recentMonth.setDate(1);
  const iso = recentMonth.toISOString().slice(0, 10);

  const cases = [
    makeCase({
      id: 'c1',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: `${iso}T10:00:00Z`,
      outcome: /** @type {any} */ (null),
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);

  assert.equal(
    outcomeCount(host, 'Unknown'),
    1,
    'null outcome falls back to "Unknown" label'
  );
});

test('ResponsiblePartyDashboard: months are sorted chronologically and a month missing an outcome renders 0', async () => {
  // Three distinct months, inserted out of chronological order (earliest,
  // latest, middle) so Array.prototype.sort's comparator is exercised in
  // both directions (a < b and a >= b) while sorting by month string.
  const earliestMonth = new Date(todayStart);
  earliestMonth.setMonth(earliestMonth.getMonth() - 3);
  earliestMonth.setDate(1);
  const latestMonth = new Date(todayStart);
  latestMonth.setMonth(latestMonth.getMonth() - 1);
  latestMonth.setDate(1);
  const middleMonth = new Date(todayStart);
  middleMonth.setMonth(middleMonth.getMonth() - 2);
  middleMonth.setDate(1);

  const cases = [
    makeCase({
      id: 'c1',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: earliestMonth.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: latestMonth.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c3',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: latestMonth.toISOString(),
      outcome: 'Fail',
    }),
    // Middle month is missing the "Fail" outcome, so its table cell must
    // fall back to 0.
    makeCase({
      id: 'c4',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: middleMonth.toISOString(),
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);

  const middleRow = outcomeMonthRow(
    host,
    middleMonth.toISOString().slice(0, 7)
  );
  assert.equal(
    middleRow?.['Fail'],
    0,
    'month missing an outcome renders 0 for that column'
  );

  const latestRow = outcomeMonthRow(
    host,
    latestMonth.toISOString().slice(0, 7)
  );
  assert.equal(latestRow?.['Pass'], 1);
  assert.equal(latestRow?.['Fail'], 1);

  const earliestRow = outcomeMonthRow(
    host,
    earliestMonth.toISOString().slice(0, 7)
  );
  assert.equal(earliestRow?.['Pass'], 1);
});
