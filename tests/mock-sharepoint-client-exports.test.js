// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST,
  CASES,
  QUESTION_DEFS,
  PERSONAS,
  makeClient,
  VERSIONED_EXPORT,
  MockSharePointClient,
} from './helpers/mock-sharepoint-client.js';

// Capability: bank hashes and versioned exports.

// --- getExportHash (ADR-0021 Step 3) ---

test('MockSharePointClient: getExportHash returns the configured hash for a known slug', async () => {
  const client = new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    exportHashes: { 'example-review': 'sha256:abc123' },
  });
  const hash = await client.getExportHash('example-review');
  assert.equal(hash, 'sha256:abc123');
});

test('MockSharePointClient: getExportHash returns null when slug has no configured hash', async () => {
  const client = makeClient();
  const hash = await client.getExportHash('example-review');
  assert.equal(hash, null);
});

test('MockSharePointClient: getVersionedExport returns the matching export for a known hash (ADR-0021 Step 4)', async () => {
  const client = new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    versionedExports: { [VERSIONED_EXPORT.hash]: VERSIONED_EXPORT },
  });
  const result = await client.getVersionedExport(
    'example-review',
    VERSIONED_EXPORT.hash
  );
  assert.deepEqual(result, VERSIONED_EXPORT);
});

test('MockSharePointClient: getVersionedExport returns null for an unknown hash (ADR-0021 Step 4)', async () => {
  const client = makeClient();
  const result = await client.getVersionedExport(
    'example-review',
    'sha256:unknown'
  );
  assert.equal(result, null);
});

test('MockSharePointClient: getVersionedExport returns null when no versionedExports configured (ADR-0021 Step 4)', async () => {
  const client = makeClient();
  const result = await client.getVersionedExport(
    'example-review',
    'sha256:' + 'a'.repeat(64)
  );
  assert.equal(result, null);
});
