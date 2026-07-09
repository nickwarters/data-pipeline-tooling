// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { loadSampleCases, SAMPLE_CASE_LIMIT } =
  await import('../src/question-bank/question-bank-samples.js');
const { sampleCases, _resetStore } =
  await import('../src/question-bank/question-bank-store.js');

/** @param {string} id @param {Record<string, any>} [answers] */
function row(id, answers) {
  return { id, title: `Title ${id}`, answers };
}

test('loadSampleCases: samples each requested slug through listCases', async () => {
  _resetStore();
  /** @type {any[]} */
  const filters = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter) {
      filters.push(filter);
      return [row(`${filter.caseType}-1`, { 'q-a': { value: 'Yes' } })];
    },
  });
  await loadSampleCases(client, ['example-review', 'complaints']);
  assert.deepEqual(filters, [
    { caseType: 'example-review' },
    { caseType: 'complaints' },
  ]);
  assert.deepEqual(sampleCases.get()['example-review'], [
    {
      id: 'example-review-1',
      title: 'Title example-review-1',
      answers: { 'q-a': { value: 'Yes' } },
    },
  ]);
  assert.equal(sampleCases.get()['complaints'].length, 1);
});

test('loadSampleCases: defaults answers to an empty record', async () => {
  _resetStore();
  const client = /** @type {any} */ ({
    async listCases() {
      return [row('case-1')];
    },
  });
  await loadSampleCases(client, ['example-review']);
  assert.deepEqual(sampleCases.get()['example-review'][0].answers, {});
});

test('loadSampleCases: caps the sample at SAMPLE_CASE_LIMIT', async () => {
  _resetStore();
  const rows = Array.from({ length: SAMPLE_CASE_LIMIT + 5 }, (_, i) =>
    row(`case-${i}`, {})
  );
  const client = /** @type {any} */ ({
    async listCases() {
      return rows;
    },
  });
  await loadSampleCases(client, ['example-review']);
  assert.equal(sampleCases.get()['example-review'].length, SAMPLE_CASE_LIMIT);
});

test('loadSampleCases: a failing list leaves that slug with no samples', async () => {
  _resetStore();
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter) {
      if (filter.caseType === 'complaints') throw new Error('403');
      return [row('case-1', {})];
    },
  });
  await loadSampleCases(client, ['example-review', 'complaints']);
  assert.equal(sampleCases.get()['example-review'].length, 1);
  assert.deepEqual(sampleCases.get()['complaints'], []);
});

test('loadSampleCases: defaults to every bank slug in the store', async () => {
  _resetStore();
  /** @type {string[]} */
  const asked = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter) {
      asked.push(filter.caseType);
      return [];
    },
  });
  await loadSampleCases(client);
  assert.ok(asked.includes('example-review'));
  assert.ok(asked.includes('complaints'));
});
