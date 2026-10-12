// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { reportFolderAccess } from '../scripts/report-folder-access.js';
import { APP_CONFIG } from '../src/app-config.js';
import { allScopes } from '../src/reports/report-access.js';

/** @typedef {import('../src/reports/contract.js').ReportPlugin} ReportPlugin */

/**
 * @param {Partial<ReportPlugin>} overrides
 * @returns {ReportPlugin}
 */
function report(overrides) {
  return {
    id: 'example',
    title: 'Example',
    description: 'An example.',
    layout: 'stacked',
    access: ['maintainer'],
    scope: { kind: 'case-type' },
    feeds: {},
    view: () => ({}),
    ...overrides,
  };
}

test('every scope folder is listed once, with the union of the groups every report in it needs', () => {
  const rows = reportFolderAccess([
    report({
      id: 'b-report',
      access: [{ role: 'caseTypeOwner', of: 'scope' }],
      feeds: {
        main: {
          path: (scope) => `case-types/${scope.key}/b.txt`,
          schemaVersion: 1,
        },
        extra: {
          path: (scope) => `case-types/${scope.key}/b-extra.txt`,
          schemaVersion: 1,
        },
      },
    }),
    report({
      id: 'a-report',
      access: ['maintainer'],
      feeds: {
        main: {
          path: (scope) => `case-types/${scope.key}/a.txt`,
          schemaVersion: 1,
        },
      },
    }),
  ]);

  assert.deepEqual(
    rows.map(({ folder }) => folder),
    allScopes(report({}))
      .map(({ key }) => `case-types/${key}`)
      .sort()
  );
  const complaints = rows.find(
    ({ folder }) => folder === 'case-types/complaints'
  );
  assert.deepEqual(complaints, {
    folder: 'case-types/complaints',
    groups: ['CORA Owner Delegates', 'CaseTypeOwner - Complaints'],
    reports: ['a-report', 'b-report'],
  });
});

test('a file at the top of the library is listed under the library root', () => {
  const rows = reportFolderAccess([
    report({
      scope: { kind: 'platform' },
      feeds: { main: { path: () => 'platform.txt', schemaVersion: 1 } },
    }),
  ]);
  assert.deepEqual(rows, [
    { folder: '', groups: ['CORA Owner Delegates'], reports: ['example'] },
  ]);
});

test('run as a script, it prints the configured reports’ folders as JSON', () => {
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../scripts/report-folder-access.js', import.meta.url)
      ),
    ],
    { encoding: 'utf8' }
  );
  assert.deepEqual(
    JSON.parse(output),
    reportFolderAccess(APP_CONFIG.reportPlugins)
  );
});
