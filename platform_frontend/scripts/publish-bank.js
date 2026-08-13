#!/usr/bin/env node
// @ts-check
/**
 * Publish a Question Bank: compile the editable bank into its export envelope,
 * write the current pointer, and append an immutable versioned copy.
 *
 * This is the local half of the publish flow. The Question Bank editor compiles
 * the same envelope through the same functions and will eventually write the
 * same files into SharePoint; until it does, this is what keeps the artifacts on
 * disk in step with the bank beside them — and how the historical versions in
 * the repository were produced.
 *
 *   node scripts/publish-bank.js            # every registered Case Type
 *   node scripts/publish-bank.js complaints # one
 *
 * Publishing is idempotent and append-only. Re-running with no bank change
 * rewrites nothing: the hash is derived from the content, so identical
 * questions produce the identical version, and a versioned file that already
 * exists is never overwritten. That is the property the whole scheme rests on —
 * a version some reportable Case resolves its questions from must stay exactly
 * as it was published.
 *
 * The repository formatter reformats what this writes, because bank artifacts
 * are covered by the frontend prettier hook. That is harmless and deliberately
 * so: the hash is computed over a canonical data form rather than the
 * pretty-printed bytes, precisely so that re-formatting cannot silently
 * re-identify identical content. A published file's bytes may be tidied once,
 * on the commit that introduces it; its identity cannot move.
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { compileExport } from '../src/pages/question-bank/question-bank-compile.js';
import {
  bankArtifactName,
  currentExportName,
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
 * Compile one bank and write whatever is missing or stale.
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
    // Label name/color is presentation, resolved from the current export so a
    // rename applies across every historical report; the per-question labelIds
    // stay frozen here.
    const { labels: _presentation, ...versioned } = envelope;
    await writeFile(versionedUrl, JSON.stringify(versioned, null, 2) + '\n');
    written.push(versionedName);
  }

  // The current pointer always tracks the newest version. `generatedAt` moves
  // only when the content does, so a re-run does not churn the file.
  const currentName = currentExportName(slug);
  const currentUrl = new URL(currentName, BANKS);
  const published = (await exists(currentUrl))
    ? JSON.parse(await readFile(currentUrl, 'utf8'))
    : null;
  if (published?.hash !== envelope.hash) {
    await writeFile(currentUrl, JSON.stringify(envelope, null, 2) + '\n');
    written.push(currentName);
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
