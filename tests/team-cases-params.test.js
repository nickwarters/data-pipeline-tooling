// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseTeamCasesParams } =
  await import('../src/services/team-cases-params.js');

test('parseTeamCasesParams: returns all-null defaults for empty string', () => {
  const p = parseTeamCasesParams('');
  assert.strictEqual(p.manager, null);
  assert.strictEqual(p.role, null);
  assert.strictEqual(p.caseType, null);
  assert.strictEqual(p.status, null);
  assert.strictEqual(p.completedSince, null);
  assert.strictEqual(p.completedUntil, null);
});

test('parseTeamCasesParams: parses ?manager=me', () => {
  assert.strictEqual(parseTeamCasesParams('?manager=me').manager, 'me');
});

test('parseTeamCasesParams: ignores unknown manager values', () => {
  assert.strictEqual(parseTeamCasesParams('?manager=other').manager, null);
});

test('parseTeamCasesParams: parses ?role=reviewer-manager', () => {
  assert.strictEqual(
    parseTeamCasesParams('?role=reviewer-manager').role,
    'reviewer-manager'
  );
});

test('parseTeamCasesParams: parses ?role=responsible-party-manager', () => {
  assert.strictEqual(
    parseTeamCasesParams('?role=responsible-party-manager').role,
    'responsible-party-manager'
  );
});

test('parseTeamCasesParams: ignores unknown role values', () => {
  assert.strictEqual(parseTeamCasesParams('?role=admin').role, null);
});

test('parseTeamCasesParams: parses ?caseType=example-review', () => {
  assert.strictEqual(
    parseTeamCasesParams('?caseType=example-review').caseType,
    'example-review'
  );
});

test('parseTeamCasesParams: parses ?status=overdue', () => {
  assert.strictEqual(parseTeamCasesParams('?status=overdue').status, 'overdue');
});

test('parseTeamCasesParams: parses ?status=outstanding', () => {
  assert.strictEqual(
    parseTeamCasesParams('?status=outstanding').status,
    'outstanding'
  );
});

test('parseTeamCasesParams: parses ?status=completed', () => {
  assert.strictEqual(
    parseTeamCasesParams('?status=completed').status,
    'completed'
  );
});

test('parseTeamCasesParams: ignores unknown status values', () => {
  assert.strictEqual(parseTeamCasesParams('?status=unknown').status, null);
});

test('parseTeamCasesParams: parses ?completedSince and ?completedUntil', () => {
  const p = parseTeamCasesParams(
    '?completedSince=2026-01-01&completedUntil=2026-05-01'
  );
  assert.strictEqual(p.completedSince, '2026-01-01');
  assert.strictEqual(p.completedUntil, '2026-05-01');
});

test('parseTeamCasesParams: parses combined params', () => {
  const p = parseTeamCasesParams(
    '?manager=me&role=reviewer-manager&caseType=example-review&status=completed&completedSince=2026-01-01&completedUntil=2026-05-18'
  );
  assert.strictEqual(p.manager, 'me');
  assert.strictEqual(p.role, 'reviewer-manager');
  assert.strictEqual(p.caseType, 'example-review');
  assert.strictEqual(p.status, 'completed');
  assert.strictEqual(p.completedSince, '2026-01-01');
  assert.strictEqual(p.completedUntil, '2026-05-18');
});
