// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchLiveTailCases,
  liveTailWindow,
  LIVE_TAIL_MAX_DAYS,
} from '../src/services/live-tail-fetcher.js';
import { startOfLocalDay } from '../src/lib/local-calendar.js';

/**
 * @template T
 * @param {string} zone
 * @param {() => T} run
 * @returns {T}
 */
function inTimeZone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('liveTailWindow: starts the day after the published report ends', () => {
  const window = liveTailWindow('2026-08-07', '2026-08-10');

  assert.equal(window?.from, '2026-08-08');
});

test('liveTailWindow: never reaches further back than the clamp', () => {
  const window = liveTailWindow('2025-01-01', '2026-08-10');

  assert.equal(LIVE_TAIL_MAX_DAYS, 10);
  // Ten days counting today, so 1 August through 10 August.
  assert.equal(window?.from, '2026-08-01');
});

test('liveTailWindow: an unusable boundary is clamped, not trusted', () => {
  for (const boundary of [null, undefined, '', 'yesterday', '2026-8-7']) {
    assert.equal(
      liveTailWindow(boundary, '2026-08-10')?.from,
      '2026-08-01',
      `${String(boundary)} should fall back to the clamp`
    );
  }
});

test('liveTailWindow: a report already complete through today asks for nothing', () => {
  assert.equal(liveTailWindow('2026-08-10', '2026-08-10'), null);
  assert.equal(liveTailWindow('2026-08-12', '2026-08-10'), null);
});

test('liveTailWindow: the bounds are the local start of the first day and of tomorrow', () => {
  const tokyo = inTimeZone('Asia/Tokyo', () =>
    liveTailWindow('2026-08-07', '2026-08-10')
  );
  const losAngeles = inTimeZone('America/Los_Angeles', () =>
    liveTailWindow('2026-08-07', '2026-08-10')
  );

  assert.deepEqual(
    [tokyo?.reportableAfter, tokyo?.reportableBefore],
    ['2026-08-07T15:00:00.000Z', '2026-08-10T15:00:00.000Z']
  );
  assert.deepEqual(
    [losAngeles?.reportableAfter, losAngeles?.reportableBefore],
    ['2026-08-08T07:00:00.000Z', '2026-08-11T07:00:00.000Z']
  );
});

test('liveTailWindow: the window covers exactly the days it names, in any zone', () => {
  for (const zone of [
    'Pacific/Kiritimati',
    'Asia/Tokyo',
    'Europe/London',
    'America/Los_Angeles',
    'Pacific/Midway',
  ]) {
    inTimeZone(zone, () => {
      const window = /** @type {any} */ (
        liveTailWindow('2026-08-07', '2026-08-10')
      );
      assert.equal(
        window.reportableAfter,
        startOfLocalDay('2026-08-08').toISOString(),
        `lower bound in ${zone}`
      );
      assert.equal(
        window.reportableBefore,
        startOfLocalDay('2026-08-11').toISOString(),
        `upper bound in ${zone}`
      );
    });
  }
});

test('fetchLiveTailCases: one scoped, bounded request per Case Type list', async () => {
  /** @type {any[]} */
  const calls = [];
  const client = /** @type {any} */ ({
    listCases: async (
      /** @type {any} */ filter,
      /** @type {any} */ options
    ) => {
      calls.push({ filter, options });
      return [{ id: `${options.listName}-1` }];
    },
  });

  const rows = await fetchLiveTailCases(
    client,
    'reviewer-1',
    /** @type {any} */ ([
      { slug: 'complaints', listName: 'Cases-complaints' },
      { slug: 'conduct', listName: 'Cases-conduct' },
    ]),
    {
      reportableAfter: '2026-08-07T23:00:00.000Z',
      reportableBefore: '2026-08-10T23:00:00.000Z',
    }
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ['Cases-complaints-1', 'Cases-conduct-1']
  );
  assert.deepEqual(calls[0].options, { listName: 'Cases-complaints' });
  assert.deepEqual(calls[0].filter, {
    caseType: 'complaints',
    assignedReviewer: 'reviewer-1',
    reportableAfter: '2026-08-07T23:00:00.000Z',
    reportableBefore: '2026-08-10T23:00:00.000Z',
    anyOf: [{ status: 'Actions In Progress' }, { status: 'Completed' }],
  });
  assert.equal(calls[1].filter.caseType, 'conduct');
  // No page size: the window is the bound, and a `top` here would quietly
  // undercount a busy week rather than fail.
  assert.equal(calls[0].options.top, undefined);
  // No signal either — the caller binds the mount lifetime to the client.
  assert.equal(calls[0].options.signal, undefined);
});
