// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppealEffects } from '../src/pages/cora-case-review/appeal-effects.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { SaveQueue } from '../src/services/save-queue.js';
import { makeCaseRow } from './helpers/fixtures.js';

const CASE_ROW = makeCaseRow({
  id: 'c1',
  caseType: 'example-review',
  title: 'Case',
  status: 'Completed',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  completedAt: '2026-07-01T00:00:00.000Z',
  outcomeAtCompletion: 'fail',
  hadRemediation: true,
  etag: 'e1',
});

const SNAPSHOT = { currentUser: { id: 'controls-1' }, caseRow: CASE_ROW };

/** Collect everything an effect run does, with both clock seams pinned. */
function harness() {
  /** @type {Array<{ kind: string, id: string, field?: string, value: any }>} */
  const writes = [];
  /** @type {any[]} */
  const dispatched = [];
  /**
   * The Case Rows the effects produced, read back where the single owner keeps
   * them: the store. There is no second channel — the loader's copy is not
   * updated, and nothing re-reads it.
   * @returns {any[]}
   */
  const storeRows = () => dispatched.map((action) => action.snapshot.caseRow);
  const effects = createAppealEffects({
    saveQueue: /** @type {any} */ ({
      enqueue: (
        /** @type {string} */ id,
        /** @type {string} */ field,
        /** @type {any} */ value
      ) => writes.push({ kind: 'enqueue', id, field, value }),
      enqueueFields: (/** @type {string} */ id, /** @type {any} */ value) =>
        writes.push({ kind: 'enqueueFields', id, value }),
    }),
    caseId: () => 'c1',
    dispatch: (action) => dispatched.push(action),
    now: () => new Date('2026-07-23T09:30:00.000Z'),
    newId: (prefix) => `${prefix}-fixed`,
  });
  return { effects, writes, dispatched, storeRows };
}

test('raising an Appeal stamps the injected clock and id, and enqueues only appeals', () => {
  const { effects, writes, dispatched, storeRows } = harness();

  effects.raise({
    caseRow: CASE_ROW,
    snapshot: SNAPSHOT,
    rationale: 'The result is wrong.',
    citedAnswerKeys: ['q1'],
  });

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    kind: 'enqueue',
    id: 'c1',
    field: 'appeals',
    value: [
      {
        id: 'appeal-fixed',
        appellant: 'controls-1',
        at: '2026-07-23T09:30:00.000Z',
        rationale: 'The result is wrong.',
        state: 'raised',
        citedAnswerKeys: ['q1'],
      },
    ],
  });
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'case/model-changed');
  assert.equal(storeRows().length, 1);
  assert.deepEqual(storeRows()[0].appeals, writes[0].value);
});

test('rejecting an Appeal writes appeals alone; agreeing writes the corrected columns atomically', () => {
  const raised = harness();
  raised.effects.raise({
    caseRow: CASE_ROW,
    snapshot: SNAPSHOT,
    rationale: 'Wrong.',
    citedAnswerKeys: [],
  });
  const appealedRow = raised.storeRows()[0];

  const rejected = harness();
  rejected.effects.resolve({
    caseRow: appealedRow,
    snapshot: SNAPSHOT,
    resolution: {
      appealId: 'appeal-fixed',
      verdict: 'rejected',
      rationale: 'Original stands.',
    },
  });
  assert.equal(rejected.writes.length, 1);
  assert.equal(rejected.writes[0].kind, 'enqueue');
  assert.equal(rejected.writes[0].field, 'appeals');
  assert.equal(rejected.writes[0].value[0].state, 'resolved');
  assert.deepEqual(rejected.writes[0].value[0].resolution, {
    verdict: 'rejected',
    rationale: 'Original stands.',
    resolver: 'controls-1',
    at: '2026-07-23T09:30:00.000Z',
  });

  const agreed = harness();
  agreed.effects.resolve({
    caseRow: appealedRow,
    snapshot: SNAPSHOT,
    resolution: {
      appealId: 'appeal-fixed',
      verdict: 'agreed',
      rationale: 'Upheld.',
      outcome: 'pass',
      justification: 'Evidence reconsidered.',
    },
  });
  // One atomic multi-field write: the appeal and every corrected-reporting
  // column travel in the same PATCH.
  assert.equal(agreed.writes.length, 1);
  assert.equal(agreed.writes[0].kind, 'enqueueFields');
  assert.equal(agreed.writes[0].id, 'c1');
  assert.equal(agreed.writes[0].value.effectiveOutcome, 'pass');
  assert.equal(agreed.writes[0].value.outcomeOverridden, true);
  assert.ok(Array.isArray(agreed.writes[0].value.appeals));
  assert.equal(
    agreed.writes[0].value.amendedOutcome.amendedAt,
    '2026-07-23T09:30:00.000Z'
  );
  assert.equal(
    agreed.writes[0].value.amendedOutcome.fromAppealId,
    'appeal-fixed'
  );
});

test('amending an Outcome writes the amendment fields atomically with the injected clock', () => {
  const { effects, writes, dispatched, storeRows } = harness();

  effects.amend({
    caseRow: CASE_ROW,
    snapshot: SNAPSHOT,
    outcome: 'pass',
    justification: 'Corrected on review.',
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].kind, 'enqueueFields');
  assert.equal(writes[0].id, 'c1');
  assert.equal(writes[0].value.effectiveOutcome, 'pass');
  assert.equal(writes[0].value.outcomeOverridden, true);
  assert.deepEqual(writes[0].value.amendedOutcome, {
    outcome: 'pass',
    justification: 'Corrected on review.',
    amendedBy: 'controls-1',
    amendedAt: '2026-07-23T09:30:00.000Z',
  });
  assert.equal(dispatched[0].type, 'case/model-changed');
  assert.equal(storeRows()[0].effectiveOutcome, 'pass');
});

/**
 * @param {{ now?: () => Date }} [options]
 * @param {any} [snapshot]
 */
function raiseWithDefaults(options = {}, snapshot = SNAPSHOT) {
  /** @type {any[]} */
  const writes = [];
  createAppealEffects({
    saveQueue: /** @type {any} */ ({
      enqueue: (
        /** @type {string} */ _id,
        /** @type {string} */ _field,
        /** @type {any} */ value
      ) => writes.push(value),
      enqueueFields: () => {},
    }),
    caseId: () => 'c1',
    dispatch: () => {},
    ...options,
  }).raise({
    caseRow: CASE_ROW,
    snapshot,
    rationale: 'Wrong.',
    citedAnswerKeys: [],
  });
  return writes[0][0];
}

test('the default id minter derives from the injected clock, so no seam reaches the global one', () => {
  const appeal = raiseWithDefaults({
    now: () => new Date('2026-07-23T09:30:00.000Z'),
  });

  assert.equal(
    appeal.id,
    `appeal-${new Date('2026-07-23T09:30:00.000Z').getTime()}`
  );
});

test('both clock seams default to the wall clock, and an unresolved viewer stamps an empty appellant', () => {
  const before = Date.now();
  const appeal = raiseWithDefaults({}, { currentUser: null });
  const after = Date.now();

  assert.equal(appeal.appellant, '');
  const at = Date.parse(appeal.at);
  assert.ok(
    at >= before && at <= after,
    `${appeal.at} is not between the reads`
  );
  assert.match(appeal.id, /^appeal-\d+$/);
});

test('round trip: raise, resolve and amend land on the persisted row through the real SaveQueue', async () => {
  const client = new MockSharePointClient({
    personas: {},
    lists: { Cases: [{ ...CASE_ROW }] },
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  const opts = { listName: 'Cases' };
  saveQueue.loadCase(
    /** @type {any} */ (await client.getCase('c1', opts)),
    opts
  );
  /** @type {import('../src/sharepoint-client.js').CaseRow} */
  let row = { ...CASE_ROW };
  const effects = createAppealEffects({
    saveQueue,
    caseId: () => 'c1',
    // The store is the owner, so the row each transition produces comes back
    // through the dispatch — the way the route's reducer receives it.
    dispatch: (action) => {
      row = /** @type {any} */ (action.snapshot).caseRow;
    },
    now: () => new Date('2026-07-23T09:30:00.000Z'),
    newId: (prefix) => `${prefix}-1`,
  });
  const snapshot = { currentUser: { id: 'controls-1' } };
  const persisted = () => client.snapshot().lists.Cases[0];

  effects.raise({
    caseRow: row,
    snapshot,
    rationale: 'The result is wrong.',
    citedAnswerKeys: ['q1'],
  });
  await saveQueue.whenIdle();
  assert.equal(persisted().appeals?.[0].state, 'raised');
  assert.equal(persisted().appeals?.[0].id, 'appeal-1');

  effects.resolve({
    caseRow: row,
    snapshot,
    resolution: {
      appealId: 'appeal-1',
      verdict: 'agreed',
      rationale: 'Upheld.',
      outcome: 'pass',
      justification: 'Evidence reconsidered.',
    },
  });
  await saveQueue.whenIdle();
  assert.equal(persisted().appeals?.[0].state, 'resolved');
  // The resolution and the corrected-reporting columns are on the row together
  // — the agreed branch's single atomic PATCH.
  assert.equal(persisted().effectiveOutcome, 'pass');
  assert.equal(persisted().effectiveHadRemediation, true);
  assert.equal(persisted().outcomeOverridden, true);
  assert.equal(persisted().amendedOutcome?.fromAppealId, 'appeal-1');

  effects.amend({
    caseRow: row,
    snapshot,
    outcome: 'fail',
    justification: 'Corrected again.',
  });
  await saveQueue.whenIdle();
  assert.equal(persisted().effectiveOutcome, 'fail');
  assert.equal(persisted().amendedOutcome?.justification, 'Corrected again.');
  // Nothing in this flow touches the frozen completion snapshot.
  assert.equal(persisted().outcomeAtCompletion, 'fail');
  assert.equal(persisted().completedAt, '2026-07-01T00:00:00.000Z');
});
