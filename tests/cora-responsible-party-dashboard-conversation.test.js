// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  getByRole,
  queryAllByRole,
  tableHeaders,
} from './helpers/semantic-dom.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();

const { hasUnreadMessages, responsiblePartyView } =
  await import('../src/pages/responsible-party/view.js');

/** @param {string} id @param {import('../src/sharepoint-client.js').CaseRow['conversation']} conversation */
function row(id, conversation) {
  return makeCaseRow({
    id,
    title: id,
    assignedReviewer: 'reviewer',
    responsibleParty: 'rp-1',
    conversation,
    etag: 'e',
  });
}

test('Responsible Party unread detection follows the last Responsible Party reply', () => {
  assert.equal(hasUnreadMessages(row('empty', []), 'rp-1'), false);
  const unread = row('unread', [
    { author: 'reviewer', timestamp: '2026-06-02T00:00:00Z', body: 'Update' },
  ]);
  const read = row('read', [
    { author: 'reviewer', timestamp: '2026-06-01T00:00:00Z', body: 'Update' },
    { author: 'rp-1', timestamp: '2026-06-02T00:00:00Z', body: 'Seen' },
  ]);
  assert.equal(hasUnreadMessages(unread, 'rp-1'), true);
  assert.equal(hasUnreadMessages(read, 'rp-1'), false);
  assert.equal(
    hasUnreadMessages(
      row('new-unread', [
        { author: 'rp-1', timestamp: '2026-06-01T00:00:00Z', body: 'Seen' },
        { author: 'reviewer', timestamp: '2026-06-03T00:00:00Z', body: 'New' },
      ]),
      'rp-1'
    ),
    true
  );
});

test('Responsible Party unread messages render through descriptors and invoke conversation navigation', () => {
  const unread = row('unread', [
    { author: 'reviewer', timestamp: '2026-06-02T00:00:00Z', body: 'Update' },
  ]);
  const missingTimestamp = row('missing-timestamp', [
    /** @type {any} */ ({ author: 'reviewer', body: 'Update' }),
  ]);
  /** @type {string[]} */
  const opened = [];
  const view = responsiblePartyView(
    {
      cases: [unread, missingTimestamp],
      currentUserId: 'rp-1',
      filter: '',
      remediationSort: { key: 'remediationDueDate', dir: 'asc' },
      messageSort: { key: 'lastMessage', dir: 'desc' },
    },
    {
      onFilterChange: () => {},
      onRemediationSort: () => {},
      onMessageSort: () => {},
      onOpenConversation: (item) => opened.push(item.id),
    }
  );

  const section = view.querySelector('.cora-rp-messages');
  assert.equal(section?.querySelector('table')?.getAttribute('role'), 'grid');
  assert.equal(
    section?.querySelector('a')?.getAttribute('href'),
    '#/case/complaints/unread'
  );
  assert.match(section?.textContent ?? '', /—/);
  // Reference and Case Type are the shared descriptors, so they sort here as
  // on every other Case table; `Last message` keeps the default sort.
  assert.deepEqual(tableHeaders(section), [
    ['Reference', 'cora-col-reference', 'none', true],
    ['Case Type', 'cora-col-caseType', 'none', true],
    ['Last message', 'cora-col-lastMessage', 'descending', true],
    ['Actions', 'cora-col-actions', 'none', false],
  ]);
  // The Open button opens the Conversation while the row's Reference link
  // opens the Case, so its accessible name must not be the Case's.
  const open = /** @type {any} */ (
    getByRole(section, 'button', {
      name: 'Open conversation for missing-timestamp',
    })
  );
  assert.deepEqual(
    queryAllByRole(section, 'button', { name: /^Open / }).map((button) =>
      button.getAttribute('aria-label')
    ),
    ['Open conversation for unread', 'Open conversation for missing-timestamp']
  );
  open.dispatchEvent({ type: 'click' });
  assert.deepEqual(opened, ['missing-timestamp']);

  // Existing DOM-stub debt retained until the shared debt ledger can move.
  const table = /** @type {any} */ (section?.querySelector('table'));
  assert.ok(table._listeners.keydown);
  assert.equal(table._listeners.keydown.length, 1);
  assert.ok(open._listeners.click);
  assert.equal(open._listeners.click.length, 1);
});

test('without a Conversation handler the Unread Messages table renders no Open button', () => {
  // The standalone #/my-cases route deliberately keeps the historic
  // no-navigation behaviour and passes no onOpenConversation. The button was
  // rendered anyway, so it announced "Open conversation for …" and did
  // nothing when clicked. An affordance that does nothing reads as broken
  // rather than absent, and tells a
  // screen-reader user about an action they cannot take.
  const view = responsiblePartyView(
    {
      cases: [
        row('missing-timestamp', [
          { author: 'reviewer', timestamp: '2026-06-01T00:00:00Z', body: 'hi' },
        ]),
      ],
      currentUserId: 'rp-1',
      filter: '',
      remediationSort: null,
      messageSort: null,
    },
    {
      onFilterChange: () => {},
      onRemediationSort: () => {},
      onMessageSort: () => {},
      // onOpenConversation deliberately absent
    },
    new Date('2026-07-01T00:00:00Z')
  );
  const section = view.querySelector('.cora-rp-messages');

  assert.equal(
    queryAllByRole(section, 'button', { name: /^Open/ }).length,
    0,
    'no Open button without a handler to back it'
  );
  assert.deepEqual(
    tableHeaders(section).map((h) => h[0]),
    ['Reference', 'Case Type', 'Last message'],
    'and the Actions column goes with it'
  );
});
