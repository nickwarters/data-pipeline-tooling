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

test('a version is an identifier, not a digest — any identifier-shaped segment classifies', () => {
  // Nothing turns on how a version was produced: a hand-entered `v2` or `0001`
  // names a published copy exactly as a 64-hex mint does. The rule asks only
  // that the segment can be an identifier (lower-case letters, digits, `-`,
  // `_`), not where it came from.
  for (const segment of ['v2', '0001', 'abc123', '2026-01-12_a']) {
    assert.deepEqual(classifyBankArtifact(`complaints.${segment}.txt`), {
      kind: 'versioned-export',
      slug: 'complaints',
      segment,
    });
  }
});

test('a name nothing produced is refused rather than guessed at', () => {
  // The gate reports an unclassifiable name as a stray file. Guessing would let
  // a half-renamed version sit in the directory looking like a bank.
  for (const name of [
    'complaints.json', // the extension SharePoint mis-serves
    `complaints.sha256:${HEX}.txt`, // an identity with a `:` no filename can hold
    `complaints.${HEX.toUpperCase()}.txt`, // upper case — two of these could name one file on Windows/SharePoint
    'complaints.export.json',
    '.txt',
    `.${HEX}.txt`, // a version with no slug in front of it
    'notes.md',
  ]) {
    assert.equal(classifyBankArtifact(name), null, name);
  }
});

test('a slug carrying its own dots reads as a versioned export of the first segment', () => {
  // The rule reads everything before the first dot as the slug, so a dotted
  // slug would classify as some other Case Type's published version — and the
  // gate would then fail it for declaring none of a version's fields. No Case
  // Type slug has a dot, and this is what says that is a requirement rather
  // than a habit.
  assert.deepEqual(classifyBankArtifact('example.review.txt'), {
    kind: 'versioned-export',
    slug: 'example',
    segment: 'review',
  });
});
