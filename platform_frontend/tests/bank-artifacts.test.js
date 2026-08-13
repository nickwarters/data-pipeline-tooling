// @ts-check
/**
 * The Question Bank artifact naming rule.
 *
 * Three things compose or read these names — the app's artifact read, the
 * publish script, and the repository gate — and they only agree because they
 * all call this module. The tests worth having are therefore about the thing
 * the rule exists to survive: a directory holding two kinds of artifact that
 * must not be mistaken for each other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANKS_DIR,
  bankArtifactName,
  classifyBankArtifact,
  versionedExportName,
} from '../src/lib/bank-artifacts.js';

const HEX = 'a'.repeat(64);

test('a version identity goes into its filename unchanged', () => {
  // No conversion step: what a Case row stamps is what names the file. `:` is
  // illegal in a Windows path and rejected by SharePoint, which is why the
  // identity carries no `sha256:` prefix to have to strip here.
  assert.equal(versionedExportName('complaints', HEX), `complaints.${HEX}.txt`);
});

test('both artifacts are .txt in one directory', () => {
  // JSON in `.txt` because SharePoint Subscription Edition blocks or mis-serves
  // `.json`; a version is read exactly like the bank, so it is stored like it.
  assert.equal(BANKS_DIR, 'banks');
  for (const name of [
    bankArtifactName('complaints'),
    versionedExportName('complaints', HEX),
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
  assert.deepEqual(
    classifyBankArtifact(versionedExportName('complaints', HEX)),
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
    'complaints.export.txt', // the retired current-version pointer
    'complaints.export.json',
    '.txt',
    `.${HEX}.txt`, // a version with no slug in front of it
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
