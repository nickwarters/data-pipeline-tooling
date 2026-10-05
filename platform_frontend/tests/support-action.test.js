// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSupportAction } from '../src/services/support-action.js';
import { makeCaseRow } from './helpers/fixtures.js';

// Capability: a support action is logged before the Case changes, and a failed change is logged too.

/** @param {{ failLogAt?: number }} [options] */
function loggingClient({ failLogAt } = {}) {
  /** @type {any[]} */
  const entries = [];
  const client = /** @type {any} */ ({
    async addSupportLogEntry(/** @type {any} */ entry) {
      if (entries.length + 1 === failLogAt) throw new Error('HTTP 403');
      entries.push(entry);
      return String(entries.length);
    },
  });
  return { client, entries };
}

const ACTION = {
  row: makeCaseRow({ id: '7', caseType: 'complaints', title: 'CR-7' }),
  action: 'reassign',
  reason: 'On leave.',
  changes: [{ field: 'assignedReviewer', before: 'a', after: 'b' }],
};

test('a change that lands leaves one recorded entry naming the Case', async () => {
  const { client, entries } = loggingClient();

  const result = await runSupportAction(client, ACTION, async () => ({
    ok: true,
    status: 200,
  }));

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(entries, [
    {
      caseType: 'complaints',
      caseId: '7',
      caseReference: 'CR-7',
      action: 'reassign',
      reason: 'On leave.',
      changes: ACTION.changes,
      outcome: 'recorded',
      relatesTo: null,
    },
  ]);
});

test('a change that fails for any reason but a conflict is logged as not applied, naming its status', async () => {
  const { client, entries } = loggingClient();

  const result = await runSupportAction(client, ACTION, async () => ({
    ok: false,
    status: 500,
  }));

  assert.equal(result.ok, false);
  assert.equal(/** @type {any} */ (result).conflict, false);
  assert.match(/** @type {any} */ (result).message, /status 500/);
  assert.equal(entries[1].outcome, 'not-applied');
  assert.equal(entries[1].relatesTo, '1');
  assert.deepEqual(entries[1].changes, []);
});

test('a write that throws is treated as a change that did not apply', async () => {
  const { client, entries } = loggingClient();

  const result = await runSupportAction(client, ACTION, async () => {
    throw new Error('network down');
  });

  assert.equal(result.ok, false);
  assert.equal(entries[1].outcome, 'not-applied');
});

test('a failure the log cannot record is still reported, and says the log is incomplete', async () => {
  const { client } = loggingClient({ failLogAt: 2 });

  const result = await runSupportAction(client, ACTION, async () => ({
    ok: false,
    status: 412,
  }));

  assert.equal(/** @type {any} */ (result).conflict, true);
  assert.match(
    /** @type {any} */ (result).message,
    /could not record that it was not applied/
  );
});

test('when the log cannot be written first, the Case is never touched', async () => {
  const { client } = loggingClient({ failLogAt: 1 });
  let wrote = false;

  await assert.rejects(
    runSupportAction(client, ACTION, async () => {
      wrote = true;
      return { ok: true, status: 200 };
    }),
    /HTTP 403/
  );
  assert.equal(wrote, false);
});
