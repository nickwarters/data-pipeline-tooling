// @ts-check
/**
 * The Question Bank artifact naming rule.
 *
 * Three things compose or read these names — the app's artifact read, the
 * publish script, and the repository gate — and they only agree because they
 * all call this module. The tests worth having are therefore about the two
 * things the rule exists to survive: a hash that cannot be a filename, and a
 * directory holding three kinds of artifact that must not be mistaken for each
 * other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANKS_DIR,
  bankArtifactName,
  classifyBankArtifact,
  currentExportName,
  versionFileSegment,
  versionedExportName,
} from '../src/lib/bank-artifacts.js';

const HEX = 'a'.repeat(64);

test('the version identity keeps its colon; the filename never gets one', () => {
  // `:` is illegal in a Windows path and rejected by SharePoint, so a hash
  // pasted straight into a filename produces a file that cannot be written.
  const hash = `sha256:${HEX}`;
  assert.equal(versionFileSegment(hash), `sha256-${HEX}`);
  assert.equal(versionedExportName('complaints', hash).includes(':'), false);
  assert.equal(
    versionedExportName('complaints', hash),
    `complaints.sha256-${HEX}.txt`
  );
});

test('all three artifacts are .txt in one directory', () => {
  // JSON in `.txt` because SharePoint Subscription Edition blocks or mis-serves
  // `.json`; an export is read exactly like the bank, so it is stored like it.
  assert.equal(BANKS_DIR, 'banks');
  for (const name of [
    bankArtifactName('complaints'),
    currentExportName('complaints'),
    versionedExportName('complaints', `sha256:${HEX}`),
  ]) {
    assert.ok(name.endsWith('.txt'), name);
    assert.ok(name.startsWith('complaints.'), name);
  }
});

test('every name the writers produce is classified back as what it is', () => {
  assert.deepEqual(classifyBankArtifact(bankArtifactName('complaints')), {
    kind: 'bank',
    slug: 'complaints',
    segment: null,
  });
  assert.deepEqual(classifyBankArtifact(currentExportName('complaints')), {
    kind: 'current-export',
    slug: 'complaints',
    segment: null,
  });
  assert.deepEqual(
    classifyBankArtifact(versionedExportName('complaints', `sha256:${HEX}`)),
    {
      kind: 'versioned-export',
      slug: 'complaints',
      segment: `sha256-${HEX}`,
    }
  );
});

test('a name nothing produced is refused rather than guessed at', () => {
  // The gate reports an unclassifiable name as a stray file. Guessing would let
  // a half-renamed version sit in the directory looking like a bank.
  for (const name of [
    'complaints.json', // the extension SharePoint mis-serves
    'complaints.sha256-abc.txt', // a truncated digest
    `complaints.sha256:${HEX}.txt`, // the identity, unconverted
    `complaints.${HEX}.txt`, // no algorithm
    'complaints.export.json',
    '.txt',
    '.export.txt',
    'notes.md',
  ]) {
    assert.equal(classifyBankArtifact(name), null, name);
  }
});

test('a slug carrying its own dots is not silently split', () => {
  // The rule reads everything before the first dot as the slug, so a dotted
  // slug would classify as some other Case Type's export. No Case Type slug has
  // a dot, and this is what says that is a requirement rather than a habit.
  assert.deepEqual(classifyBankArtifact('example.review.txt'), null);
});
