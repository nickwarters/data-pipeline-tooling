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

test('the identity keeps its algorithm prefix; the filename is the digest alone', () => {
  // `:` is illegal in a Windows path and rejected by SharePoint, so a hash
  // pasted straight into a filename produces a file that cannot be written.
  const hash = `sha256:${HEX}`;
  assert.equal(versionFileSegment(hash), HEX);
  assert.equal(versionedExportName('complaints', hash).includes(':'), false);
  assert.equal(
    versionedExportName('complaints', hash),
    `complaints.${HEX}.txt`
  );
});

test('a digest with no algorithm prefix names the same file', () => {
  // The conversion drops everything up to the last `:`, so an identity that
  // never had one is already its own filename segment. Nothing has to know
  // which form it was handed.
  assert.equal(versionFileSegment(HEX), HEX);
  assert.equal(
    versionedExportName('complaints', HEX),
    versionedExportName('complaints', `sha256:${HEX}`)
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
      segment: HEX,
    }
  );
});

test('a name nothing produced is refused rather than guessed at', () => {
  // The gate reports an unclassifiable name as a stray file. Guessing would let
  // a half-renamed version sit in the directory looking like a bank.
  for (const name of [
    'complaints.json', // the extension SharePoint mis-serves
    'complaints.abc123.txt', // a truncated digest
    `complaints.sha256:${HEX}.txt`, // the identity, unconverted
    `complaints.sha256-${HEX}.txt`, // the algorithm prefix, left in
    `complaints.${HEX.toUpperCase()}.txt`, // a digest that is not lower-case
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
