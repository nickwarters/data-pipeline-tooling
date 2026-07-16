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

import { setSampleCases } from './question-bank-store.js';

/** Cap per bank so the drawer stays a preview, not a full report. */
export const SAMPLE_CASE_LIMIT = 25;

/**
 * @param {import('../../sharepoint-client.js').CaseRow} row
 * @returns {import('./question-bank-simulate.js').SampleCase}
 */
function toSampleCase(row) {
  return { id: row.id, title: row.title, answers: row.answers ?? {} };
}

/**
 * @param {Pick<import('../../sharepoint-client.js').SharePointClient, 'listCases'>} client
 * @param {import('../../setup/resolve-eligible-case-types.js').CaseSource[]} [sources] Case sources to sample; defaults to none
 * @returns {Promise<void>}
 */
export async function loadSampleCases(client, sources = []) {
  await Promise.all(
    sources.map(async (source) => {
      try {
        const rows = await client.listCases(
          { caseType: source.slug },
          { listName: source.listName }
        );
        setSampleCases(
          source.slug,
          rows.slice(0, SAMPLE_CASE_LIMIT).map(toSampleCase)
        );
      } catch {
        // A bank without a reachable Case list simply has no samples; the
        // drawer shows its empty state rather than the editor failing.
        setSampleCases(source.slug, []);
      }
    })
  );
}
