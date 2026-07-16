// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { loadSampleCases, SAMPLE_CASE_LIMIT } =
  await import('../src/pages/question-bank/question-bank-samples.js');
const { sampleCases, _resetStore } =
  await import('../src/pages/question-bank/question-bank-store.js');

/** @param {string} id @param {Record<string, any>} [answers] */
function row(id, answers) {
  return { id, title: `Title ${id}`, answers };
}

/** @param {string} slug @param {string} listName */
function source(slug, listName) {
  return { slug, listName, displayName: slug };
}

test('loadSampleCases: samples each requested source through listCases, carrying its listName', async () => {
  _resetStore();
  /** @type {Array<{ filter: any, opts: any }>} */
  const calls = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts) {
      calls.push({ filter, opts });
      return [row(`${filter.caseType}-1`, { 'q-a': { value: 'Yes' } })];
    },
  });
  await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
    source('complaints', 'Cases-Complaints'),
  ]);
  assert.deepEqual(
    calls.map((c) => c.filter),
    [{ caseType: 'example-review' }, { caseType: 'complaints' }]
  );
  assert.deepEqual(
    calls.map((c) => c.opts.listName),
    ['Cases-ExampleReview', 'Cases-Complaints']
  );
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
  await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
  ]);
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
  await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
  ]);
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
  await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
    source('complaints', 'Cases-Complaints'),
  ]);
  assert.equal(sampleCases.get()['example-review'].length, 1);
  assert.deepEqual(sampleCases.get()['complaints'], []);
});

test('loadSampleCases: defaults to no sources (and samples nothing) when none are passed', async () => {
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
  assert.deepEqual(asked, [], 'no sources means no reads at all');
});

test('loadSampleCases: multiple sources fan out independently, each keyed by its own slug', async () => {
  _resetStore();
  /** @type {Record<string, string>} */
  const listNameBySlug = {};
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts) {
      listNameBySlug[filter.caseType] = opts.listName;
      return [row(`${filter.caseType}-1`, {})];
    },
  });
  await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
    source('stress-review', 'Cases-StressReview'),
    source('complaints', 'Cases-Complaints'),
  ]);
  assert.deepEqual(listNameBySlug, {
    'example-review': 'Cases-ExampleReview',
    'stress-review': 'Cases-StressReview',
    complaints: 'Cases-Complaints',
  });
  assert.equal(sampleCases.get()['example-review'].length, 1);
  assert.equal(sampleCases.get()['stress-review'].length, 1);
  assert.equal(sampleCases.get()['complaints'].length, 1);
});
