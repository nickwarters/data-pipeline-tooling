// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadBank } from '../case-types/load-bank.js';

test('loadBank: reads a repo bank artifact in the Node file-url test environment', async () => {
  const bank = await loadBank('./banks/example-review.txt');

  assert.equal(bank.slug, 'example-review');
  assert.equal(bank.questions[0].id, 'q-welcome');
});

test('loadBank: fetches and parses a bank over http(s) in the browser', async () => {
  const originalFetch = globalThis.fetch;
  /** @type {URL | undefined} */
  let requested;
  globalThis.fetch = /** @type {any} */ (
    async (/** @type {URL} */ url) => {
      requested = url;
      return {
        ok: true,
        text: async () => JSON.stringify({ slug: 'remote', questions: [] }),
      };
    }
  );
  try {
    const bank = await loadBank('https://sp.example/banks/remote.txt');
    assert.equal(bank.slug, 'remote');
    assert.equal(requested?.href, 'https://sp.example/banks/remote.txt');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadBank: throws with the status when the fetch response is not ok', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (
    async () => ({ ok: false, status: 503 })
  );
  try {
    await assert.rejects(
      loadBank('https://sp.example/banks/missing.txt'),
      /Unable to load Question Bank https:\/\/sp\.example\/banks\/missing\.txt: 503/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
