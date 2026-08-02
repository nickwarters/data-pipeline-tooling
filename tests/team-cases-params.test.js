// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseTeamCasesParams } =
  await import('../src/services/team-cases-params.js');

test('parseTeamCasesParams: returns a null caseType for an empty string', () => {
  assert.strictEqual(parseTeamCasesParams('').caseType, null);
});

test('parseTeamCasesParams: parses ?caseType=example-review', () => {
  assert.strictEqual(
    parseTeamCasesParams('?caseType=example-review').caseType,
    'example-review'
  );
});
