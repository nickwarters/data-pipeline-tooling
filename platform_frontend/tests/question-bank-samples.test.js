// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { loadSampleCases, SAMPLE_CASE_LIMIT } =
  await import('../src/pages/question-bank/question-bank-samples.js');

/** @param {string} id @param {Record<string, any>} [answers] */
function row(id, answers) {
  return { id, title: `Title ${id}`, answers };
}

/** @param {string} slug @param {string} listName */
function source(slug, listName) {
  return { slug, listName, displayName: slug };
}

test('loadSampleCases: samples each requested source through listCases, carrying its listName', async () => {
  /** @type {Array<{ filter: any, opts: any }>} */
  const calls = [];
  const slugByListName = /** @type {Record<string, string>} */ ({
    'Cases-ExampleReview': 'example-review',
    'Cases-Complaints': 'complaints',
  });
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts) {
      calls.push({ filter, opts });
      return [
        row(`${slugByListName[opts.listName]}-1`, {
          'q-a': { value: 'Yes' },
        }),
      ];
    },
  });
  const sampleCases = await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
    source('complaints', 'Cases-Complaints'),
  ]);
  assert.deepEqual(
    calls.map((c) => c.filter),
    [{}, {}]
  );
  assert.deepEqual(
    calls.map((c) => c.opts.listName),
    ['Cases-ExampleReview', 'Cases-Complaints']
  );
  assert.deepEqual(sampleCases['example-review'], [
    {
      id: 'example-review-1',
      title: 'Title example-review-1',
      answers: { 'q-a': { value: 'Yes' } },
    },
  ]);
  assert.equal(sampleCases['complaints'].length, 1);
});

test('loadSampleCases: defaults answers to an empty record', async () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [row('case-1')];
    },
  });
  const sampleCases = await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
  ]);
  assert.deepEqual(sampleCases['example-review'][0].answers, {});
});

test('loadSampleCases: caps the sample at SAMPLE_CASE_LIMIT', async () => {
  const rows = Array.from({ length: SAMPLE_CASE_LIMIT + 5 }, (_, i) =>
    row(`case-${i}`, {})
  );
  const client = /** @type {any} */ ({
    async listCases() {
      return rows;
    },
  });
  const sampleCases = await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
  ]);
  assert.equal(sampleCases['example-review'].length, SAMPLE_CASE_LIMIT);
});

test('loadSampleCases: a failing list leaves that slug with no samples', async () => {
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ _filter, /** @type {any} */ opts) {
      if (opts.listName === 'Cases-Complaints') throw new Error('403');
      return [row('case-1', {})];
    },
  });
  const sampleCases = await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
    source('complaints', 'Cases-Complaints'),
  ]);
  assert.equal(sampleCases['example-review'].length, 1);
  assert.deepEqual(sampleCases['complaints'], []);
});

test('loadSampleCases: defaults to no sources (and samples nothing) when none are passed', async () => {
  /** @type {string[]} */
  const asked = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ _filter, /** @type {any} */ opts) {
      asked.push(opts?.listName);
      return [];
    },
  });
  await loadSampleCases(client);
  assert.deepEqual(asked, [], 'no sources means no reads at all');
});

test('loadSampleCases: multiple sources fan out independently, each keyed by its own slug', async () => {
  /** @type {string[]} */
  const listNames = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ _filter, /** @type {any} */ opts) {
      listNames.push(opts.listName);
      return [row(`case-${opts.listName}`, {})];
    },
  });
  const sampleCases = await loadSampleCases(client, [
    source('example-review', 'Cases-ExampleReview'),
    source('stress-review', 'Cases-StressReview'),
    source('complaints', 'Cases-Complaints'),
  ]);
  assert.deepEqual(listNames, [
    'Cases-ExampleReview',
    'Cases-StressReview',
    'Cases-Complaints',
  ]);
  assert.equal(sampleCases['example-review'].length, 1);
  assert.equal(sampleCases['stress-review'].length, 1);
  assert.equal(sampleCases['complaints'].length, 1);
});
