// @ts-check
/**
 * @typedef {import('./manifest.js').CaseTypeEntry} CaseTypeEntry
 */

import { loadBank } from './load-bank.js';

/**
 * THE Case Types this application has, one frozen entry each.
 *
 * **Everything here is a thunk, and that is load-bearing rather than stylistic.**
 * `slug` and `displayName` must be readable without evaluating a Case Type
 * module, because the boot-critical *synchronous* permissions config composes
 * each type's three SharePoint group names from its display name. Static
 * imports would drag every Case Type config into boot and break that.
 *
 * So this list is deliberately unlike `APP_CONFIG.sectionPlugins` and
 * `pagePlugins`, which hold their modules as static imports. Those are cheap and
 * needed at boot; these are expensive and needed on demand. Do not "tidy" the
 * three into one shape — the asymmetry is the whole point, and the contract test
 * over this file's static imports is what stops it happening by accident.
 *
 * A separate module from the composition root, and from the manifest that
 * derives from it, because both read it and neither may reach the other:
 * `app-config.js` pulls in every Section plugin and page module, and those
 * reach `services/permissions.js`, which reads the manifest. A manifest that
 * imported the config would close that loop and read `APP_CONFIG` while it was
 * still being evaluated — a boot that fails with a temporal-dead-zone error,
 * which is what happens if you try it.
 *
 * `bank` is optional: a Case Type may be registered before its Question Bank
 * artifact exists (the scaffold path), in which case it simply does not appear
 * in the bank editor.
 *
 * @type {readonly CaseTypeEntry[]}
 */
export const CASE_TYPE_ENTRIES = Object.freeze([
  Object.freeze({
    slug: 'complaints',
    displayName: 'Complaints',
    importer: () => import('./complaints.js'),
    bank: () => loadQuestionBank('./banks/complaints.txt'),
  }),
]);

/**
 * @param {string} path
 * @returns {Promise<{ default: import('../src/pages/question-bank/question-bank-source.js').QuestionBank }>}
 */
async function loadQuestionBank(path) {
  return { default: await loadBank(path) };
}
