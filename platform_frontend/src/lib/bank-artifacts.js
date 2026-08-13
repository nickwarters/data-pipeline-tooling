// @ts-check
/**
 * THE naming rule for every Question Bank artifact on disk.
 *
 * A Case past the reportable milestone stores the version hash it was reviewed
 * against and resolves its questions by looking that hash up as a file. Three
 * things therefore have to agree on one filename — the app's read, the publish
 * write, and the repository gate that checks the artifacts — so the rule lives
 * here and nowhere else.
 *
 * All three kinds sit in the same directory as the bank they belong to,
 * `case-types/banks/`, and all three are **JSON text in a `.txt` file**:
 *
 * | Artifact          | Name                  | Mutability                   |
 * | ----------------- | --------------------- | ---------------------------- |
 * | Current bank      | `{slug}.txt`          | overwritten on publish       |
 * | Current export    | `{slug}.export.txt`   | overwritten on publish       |
 * | Versioned export  | `{slug}.{hash}.txt`   | append-only, never rewritten |
 *
 * Two constraints shape this, and both are the reason the version identity is
 * not simply pasted into the filename:
 *
 * - **`.txt`, not `.json`.** SharePoint Subscription Edition blocks or
 *   mis-serves `.json`, which is why the bank artifact has always been `.txt`
 *   and why the deploy carries an explicit carve-out for that one extension.
 *   An export is the same kind of content read the same way, so it is stored
 *   the same way.
 * - **The identity does not go into the filename as it stands.** A version
 *   identity is `sha256:<hex>`, and `:` is illegal in a Windows path and
 *   rejected outright by SharePoint. The filename carries the digest alone, so
 *   `sha256:ab…` names the file `{slug}.ab….txt`. The identity stamped on a
 *   Case row and carried in the envelope's `hash` field keeps its algorithm
 *   prefix and is never rewritten, so nothing reads a hash back out of a name.
 */

/** The directory every bank artifact lives in, relative to `case-types/`. */
export const BANKS_DIR = 'banks';

/**
 * The filename-safe form of a version hash: the digest alone, without the
 * algorithm prefix the identity carries, because a colon cannot appear in a
 * Windows or SharePoint filename. One-way on purpose — nothing reads a hash
 * back out of a name, so this never has to be inverted.
 *
 * @param {string} hash the durable `sha256:<hex>` version identity
 * @returns {string}
 */
export function versionFileSegment(hash) {
  return hash.slice(hash.lastIndexOf(':') + 1);
}

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
 * The current published export — the data-only envelope whose `hash` field is
 * the version in force, which completion stamps onto a Case row. Always equal
 * to the newest versioned export.
 *
 * @param {string} slug
 * @returns {string}
 */
export function currentExportName(slug) {
  return `${slug}.export.txt`;
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
  return `${slug}.${versionFileSegment(hash)}.txt`;
}

/**
 * @typedef {{ kind: 'bank' | 'current-export' | 'versioned-export', slug: string, segment: string | null }} BankArtifact
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
  if (rest === 'export') {
    return { kind: 'current-export', slug, segment: null };
  }
  if (/^[0-9a-f]{64}$/.test(rest)) {
    return { kind: 'versioned-export', slug, segment: rest };
  }
  return null;
}
