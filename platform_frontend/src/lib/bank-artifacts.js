// @ts-check
/**
 * THE naming rule for every Question Bank artifact on disk.
 *
 * A Case past the reportable milestone stores the version identity it was
 * reviewed against and resolves its questions by looking that identity up as a
 * file. Three things therefore have to agree on one filename — the app's read,
 * the publish write, and the repository gate — so the rule lives here.
 *
 * Both kinds sit in `case-types/banks/`, and both are **JSON text in a `.txt`
 * file**, because SharePoint Subscription Edition blocks or mis-serves `.json`:
 *
 * | Artifact          | Name                  | Mutability                   |
 * | ----------------- | --------------------- | ---------------------------- |
 * | Current bank      | `{slug}.txt`          | edited freely                |
 * | Published version | `{slug}.{hash}.txt`   | append-only, never rewritten |
 *
 * There is no current-version pointer. The bank *is* the current version, and
 * `bank-version.js` says what its identity is.
 */

/** The directory every bank artifact lives in, relative to `case-types/`. */
export const BANKS_DIR = 'banks';

/**
 * The editable current bank: the artifact the Question Bank editor compiles and
 * the Case Type config loads.
 *
 * @param {string} slug
 * @returns {string}
 */
export function bankArtifactName(slug) {
  return `${slug}.txt`;
}

/**
 * One immutable published version. Never overwritten: a version some reportable
 * Case resolves its questions from has to stay readable for as long as the Case
 * does.
 *
 * @param {string} slug
 * @param {string} hash
 * @returns {string}
 */
export function versionedExportName(slug, hash) {
  return `${slug}.${hash}.txt`;
}

/**
 * @typedef {{ kind: 'bank' | 'versioned-export', slug: string, segment: string | null }} BankArtifact
 */

/**
 * Reads a `case-types/banks/` filename back as the kind of artifact it is, so
 * the repository gate can hold each kind to its own shape instead of checking
 * every `.txt` in the directory against the bank contract.
 *
 * A slug carries no `.`, so the first dot separates it from the kind. An
 * unrecognised name yields `null` rather than a guess — the gate reports it as
 * a stray file, which is what a name nothing can classify actually is.
 *
 * @param {string} filename a bare filename, not a path
 * @returns {BankArtifact | null}
 */
export function classifyBankArtifact(filename) {
  if (!filename.endsWith('.txt')) return null;
  const stem = filename.slice(0, -'.txt'.length);
  const firstDot = stem.indexOf('.');
  if (firstDot === -1) {
    return stem ? { kind: 'bank', slug: stem, segment: null } : null;
  }
  const slug = stem.slice(0, firstDot);
  const rest = stem.slice(firstDot + 1);
  if (!slug) return null;
  if (/^[0-9a-f]{64}$/.test(rest)) {
    return { kind: 'versioned-export', slug, segment: rest };
  }
  return null;
}
