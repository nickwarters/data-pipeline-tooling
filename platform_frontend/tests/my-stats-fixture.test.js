// @ts-check
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fixture = fileURLToPath(
  new URL('../dev/fixtures/my-stats/123456.txt', import.meta.url)
);
const envelopeKeys = [
  'complete_through',
  'generated_at',
  'reviewer_account',
  'rows',
  'schema_version',
];
const rowKeys = ['case_type', 'count', 'date'];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const utcInstantPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|\+00:00)$/;

/** @param {unknown} value */
function assertIsoDate(value) {
  assert.equal(typeof value, 'string');
  if (typeof value !== 'string') throw new TypeError('expected an ISO date');
  assert.match(value, datePattern);
  const parsed = new Date(`${value}T00:00:00Z`);
  assert.equal(parsed.toISOString().slice(0, 10), value);
}

/** @param {unknown} value */
function assertUtcInstant(value) {
  assert.equal(typeof value, 'string');
  if (typeof value !== 'string') throw new TypeError('expected a UTC instant');
  const match = utcInstantPattern.exec(value);
  assert.ok(match);
  const parsed = new Date(value);
  assert.ok(Number.isFinite(parsed.getTime()));
  assert.equal(parsed.getUTCFullYear(), Number(match[1]));
  assert.equal(parsed.getUTCMonth() + 1, Number(match[2]));
  assert.equal(parsed.getUTCDate(), Number(match[3]));
  assert.equal(parsed.getUTCHours(), Number(match[4]));
  assert.equal(parsed.getUTCMinutes(), Number(match[5]));
  assert.equal(parsed.getUTCSeconds(), Number(match[6]));
}

test('my-stats fixture matches the shared Report Feed envelope', async () => {
  const payload = JSON.parse(await readFile(fixture, 'utf8'));

  assert.deepEqual(Object.keys(payload).sort(), envelopeKeys);
  assert.equal(payload.schema_version, 1);

  const account = path.basename(fixture, '.txt');
  assert.equal(payload.reviewer_account, account);
  assert.equal(
    payload.reviewer_account,
    payload.reviewer_account.toLowerCase()
  );
  assert.match(payload.reviewer_account, /^[a-z0-9._-]+$/);

  assertUtcInstant(payload.generated_at);
  assertIsoDate(payload.complete_through);
  assert.ok(payload.complete_through <= payload.generated_at.slice(0, 10));

  assert.ok(Array.isArray(payload.rows));
  const pairs = new Set();
  for (const row of payload.rows) {
    assert.deepEqual(Object.keys(row).sort(), rowKeys);
    assertIsoDate(row.date);
    assert.ok(row.date <= payload.complete_through);
    assert.equal(typeof row.case_type, 'string');
    assert.ok(row.case_type.trim().length > 0);
    // JSON has one number type, so `4.0` is indistinguishable from `4` once
    // parsed. The producer-side Python test is stricter and rejects floats.
    assert.ok(Number.isInteger(row.count) && row.count > 0);
    const pair = JSON.stringify([row.date, row.case_type]);
    assert.ok(!pairs.has(pair));
    pairs.add(pair);
  }
});
