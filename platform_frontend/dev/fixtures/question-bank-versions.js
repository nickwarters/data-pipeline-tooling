// @ts-check
/**
 * The published Question Bank versions the mock client serves (`?mock=1`).
 *
 * A Case past the reportable milestone stores the version hash it was reviewed
 * against and resolves its questions from that published version rather than
 * from today's bank. Without published versions the dev loop can only ever show
 * a Case against the live bank, so the freeze — the whole point of stamping a
 * version — is invisible until UAT.
 *
 * There is nothing hand-written here. The versions are the real artifacts under
 * `case-types/banks/`, loaded from disk exactly as the production client fetches
 * them, so the dev loop and a deploy read the same bytes from the same files
 * under the same names. A fixture that held its own copy of the content would
 * be able to disagree with them, and the disagreement would show up as a demo
 * that works and a deploy that does not.
 *
 * Adding a version is therefore publishing a file, not editing this module:
 * write `case-types/banks/{slug}.{sha256-hex}.txt` and name it in the list
 * below.
 */

/** @typedef {import('../../src/sharepoint-client.js').VersionedExport} VersionedExport */

import { CASE_TYPES } from '../../case-types/manifest.js';
import { loadBank } from '../../case-types/load-bank.js';
import {
  BANKS_DIR,
  currentExportName,
  versionedExportName,
} from '../../src/lib/bank-artifacts.js';

/** The January version — before the courtesy-call check was retired. */
export const COMPLAINTS_BANK_V1_HASH =
  'sha256:5b4be525cff4b0321856f70662112ee6bf57d4af8399d9d0a1ae8db8d8a024cd';

/** The April version — the courtesy-call check gone, the logging question reworded. */
export const COMPLAINTS_BANK_V2_HASH =
  'sha256:943c9dade830929aa91da20a91d34ddd4cf2ccec81b9b9c479a38a8e0ea98d4b';

/**
 * The Question Definition retired between the two versions. Its id appears in
 * no later version and in no live bank, so a Case frozen at the January version
 * is the only place it can still be read — which is the behaviour worth being
 * able to demo.
 */
export const RETIRED_QUESTION_ID = 'q-cmp-0900';

/**
 * The published versions the dev loop serves, oldest first, as `{slug, hash}`
 * pairs naming a file under `case-types/banks/`.
 *
 * Older versions only: the current one is not listed because it is not a fixed
 * hash. It is whatever `{slug}.export.txt` currently points at, which is what
 * a publish moves and what completion stamps.
 *
 * @type {Array<{ slug: string, hash: string }>}
 */
export const PUBLISHED_BANK_VERSIONS = [
  { slug: 'complaints', hash: COMPLAINTS_BANK_V1_HASH },
  { slug: 'complaints', hash: COMPLAINTS_BANK_V2_HASH },
];

/**
 * @param {string} filename
 * @returns {Promise<any>}
 */
function readArtifact(filename) {
  // `loadBank` resolves against `case-types/`, reads `.txt` as text and parses
  // it explicitly — the same loader, and the same two-step, the runtime uses
  // for every bank artifact.
  return loadBank(`./${BANKS_DIR}/${filename}`);
}

/**
 * Builds the mock client's version shelf out of the artifacts on disk: every
 * older version named above, plus each Case Type's current published export,
 * whose hash is what `getExportHash()` hands completion to stamp.
 *
 * Contained per artifact, as the mock's Case partitioning is. A version file
 * that is missing or unparseable costs that one version — the Case stamped
 * against it falls back to the live bank with the standard warning, exactly as
 * it would in a deploy where the publish never wrote the file — and every other
 * version stays served.
 *
 * @param {ReadonlyArray<{ slug: string, hash: string }>} [versions]
 * @param {ReadonlyArray<{ slug: string }>} [caseTypes]
 * @returns {Promise<{ exportHashes: Record<string, string>, versionedExports: Record<string, VersionedExport> }>}
 */
export async function buildQuestionBankVersions(
  versions = PUBLISHED_BANK_VERSIONS,
  caseTypes = CASE_TYPES
) {
  /** @type {Record<string, VersionedExport>} */
  const versionedExports = {};
  /** @type {Record<string, string>} */
  const exportHashes = {};

  for (const { slug, hash } of versions) {
    try {
      versionedExports[hash] = await readArtifact(
        versionedExportName(slug, hash)
      );
    } catch (error) {
      console.error(
        `[CORA] Published Question Bank version ${hash} for "${slug}" could not be read; a Case stamped with it falls back to the live bank:`,
        error
      );
    }
  }

  for (const { slug } of caseTypes) {
    try {
      const current = await readArtifact(currentExportName(slug));
      if (typeof current?.hash !== 'string' || current.hash === '') continue;
      exportHashes[slug] = current.hash;
      versionedExports[current.hash] = current;
    } catch (error) {
      console.error(
        `[CORA] Current published export for "${slug}" could not be read; the mock serves no current version for it:`,
        error
      );
    }
  }

  return { exportHashes, versionedExports };
}
