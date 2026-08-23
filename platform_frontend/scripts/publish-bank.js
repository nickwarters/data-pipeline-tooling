#!/usr/bin/env node
// @ts-check
/**
 * Publish a Question Bank: write the immutable copy of the version the bank
 * declares, and — when the bank has been edited without declaring a new one —
 * mint a version for it first.
 *
 * This is the local half of the publish flow. The Question Bank editor compiles
 * the same envelope through the same functions and will eventually write the
 * same files into SharePoint; until it does, this is what publishes a bank.
 *
 *   node scripts/publish-bank.js            # every registered Case Type
 *   node scripts/publish-bank.js complaints # one
 *
 * A bank's version is **declared on the bank** (`version`), alongside the
 * ordered `history` of every version it has been published as; the app stamps
 * that declaration onto a Case and never computes it. This script respects the
 * declaration:
 *
 * - `version` names a published file whose content matches the bank → nothing
 *   to do.
 * - `version` is declared but no file answers to it (a hand-entered identifier,
 *   or one minted by another tool) → the versioned file is written under that
 *   name. The identifier is whatever it was declared to be.
 * - `version` is absent, or names a published file the bank's content no longer
 *   matches (edited, not bumped) → a new identifier is minted
 *   (`mintBankVersion`: a content hash, because that is unique and stable), the
 *   bank is rewritten declaring it with its history advanced, and the versioned
 *   file is written.
 *
 * It is append-only: a versioned file that already exists is never overwritten,
 * because a version some reportable Case resolves against has to stay as
 * published.
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildPublishArtifacts,
  compileExport,
} from '../src/pages/question-bank/question-bank-compile.js';
import {
  bankArtifactName,
  versionedExportName,
} from '../src/lib/bank-artifacts.js';
import {
  declaredBankVersion,
  mintBankVersion,
  publishedContent,
} from '../src/lib/bank-version.js';

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
 * Does the published copy under `version` carry what the bank carries now?
 * Compared over what a version publishes, so reformatting either file changes
 * nothing. A missing copy is not a match.
 *
 * @param {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} bank
 * @param {string} version
 * @returns {Promise<boolean>}
 */
async function publishedCopyMatches(bank, version) {
  const url = new URL(versionedExportName(bank.slug, version), BANKS);
  if (!(await exists(url))) return false;
  const published = JSON.parse(await readFile(url, 'utf8'));
  const expected = publishedContent(bank);
  return (
    JSON.stringify(published.questions) ===
      JSON.stringify(expected.questions) &&
    JSON.stringify(published.outcomeOptions ?? []) ===
      JSON.stringify(expected.outcomeOptions) &&
    (published.defaultOutcomeId ?? null) === expected.defaultOutcomeId
  );
}

/**
 * Publish one bank: write its versioned copy if the version it declares is not
 * yet on disk, minting a version first if it declares none it can stand behind.
 *
 * @param {string} slug
 * @returns {Promise<string[]>} the artifacts written, relative names
 */
export async function publishBank(slug) {
  const bankUrl = new URL(bankArtifactName(slug), BANKS);
  const bank = JSON.parse(await readFile(bankUrl, 'utf8'));

  /** @type {string[]} */
  const written = [];

  const declared = declaredBankVersion(bank);
  if (declared && (await publishedCopyMatches(bank, declared))) return written;

  // Respect a declared identifier that simply has no file yet; mint only when
  // the bank declares nothing, or declares a version its content has moved on
  // from.
  const version =
    declared &&
    !(await exists(new URL(versionedExportName(slug, declared), BANKS)))
      ? declared
      : await mintBankVersion(bank);

  const versioned = { ...bank, version };
  const artifacts = buildPublishArtifacts(
    await compileExport(versioned),
    versioned
  );

  // The versioned file is immutable: written once, then left alone forever.
  const versionedName = versionedExportName(slug, version);
  const versionedUrl = new URL(versionedName, BANKS);
  if (artifacts.versionedJson && !(await exists(versionedUrl))) {
    await writeFile(versionedUrl, artifacts.versionedJson + '\n');
    written.push(versionedName);
  }

  // The bank now declares the version it was just published as, with its
  // history advanced — the one edit this script makes to a bank.
  const bankName = bankArtifactName(slug);
  if (artifacts.bankJson !== (await readFile(bankUrl, 'utf8'))) {
    await writeFile(bankUrl, artifacts.bankJson);
    written.push(bankName);
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
