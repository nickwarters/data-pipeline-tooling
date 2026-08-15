#!/usr/bin/env node
// @ts-check
/**
 * Publish a Question Bank: compile the editable bank into its export envelope
 * and write it as an immutable version, named by its own identity.
 *
 * This is the local half of the publish flow. The Question Bank editor compiles
 * the same envelope through the same functions and will eventually write the
 * same files into SharePoint; until it does, this is what publishes a bank.
 *
 *   node scripts/publish-bank.js            # every registered Case Type
 *   node scripts/publish-bank.js complaints # one
 *
 * There is no pointer file to update — publishing only ever *adds* the
 * immutable copy the bank's identity names. It is idempotent and append-only:
 * an unchanged bank has the same identity, and a versioned file that already
 * exists is never overwritten. That last part is what the scheme rests on, so
 * that a version some reportable Case resolves against stays as published.
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { compileExport } from '../src/pages/question-bank/question-bank-compile.js';
import {
  bankArtifactName,
  versionedExportName,
} from '../src/lib/bank-artifacts.js';

const BANKS = new URL('../case-types/banks/', import.meta.url);

/** @param {URL} url @returns {Promise<boolean>} */
async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compile one bank and write its version if that version is not yet published.
 *
 * @param {string} slug
 * @returns {Promise<string[]>} the artifacts written, relative names
 */
export async function publishBank(slug) {
  const bankUrl = new URL(bankArtifactName(slug), BANKS);
  const bank = JSON.parse(await readFile(bankUrl, 'utf8'));
  const envelope = await compileExport(bank);

  /** @type {string[]} */
  const written = [];

  // The versioned file is immutable: written once, then left alone forever.
  const versionedName = versionedExportName(slug, envelope.hash);
  const versionedUrl = new URL(versionedName, BANKS);
  if (!(await exists(versionedUrl))) {
    // Label name/color is presentation, resolved from the current bank so a
    // rename applies across every historical report; the per-question labelIds
    // stay frozen here.
    const { labels: _presentation, ...versioned } = envelope;
    await writeFile(versionedUrl, JSON.stringify(versioned, null, 2) + '\n');
    written.push(versionedName);
  }

  return written;
}

/**
 * @param {string[]} slugs
 * @returns {Promise<void>}
 */
async function main(slugs) {
  const { CASE_TYPES } = await import('../case-types/manifest.js');
  const targets = slugs.length
    ? slugs
    : CASE_TYPES.filter((entry) => entry.bank).map((entry) => entry.slug);

  for (const slug of targets) {
    const written = await publishBank(slug);
    console.log(
      written.length
        ? `published ${slug}: ${written.join(', ')}`
        : `${slug}: already published, nothing to write`
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
