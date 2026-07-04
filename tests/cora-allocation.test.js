// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { CORAAllocation } =
  await import('../src/components/sections/cora-allocation.js');

// ===== HELPERS =====

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @param {CaseRow[]} allCases */
function makeClient(allCases) {
  /** @type {{ id: string, fields: any, etag: string }[]} */
  const patchCalls = [];
  return {
    patchCalls,
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ filter
    ) {
      return allCases
        .filter((c) => {
          if (filter.status !== undefined && c.status !== filter.status)
            return false;
          if (
            filter.assignedReviewer !== undefined &&
            c.assignedReviewer !== filter.assignedReviewer
          )
            return false;
          if (filter.caseType !== undefined && c.caseType !== filter.caseType)
            return false;
          return true;
        })
        .map((c) => ({ ...c }));
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {Partial<CaseRow>} */ fields,
      /** @type {string} */ etag
    ) {
      patchCalls.push({ id, fields, etag });
      const c = allCases.find((c) => c.id === id);
      if (!c) return { ok: false, status: 404 };
      if (c.etag !== etag) return { ok: false, status: 412 };
      c.assignedReviewer = /** @type {string} */ (
        fields.assignedReviewer ?? c.assignedReviewer
      );
      const newEtag = etag + '-patched';
      c.etag = newEtag;
      return { ok: true, status: 200, data: { ...c, etag: newEtag } };
    },
  };
}

/** Unassigned example-review case with a given `created` timestamp. */
function unassignedCase(id = 'c1', created = '2026-01-01T00:00:00Z') {
  /** @type {CaseRow} */
  const c = {
    id,
    caseType: 'example-review',
    title: `Case ${id}`,
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    created,
    etag: `etag-${id}`,
  };
  return c;
}

// ===== TESTS =====

test('CORAAllocation: constructor initializes with default values', () => {
  const el = new CORAAllocation();
  assert.equal(el.client, null);
  assert.equal(el.currentUserId, '');
  assert.deepEqual(el.eligibleCaseTypes, []);
});

test('CORAAllocation: connectedCallback renders "Request next Case" button', async () => {
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (makeClient([]));
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];
  el.connectedCallback();
  const btn = /** @type {any} */ (el)._children[0];
  assert.ok(btn, 'should have a child element');
  assert.equal(btn.textContent, 'Request next Case');
});

test('CORAAllocation: disconnectedCallback is callable', () => {
  const el = new CORAAllocation();
  el.disconnectedCallback();
  // Should not throw
});

test('CORAAllocation: _requestNextCase assigns the oldest unassigned case and dispatches cora-allocated', async () => {
  const older = unassignedCase('c-older', '2026-01-01T00:00:00Z');
  const newer = unassignedCase('c-newer', '2026-06-01T00:00:00Z');
  const client = makeClient([older, newer]);

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  /** @type {any} */ (globalThis).location.hash = '';
  await el._requestNextCase();

  assert.equal(client.patchCalls.length, 1, 'should patch exactly once');
  assert.equal(
    client.patchCalls[0].id,
    'c-older',
    'should assign the oldest case first'
  );
  assert.deepEqual(client.patchCalls[0].fields, {
    assignedReviewer: 'user-reviewer',
  });
  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '',
    'should not navigate away'
  );
  assert.equal(dispatched.length, 1, 'should dispatch cora-allocated');
  assert.equal(dispatched[0].detail.caseId, 'c-older');
});

test('CORAAllocation: _requestNextCase retries with next case on 412 and dispatches cora-allocated for winner', async () => {
  const first = unassignedCase('c-first', '2026-01-01T00:00:00Z');
  const second = unassignedCase('c-second', '2026-06-01T00:00:00Z');

  // Inject a 412 on the first patchCase call only
  let callCount = 0;
  const client = {
    patchCalls: /** @type {{ id: string }[]} */ ([]),
    async listCases() {
      return [{ ...first }, { ...second }];
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      client.patchCalls.push({ id });
      callCount++;
      if (callCount === 1) return { ok: false, status: 412 };
      return { ok: true, status: 200, data: { ...second, etag } };
    },
  };

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  /** @type {any} */ (globalThis).location.hash = '';
  await el._requestNextCase();

  assert.equal(client.patchCalls.length, 2, 'should attempt two patches');
  assert.equal(
    client.patchCalls[0].id,
    'c-first',
    'first attempt is oldest case'
  );
  assert.equal(
    client.patchCalls[1].id,
    'c-second',
    'second attempt is next case'
  );
  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '',
    'should not navigate away'
  );
  assert.equal(
    dispatched.length,
    1,
    'should dispatch cora-allocated once for the winner'
  );
  assert.equal(dispatched[0].detail.caseId, 'c-second');
});

test('CORAAllocation: _requestNextCase shows "No Cases available" when no unassigned cases exist', async () => {
  const client = makeClient([]); // empty pool
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];

  await el._requestNextCase();

  const msg = /** @type {any} */ (el)._children[0];
  assert.ok(msg, 'should have a child element');
  assert.equal(msg.textContent, 'No Cases available');
});

test('CORAAllocation: _requestNextCase shows "No Cases available" when all retries receive 412', async () => {
  const first = unassignedCase('c-first', '2026-01-01T00:00:00Z');
  const second = unassignedCase('c-second', '2026-06-01T00:00:00Z');

  const client = {
    async listCases() {
      return [{ ...first }, { ...second }];
    },
    async patchCase() {
      return { ok: false, status: 412 };
    },
  };

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];

  await el._requestNextCase();

  const msg = /** @type {any} */ (el)._children[0];
  assert.equal(msg.textContent, 'No Cases available');
});

test('CORAAllocation: _requestNextCase only considers eligible case types', async () => {
  const eligibleCase = unassignedCase('c-eligible', '2026-01-01T00:00:00Z'); // example-review
  const ineligibleCase = /** @type {CaseRow} */ ({
    ...unassignedCase('c-ineligible', '2025-12-01T00:00:00Z'), // older but wrong type
    caseType: 'other-review',
  });
  const client = makeClient([ineligibleCase, eligibleCase]);

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review']; // only example-review eligible

  /** @type {any} */ (globalThis).location.hash = '';
  await el._requestNextCase();

  assert.equal(
    client.patchCalls.length,
    1,
    'should only patch the eligible case'
  );
  assert.equal(client.patchCalls[0].id, 'c-eligible');
});

test('CORAAllocation: patchCase is called with the correct etag', async () => {
  const c = unassignedCase('c1', '2026-01-01T00:00:00Z');
  c.etag = 'specific-etag';
  const client = makeClient([c]);

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];

  await el._requestNextCase();

  assert.equal(client.patchCalls[0].etag, 'specific-etag');
});

test('CORAAllocation: _requestNextCase does not navigate and dispatches cora-allocated event with caseId', async () => {
  const c = unassignedCase('c-nav', '2026-01-01T00:00:00Z');
  const client = makeClient([c]);

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  /** @type {any} */ (globalThis).location.hash = '';
  await el._requestNextCase();

  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '',
    'should NOT navigate away from dashboard'
  );
  assert.equal(
    dispatched.length,
    1,
    'should dispatch cora-allocated event once'
  );
  assert.equal(
    dispatched[0].detail.caseId,
    'c-nav',
    'event detail should carry the allocated case id'
  );
});

test('CORAAllocation: _getUnassignedCases returns empty array when client is null', async () => {
  const el = new CORAAllocation();
  el.client = null;
  el.eligibleCaseTypes = ['example-review'];
  const result = await el._getUnassignedCases();
  assert.deepEqual(result, []);
});

test('CORAAllocation: _requestNextCase returns early when client is null', async () => {
  const el = new CORAAllocation();
  el.client = null;
  await el._requestNextCase();
  // No error should occur
});

test('CORAAllocation: _getUnassignedCases filters out assigned cases', async () => {
  const c1 = unassignedCase('c1');
  const c2 = unassignedCase('c2');
  c2.assignedReviewer = 'someone';
  const client = makeClient([c1, c2]);
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.eligibleCaseTypes = ['example-review'];
  const result = await el._getUnassignedCases();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'c1');
});

test('CORAAllocation: _getUnassignedCases filters out ineligible case types', async () => {
  const c1 = unassignedCase('c1');
  const c2 = unassignedCase('c2');
  c2.caseType = 'unsupported-type';
  const client = makeClient([c1, c2]);
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.eligibleCaseTypes = ['example-review'];
  const result = await el._getUnassignedCases();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'c1');
});

test('CORAAllocation: _getUnassignedCases sorting handles equal or greater dates', async () => {
  const c1 = unassignedCase('c1', '2026-01-01');
  const c2 = unassignedCase('c2', '2026-01-01'); // Equal
  const c3 = unassignedCase('c3', '2026-01-02'); // Greater

  const client = makeClient([c3, c2, c1]);
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.eligibleCaseTypes = ['example-review'];

  const result = await el._getUnassignedCases();
  // c1 and c2 are equal, c3 is greater.
  // Sort should put c1, c2 before c3.
  assert.equal(result[2].id, 'c3');
});

test('CORAAllocation: _getUnassignedCases sorting handles smaller date', async () => {
  const c1 = unassignedCase('c1', '2026-01-02');
  const c2 = unassignedCase('c2', '2026-01-01');

  const client = makeClient([c1, c2]);
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.eligibleCaseTypes = ['example-review'];

  const result = await el._getUnassignedCases();
  assert.equal(result[0].id, 'c2');
  assert.equal(result[1].id, 'c1');
});

test('CORAAllocation: _renderEmpty shows "No Cases available"', () => {
  const el = new CORAAllocation();
  el._renderEmpty();
  const msg = /** @type {any} */ (el)._children[0];
  assert.equal(msg.textContent, 'No Cases available');
});

test('CORAAllocation: _getUnassignedCases handles null created via ?? fallback', async () => {
  const c1 = unassignedCase('c-no-created', '');
  const c2 = unassignedCase('c-with-created', '2026-01-01T00:00:00Z');
  // Set created to null on c1 to trigger the `?? ''` fallback in the sort comparator
  /** @type {any} */ (c1).created = null;
  const client = makeClient([c2, c1]);

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.eligibleCaseTypes = ['example-review'];

  const result = await el._getUnassignedCases();
  // null created sorts as '' which is less than '2026-...', so c1 comes first
  assert.equal(result.length, 2, 'both cases should be returned');
  assert.equal(
    result[0].id,
    'c-no-created',
    'null created falls back to empty string → sorts first'
  );
});

test('CORAAllocation: button click triggers _requestNextCase', async () => {
  const c = unassignedCase('c-btn', '2026-01-01T00:00:00Z');
  const client = makeClient([c]);

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['example-review'];
  el.connectedCallback();

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  const btn = /** @type {any} */ (el)._children[0];
  await btn._listeners['click'][0]();

  assert.equal(dispatched.length, 1, 'button click must trigger allocation');
  assert.equal(dispatched[0].detail.caseId, 'c-btn');
});
