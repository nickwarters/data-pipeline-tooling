// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const {
  PAGE_SIZE,
  appealColumns,
  controlsAppealsView,
  fetchOpenAppeals,
  openAppealOf,
} = await import('../src/pages/dashboard/controls-view.js');

/** @param {string} id @param {string} at */
function row(id, at) {
  return /** @type {import('../src/sharepoint-client.js').CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: `Case ${id}`,
    status: 'Completed',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: '2026-01-01T00:00:00Z',
    appeals: [
      {
        id: `appeal-${id}`,
        appellant: 'owner',
        at,
        rationale: 'Review requested',
        state: 'raised',
      },
    ],
    etag: 'e',
  });
}

test('Controls appeal action pages every source and globally orders oldest first', async () => {
  /** @type {any[]} */
  const calls = [];
  const pages = {
    A: Array.from({ length: PAGE_SIZE }, (_, index) =>
      row(`a-${index}`, '2026-02-01T00:00:00Z')
    ),
    B: [row('b-1', '2026-01-01T00:00:00Z')],
    C: [row('c-1', '2026-03-01T00:00:00Z')],
  };
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter, /** @type {any} */ options) {
      calls.push({ filter, options });
      if (options.listName === 'A' && options.skip === 0) return pages.A;
      if (options.listName === 'A') return [];
      return pages[/** @type {'B' | 'C'} */ (options.listName)];
    },
  });

  const result = await fetchOpenAppeals(client, [
    { slug: 'a', listName: 'A', displayName: 'A' },
    { slug: 'b', listName: 'B', displayName: 'B' },
    { slug: 'c', listName: 'C', displayName: 'C' },
  ]);

  assert.equal(result[0].id, 'b-1');
  assert.equal(result.at(-1)?.id, 'c-1');
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.filter.hasOpenAppeal));
  assert.deepEqual(calls.map((call) => call.options.listName).sort(), [
    'A',
    'A',
    'B',
    'C',
  ]);
});

test('Controls appeal descriptors render through the generic table and keep navigation', () => {
  const cases = [row('c1', '2026-01-01T00:00:00Z')];
  /** @type {string[]} */
  const sorts = [];
  const view = controlsAppealsView(
    cases,
    { key: 'raised', dir: 'asc' },
    (key) => sorts.push(key)
  );
  assert.equal(view.querySelector('h2')?.textContent, 'Outstanding Appeals');
  assert.equal(view.querySelector('table')?.getAttribute('role'), 'grid');
  assert.deepEqual(
    appealColumns().map((column) => column.key),
    [
      'reference',
      'caseType',
      'responsibleParty',
      'appellant',
      'raised',
      'rationale',
      'actions',
    ]
  );

  [...view.querySelectorAll('th')]
    .find((header) => header.querySelector('button'))
    ?.querySelector('button')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  assert.deepEqual(sorts, ['raised']);
  const open = [...view.querySelectorAll('button')].at(-1);
  open?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  assert.equal(location.hash, '#/case/complaints/c1');

  // Existing DOM-stub debt retained until the shared debt ledger can move.
  const table = /** @type {any} */ (view.querySelector('table'));
  assert.ok(table._children);
  assert.ok(table._children.length > 0);
  assert.ok(table._listeners.keydown);
  assert.ok(table._listeners.keydown.length === 1);
  assert.ok(/** @type {any} */ (open)._listeners.click);
  assert.ok(/** @type {any} */ (open)._listeners.click.length === 1);
});

test('Controls appeal descriptors degrade gracefully for resolved and incomplete appeal data', async () => {
  const resolved = {
    ...row('resolved', '2026-01-01T00:00:00Z'),
    title: '',
    appeals: [
      {
        id: 'resolved-appeal',
        appellant: 'owner',
        at: '2026-01-01T00:00:00Z',
        rationale: 'Done',
        state: 'resolved',
      },
    ],
  };
  assert.equal(openAppealOf(/** @type {any} */ (resolved)), null);
  assert.equal(
    openAppealOf(/** @type {any} */ ({ ...resolved, appeals: undefined })),
    null
  );
  assert.deepEqual(await fetchOpenAppeals(/** @type {any} */ ({}), []), []);

  const columns = appealColumns();
  const reference = columns.find((column) => column.key === 'reference');
  const appellant = columns.find((column) => column.key === 'appellant');
  const raised = columns.find((column) => column.key === 'raised');
  const rationale = columns.find((column) => column.key === 'rationale');
  assert.equal(
    /** @type {(row: any) => unknown} */ (reference?.value)(resolved),
    'resolved'
  );
  assert.equal(
    /** @type {(row: any) => unknown} */ (appellant?.value)(resolved),
    ''
  );
  assert.equal(
    /** @type {(row: any) => unknown} */ (raised?.value)(resolved),
    null
  );
  assert.equal(raised?.format?.(null, /** @type {any} */ (resolved)), '—');
  assert.equal(
    /** @type {(row: any) => unknown} */ (rationale?.value)(resolved),
    ''
  );
});
