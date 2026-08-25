// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();

const { caseFlags, caseFlagIcon, caseFlagIcons } =
  await import('../src/views/case-flags.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @param {Partial<CaseRow>} [overrides] @returns {CaseRow} */
function row(overrides = {}) {
  return makeCaseRow({
    id: 'c1',
    title: 'Case c1',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    etag: 'e',
    onHold: false,
    conversation: [],
    ...overrides,
  });
}

/** @param {number} count @returns {any[]} */
const messages = (count) =>
  Array.from({ length: count }, (_, index) => ({
    author: { loginName: 'rp', displayName: 'RP' },
    at: '2026-08-01T09:00:00Z',
    body: `m${index}`,
  }));

/** @param {any} node @returns {string[]} */
const labelsOf = (node) =>
  node
    ? [...node.querySelectorAll('svg')].map((/** @type {any} */ icon) =>
        icon.getAttribute('aria-label')
      )
    : [];

test('a Case raising neither flag has none', () => {
  assert.deepEqual(caseFlags(row()), []);
  assert.equal(caseFlagIcons(row()), null);
});

test('On Hold and Messages are separate facts, each raised on its own', () => {
  assert.deepEqual(caseFlags(row({ onHold: true })), [
    { id: 'hold', label: 'On hold' },
  ]);
  assert.deepEqual(caseFlags(row({ conversation: messages(1) })), [
    { id: 'messages', label: '1 message' },
  ]);
});

test('the Message count is singular at one and plural otherwise', () => {
  const labelFor = (/** @type {number} */ count) =>
    caseFlags(row({ conversation: messages(count) }))[0]?.label;
  assert.equal(labelFor(1), '1 message');
  assert.equal(labelFor(2), '2 messages');
  assert.equal(labelFor(11), '11 messages');
});

test('the marks are drawn in the order the flags are declared in', () => {
  // The point of deriving one from the other: a Case raising both states its
  // order once, so the column of marks and the list cannot disagree.
  const both = row({ onHold: true, conversation: messages(3) });
  assert.deepEqual(
    caseFlags(both).map((flag) => flag.label),
    ['On hold', '3 messages']
  );
  assert.deepEqual(labelsOf(caseFlagIcons(both)), ['On hold', '3 messages']);
});

test('a Case row carrying no Conversation at all raises no Message flag', () => {
  // A list read always parses the blob, but a fixture may leave it off, and a
  // missing Conversation is no Messages rather than a throw.
  const bare = row();
  /** @type {any} */ (bare).conversation = undefined;
  assert.deepEqual(caseFlags(bare), []);
  assert.equal(caseFlagIcon(bare, 'messages'), null);
});

test('a named mark is drawn only when its Case raises it', () => {
  // The Action Centre asks for the bubble alone; its groups already say which
  // Cases are held, so the clock would be noise there.
  const talkative = row({ onHold: true, conversation: messages(2) });
  const icon = caseFlagIcon(talkative, 'messages');
  assert.equal(icon?.getAttribute('aria-label'), '2 messages');
  assert.equal(
    icon?.getAttribute('class'),
    'cora-case-flag cora-case-flag--messages'
  );
  // Held, but silent: asking for the bubble gets nothing rather than the clock.
  assert.equal(caseFlagIcon(row({ onHold: true }), 'messages'), null);
});

test('a mark names itself for a screen reader and titles itself for a pointer', () => {
  const icon = /** @type {any} */ (caseFlagIcon(row({ onHold: true }), 'hold'));
  assert.equal(icon.getAttribute('role'), 'img');
  // `aria-label` wins the accessible-name computation, so the two do not
  // announce twice; the <title> is what a pointer hover shows.
  assert.equal(icon.getAttribute('aria-label'), 'On hold');
  assert.equal(icon.querySelector('title')?.textContent, 'On hold');
  // Not in the tab order: the fact is already in the row's text for a keyboard
  // user, and a focusable mark per row would be a stop with nothing behind it.
  assert.equal(icon.getAttribute('focusable'), 'false');
});

test('asking for a flag that does not exist throws at the call site', () => {
  // Returning null would cost a mark nobody notices is missing.
  assert.throws(
    () => caseFlagIcon(row({ onHold: true }), 'onHold'),
    /unknown Case flag: onHold/
  );
});
