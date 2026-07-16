// @ts-check

/** @typedef {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} QuestionBank */

/**
 * Load a standalone Question Bank artifact as JSON text.
 *
 * SharePoint can be unreliable for `.json` storage/MIME behavior, so bank
 * artifacts are stored as `.txt` and parsed explicitly. Node tests import Case
 * Type modules from `file:` URLs, where `fetch()` cannot read the file, so the
 * loader uses `fs` only for local file URLs.
 *
 * @param {string | URL} path
 * @returns {Promise<QuestionBank>}
 */
export async function loadBank(path) {
  const url = new URL(path, import.meta.url);
  const text =
    url.protocol === 'file:'
      ? await readLocalFile(url)
      : await readRemoteText(url);
  return /** @type {QuestionBank} */ (JSON.parse(text));
}

/**
 * @param {URL} url
 * @returns {Promise<string>}
 */
async function readRemoteText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Unable to load Question Bank ${url.href}: ${response.status}`
    );
  }
  return response.text();
}

/**
 * @param {URL} url
 * @returns {Promise<string>}
 */
async function readLocalFile(url) {
  const { readFile } = await import('node:fs/promises');
  return readFile(url, 'utf8');
}
