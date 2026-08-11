// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole, tableHeaders } from './helpers/semantic-dom.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { PAGE_SIZE, appealColumns, controlsAppealsView, fetchOpenAppeals } =
  await import('../src/pages/dashboard/controls-view.js');

/** @param {string} id @param {string} at */
function row(id, at) {
  return makeCaseRow({
    id,
    title: `Case ${id}`,
    status: 'Completed',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
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

  // Reference and Case Type are interactive here as on every other Case table;
  // `Raised` keeps the table's default sort, unmoved.
  assert.deepEqual(tableHeaders(view), [
    ['Reference', 'none', true],
    ['Case Type', 'none', true],
    ['Responsible Party', 'none', false],
    ['Appellant', 'none', false],
    ['Raised', 'ascending', true],
    ['Appellant rationale', 'none', false],
    ['Actions', 'none', false],
  ]);

  fireEvent(getByRole(view, 'button', { name: 'Raised' }), 'click');
  assert.deepEqual(sorts, ['raised']);
  // This table opens the Case, so `Open ${reference}` is the right name and
  // stays the default.
  const open = getByRole(view, 'button', { name: 'Open Case c1' });
  assert.equal(open.className, 'cora-case-open-btn');
  open.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
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

test('Controls appeals: Reference and Case Type sort for real — click, report, sorted render', () => {
  // Held here rather than through `dashboardView`: appeals are switched off, so
  // the page composes no Appeals panel. This drives the panel view directly, so
  // it says the same thing about sorting without depending on the switch.
  const cases = [
    { ...row('Zed case', '2026-01-01T00:00:00Z'), caseType: 'sales' },
    { ...row('Alpha case', '2026-01-01T00:00:00Z'), caseType: 'banking' },
  ];
  /** @param {any} view */
  const references = (view) =>
    [...(view.querySelector('tbody')?.querySelectorAll('tr') ?? [])].map(
      (/** @type {any} */ tableRow) =>
        tableRow.querySelectorAll('td')[0].textContent
    );

  for (const [column, key] of [
    ['Reference', 'reference'],
    ['Case Type', 'caseType'],
  ]) {
    /** @type {string[]} */
    const sorts = [];
    fireEvent(
      getByRole(
        controlsAppealsView(cases, { key: 'raised', dir: 'asc' }, (sortKey) =>
          sorts.push(sortKey)
        ),
        'button',
        { name: /** @type {string} */ (column) }
      ),
      'click'
    );
    assert.deepEqual(sorts, [key]);

    // The reported sort, applied: both columns order Alpha before Zed ascending.
    assert.deepEqual(
      references(controlsAppealsView(cases, { key, dir: 'asc' }, () => {})),
      ['Case Alpha case', 'Case Zed case']
    );
  }
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
  assert.deepEqual(await fetchOpenAppeals(/** @type {any} */ ({}), []), []);

  const columns = appealColumns();
  /** @param {string} key */
  const valueOf = (key) => {
    const column = columns.find((candidate) => candidate.key === key);
    assert.ok(column, `no ${key} column`);
    return /** @type {(row: any) => unknown} */ (column.value)(resolved);
  };
  const raised = columns.find((column) => column.key === 'raised');
  assert.equal(valueOf('reference'), 'resolved');
  assert.equal(valueOf('appellant'), '');
  assert.equal(valueOf('raised'), null);
  assert.equal(raised?.format?.(null, /** @type {any} */ (resolved)), '—');
  assert.equal(valueOf('rationale'), '');
});
