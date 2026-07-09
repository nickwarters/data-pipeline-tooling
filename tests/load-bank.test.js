// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadBank } from '../case-types/load-bank.js';

test('loadBank: reads a repo bank artifact in the Node file-url test environment', async () => {
  const bank = await loadBank('./banks/example-review.txt');

  assert.equal(bank.slug, 'example-review');
  assert.equal(bank.questions[0].id, 'q-welcome');
});
