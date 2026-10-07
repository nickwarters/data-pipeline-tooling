// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './_dom-stub.js';

installDom();

const { CaseTypeReport } =
  await import('../src/reports/case-type/case-type-report-plugin.js');
const { RANGES } =
  await import('../src/reports/case-type/case-type-report-model.js');

const FIXTURE_PATH = new URL(
  '../dev/fixtures/reports/case-types/complaints/case-type.txt',
  import.meta.url
);

/** @returns {import('../src/reports/contract.js').ReportEnvelope} */
function fixtureEnvelope() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/**
 * @param {string} range
 * @param {import('../src/reports/contract.js').ReportEnvelope} [report]
 */
function view(range, report = fixtureEnvelope()) {
  return CaseTypeReport.view(
    /** @type {any} */ ({ feeds: { report }, filters: { range } })
  );
}

/** @type {import('../src/reports/contract.js').ReportScope} */
const COMPLAINTS = {
  kind: 'case-type',
  key: 'complaints',
  label: 'Complaints',
};

test('the report reads its file from the folder of the Case Type it is opened for', () => {
  const path = CaseTypeReport.feeds.report.path;
  assert.equal(path(COMPLAINTS), 'case-types/complaints/case-type.txt');
  assert.equal(
    path({ ...COMPLAINTS, key: 'claims' }),
    'case-types/claims/case-type.txt'
  );
});

test('the report is about one Case Type at a time', () => {
  assert.deepEqual(CaseTypeReport.scope, { kind: 'case-type' });
  assert.equal(CaseTypeReport.feeds.report.schemaVersion, 1);
});

test('the report is open to Maintainers and to the Owners of the Case Type', () => {
  assert.deepEqual(
    [...CaseTypeReport.access],
    ['maintainer', { role: 'caseTypeOwner', of: 'scope' }]
  );
});

test('the report offers exactly the ranges the model knows', () => {
  const range = CaseTypeReport.filters.range;
  assert.deepEqual(
    range.options.map((option) => option.key),
    Object.keys(RANGES)
  );
  for (const option of range.options) {
    assert.equal(
      option.label,
      RANGES[/** @type {keyof typeof RANGES} */ (option.key)].label
    );
  }
});

test('the range filter starts on one of its own options', () => {
  const { initial, options } = CaseTypeReport.filters.range;
  assert.ok(options.some((option) => option.key === initial));
});

test('every range the report offers turns the feed into content', () => {
  for (const { key } of CaseTypeReport.filters.range.options) {
    const content = view(key);
    assert.ok((content.kpis ?? []).length > 0, key);
    assert.ok((content.now ?? []).length > 0, key);
    assert.ok(
      (content.sections ?? []).every((section) => section.panels.length > 0),
      key
    );
  }
});

test('the range chosen decides how far back the over-time panels reach', () => {
  const rowsIn = (/** @type {string} */ range) =>
    view(range).sections?.[0].panels.find((p) => p.id === 'backlog')?.table
      ?.rows.length ?? 0;
  assert.equal(rowsIn('3m'), RANGES['3m'].days);
  assert.equal(rowsIn('12m'), RANGES['12m'].days);
});

test('the report degrades to the panels its feed can fill', () => {
  const content = view('6m', {
    schema_version: 1,
    complete_through: '2026-10-06',
    datasets: {},
  });
  assert.deepEqual(content.kpis, []);
  assert.deepEqual(content.now, []);
  assert.deepEqual(content.sections, []);
});
