// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RANGES,
  buildCaseTypeReport,
} from '../src/reports/case-type/case-type-report-model.js';

const FIXTURE_PATH = new URL(
  '../dev/fixtures/reports/case-types/complaints/case-type.txt',
  import.meta.url
);

/** @returns {import('../src/reports/contract.js').ReportEnvelope} */
function fixtureEnvelope() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/**
 * Every value in a figure, however it is nested.
 *
 * @param {unknown} value
 * @returns {unknown[]}
 */
function leaves(value) {
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(leaves);
  }
  return [value];
}

test('the placeholder feed is a version 1 envelope for the Case Type report', () => {
  const envelope = fixtureEnvelope();
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.report, 'case-type');
  assert.match(envelope.complete_through ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof envelope.datasets, 'object');
});

test('the placeholder feed gives the model every figure, for every range', () => {
  for (const range of Object.keys(RANGES)) {
    const report = buildCaseTypeReport(fixtureEnvelope(), range);
    for (const [figure, value] of Object.entries(report)) {
      assert.notEqual(value, null, `${range}: ${figure} is present`);
      assert.notEqual(value, undefined, `${range}: ${figure} is defined`);
    }
  }
});

test('the placeholder feed holds no missing or non-finite number in any figure', () => {
  for (const range of Object.keys(RANGES)) {
    const report = buildCaseTypeReport(fixtureEnvelope(), range);
    for (const leaf of leaves(report)) {
      assert.notEqual(leaf, null, range);
      if (typeof leaf === 'number') assert.ok(Number.isFinite(leaf), range);
    }
  }
});

test('the placeholder feed reaches back far enough to fill the longest range', () => {
  const longest = Object.values(RANGES).reduce((a, b) =>
    b.days > a.days ? b : a
  );
  const report = buildCaseTypeReport(fixtureEnvelope(), '12m');
  assert.equal(report.backlog?.length, longest.days);
  assert.equal(report.flow?.length, longest.weeks);
  assert.equal(report.sla?.length, longest.months);
  assert.notEqual(report.open?.before, null, 'the 30-day comparison exists');
  assert.notEqual(report.toAllocate?.before, null);
});

test('the placeholder feed ends on the day it says it is complete through', () => {
  const envelope = fixtureEnvelope();
  const report = buildCaseTypeReport(envelope, '6m');
  assert.equal(report.completeThrough, envelope.complete_through);
  assert.equal(report.latest?.date, envelope.complete_through);
  assert.equal(report.flow?.at(-1)?.weekEnding, envelope.complete_through);
});
