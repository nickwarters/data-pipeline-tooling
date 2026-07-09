// @ts-check
/**
 * Loads sample Cases for the Question Bank impact simulator.
 *
 * Reads a capped sample of historical Cases per bank slug through the
 * SharePointClient interface (read-only — `listCases` only) and publishes
 * them into the store's `sampleCases` signal for the compile drawer to
 * simulate against. Under `?mock=1` this samples the dev fixtures, so the
 * simulator works in the mock-first dev loop with no extra wiring.
 */

import { cases, setSampleCases } from './question-bank-store.js';

/** Cap per bank so the drawer stays a preview, not a full report. */
export const SAMPLE_CASE_LIMIT = 25;

/**
 * @param {import('../sharepoint-client.js').CaseRow} row
 * @returns {import('./question-bank-simulate.js').SampleCase}
 */
function toSampleCase(row) {
  return { id: row.id, title: row.title, answers: row.answers ?? {} };
}

/**
 * @param {Pick<import('../sharepoint-client.js').SharePointClient, 'listCases'>} client
 * @param {string[]} [slugs] bank slugs to sample; defaults to every bank in the store
 * @returns {Promise<void>}
 */
export async function loadSampleCases(
  client,
  slugs = Object.keys(cases.get())
) {
  await Promise.all(
    slugs.map(async (slug) => {
      try {
        const rows = await client.listCases({ caseType: slug });
        setSampleCases(
          slug,
          rows.slice(0, SAMPLE_CASE_LIMIT).map(toSampleCase)
        );
      } catch {
        // A bank without a reachable Case list simply has no samples; the
        // drawer shows its empty state rather than the editor failing.
        setSampleCases(slug, []);
      }
    })
  );
}
