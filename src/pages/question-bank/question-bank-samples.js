// @ts-check
/**
 * Loads sample Cases for the Question Bank impact simulator.
 *
 * Reads a capped sample of historical Cases per bank slug through the
 * SharePointClient interface (read-only — `listCases` only) and publishes
 * returns them to the route effect for dispatch. Under `?mock=1` this samples
 * the dev fixtures, so the simulator works in the mock-first dev loop with no
 * extra wiring.
 */

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
 * @returns {Promise<Record<string, import('./question-bank-simulate.js').SampleCase[]>>}
 */
export async function loadSampleCases(client, sources = []) {
  const entries = await Promise.all(
    sources.map(async (source) => {
      try {
        const rows = await client.listCases(
          { caseType: source.slug },
          { listName: source.listName }
        );
        return [
          source.slug,
          rows.slice(0, SAMPLE_CASE_LIMIT).map(toSampleCase),
        ];
      } catch {
        // A bank without a reachable Case list simply has no samples; the
        // drawer shows its empty state rather than the editor failing.
        return [source.slug, []];
      }
    })
  );
  return Object.fromEntries(entries);
}
