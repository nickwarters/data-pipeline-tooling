// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_VALUE,
  formatDate,
  formatDateLike,
  formatTimestamp,
} from '../src/lib/format-datetime.js';

/**
 * Run `body` as if the browser were in `zone`. Every assertion about a rendered
 * instant is pinned this way: an unpinned one would be asserting where the
 * machine running the suite happens to be, and would agree with the rule for
 * most of the day — which is exactly what makes that mistake survive.
 *
 * @param {string} zone
 * @param {() => void} body
 */
function inZone(zone, body) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('a date renders day first, so no reader has to guess which number is the day', () => {
  inZone('Europe/London', () => {
    assert.equal(formatDate('2026-06-18'), '18/06/2026');
    assert.equal(formatDate('2026-06-18T08:00:00Z'), '18/06/2026');
    assert.equal(formatDate(new Date('2026-06-18T08:00:00Z')), '18/06/2026');
  });
});

test('a single-digit day and month keep their leading zeros', () => {
  inZone('Europe/London', () => {
    assert.equal(formatDate('2026-01-02'), '02/01/2026');
  });
});

test('a calendar date key is read as written, never as midnight in Greenwich', () => {
  // The trap this guards: parsing '2026-06-18' as an instant makes it midnight
  // UTC, which is the 17th anywhere west of Greenwich — so a due date would
  // show a day early for exactly the readers least able to spot it.
  inZone('America/New_York', () => {
    assert.equal(formatDate('2026-06-18'), '18/06/2026');
    assert.equal(formatTimestamp('2026-06-18'), '18 Jun 2026');
    assert.equal(formatDateLike('2026-06-18'), '18/06/2026');
  });
});

test('an instant is shown as the day it falls on where the reader is', () => {
  // 23:30 UTC on the 18th is already the 19th in British Summer Time.
  inZone('Europe/London', () => {
    assert.equal(formatDate('2026-06-18T23:30:00Z'), '19/06/2026');
    assert.equal(formatTimestamp('2026-06-18T23:30:00Z'), '19 Jun 2026, 00:30');
  });
});

test('a timestamp names its month and shows a 24-hour clock', () => {
  inZone('UTC', () => {
    assert.equal(formatTimestamp('2026-06-18T08:05:00Z'), '18 Jun 2026, 08:05');
    assert.equal(formatTimestamp('2026-12-01T17:30:00Z'), '1 Dec 2026, 17:30');
    assert.equal(
      formatTimestamp(new Date('2026-06-18T08:05:00Z')),
      '18 Jun 2026, 08:05'
    );
  });
});

test('an absent or unreadable value shows the shared em dash', () => {
  for (const value of [null, undefined, '', '   ', 'not a date', 42, {}]) {
    assert.equal(formatDate(value), NO_VALUE, String(value));
    assert.equal(formatTimestamp(value), NO_VALUE, String(value));
  }
  assert.equal(formatDate(new Date('nonsense')), NO_VALUE);
  assert.equal(formatTimestamp(new Date('nonsense')), NO_VALUE);
});

test('a caller may name what an empty value shows instead', () => {
  assert.equal(formatDate(null, ''), '');
  assert.equal(formatTimestamp(null, 'Not set'), 'Not set');
  assert.equal(formatDateLike(null, ''), '');
});

test('a value of unknown meaning is formatted only when its shape is a date', () => {
  inZone('UTC', () => {
    assert.equal(formatDateLike('2026-06-18T08:05:00Z'), '18 Jun 2026, 08:05');
  });
});

test('a reference number that merely starts with digits is left exactly as stored', () => {
  for (const value of ['CMP-2026-0001', '2026', '2026-06', 'Priya Nair']) {
    assert.equal(formatDateLike(value), value);
  }
});

test('a non-string value of unknown meaning is shown as its own text', () => {
  assert.equal(formatDateLike(42), '42');
  assert.equal(formatDateLike(true), 'true');
});
