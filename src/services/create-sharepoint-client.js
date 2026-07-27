// @ts-check
import { resolveEnvironment } from '../config/environment.js';

/**
 * Instantiates the correct SharePointClient for the current environment.
 * Pass `?mock=1` to get a MockSharePointClient backed by dev fixtures.
 * Pass `?asUser=<persona>` to select a fixture persona (default: 'reviewer').
 *
 * `env` (ADR-0033) scopes the real HTTP client to the deployment
 * environment's lists and export path; it never affects the mock client.
 *
 * @param {URLSearchParams} params
 * @param {import('../config/environment.js').Environment} [env]
 * @returns {Promise<import('../sharepoint-client.js').SharePointClient>}
 */
export async function createSharePointClient(
  params,
  env = resolveEnvironment()
) {
  if (params.get('mock') === '1') {
    const persona = params.get('asUser') ?? 'reviewer';
    const [
      { MockSharePointClient },
      { loadCaseTypeConfig },
      { cases },
      { personas },
      { people },
      { roadmapItems },
    ] = await Promise.all([
      import('./mock-sharepoint-client.js'),
      import('../../case-types/manifest.js'),
      import('../../dev/fixtures/cases.js'),
      import('../../dev/fixtures/personas.js'),
      import('../../dev/fixtures/people.js'),
      import('../../dev/fixtures/roadmap.js'),
    ]);

    // Every Case Type declares its own SharePoint list via `listName`; its
    // Cases are read/written list-scoped. Partition the flat fixture array by
    // each Case Type's `listName` into the mock client's per-list stores.
    // There is no default store — the partition is total. The fixture Cases are
    // complaints-only (issue #383); example-review is a test-only fixture and is
    // not served by the mock client.
    const lists = await partitionCasesByList(cases, (slug) =>
      loadCaseTypeConfig(slug)
    );

    return new MockSharePointClient({
      personas,
      persona,
      people,
      lists,
      roadmapItems,
    });
  }

  const { HttpSharePointClient } = await import('./http-sharepoint-client.js');
  return new HttpSharePointClient({
    webUrl: resolveHostWebUrl(),
    listPrefix: env.listPrefix,
    exportBasePath: env.exportBasePath,
  });
}

/**
 * The web the host page belongs to, from SharePoint's `_spPageContextInfo`.
 * Without this, every `/_api/...` path resolves root-relative against the web
 * application root — on a site-path deployment (`/sites/cora`) that is a web
 * the user has no access to, so boot dies in an NTLM 401 credential-prompt
 * loop (#464). Server-relative is preferred over absolute so Alternate Access
 * Mapping / proxy hosts never disagree with the page's own origin. Empty when
 * there is no SharePoint page context (dev loop), preserving root-relative
 * behaviour there.
 *
 * @param {unknown} [ctx] defaults to the host page's `_spPageContextInfo`.
 * @returns {string}
 */
export function resolveHostWebUrl(
  ctx = /** @type {Record<string, unknown>} */ (globalThis)._spPageContextInfo
) {
  const info = /** @type {Record<string, unknown> | undefined} */ (ctx);
  const url = info?.webServerRelativeUrl ?? info?.webAbsoluteUrl ?? '';
  return typeof url === 'string' ? url : '';
}

/**
 * Partition a flat fixture Case array into per-list stores, keyed by each Case
 * Type's declared `listName`. The partition is total — there is no default
 * store — so a Case Type whose config declares no list cannot have its Cases
 * placed anywhere.
 *
 * Contained per Case Type, exactly as the HTTP path is. This runs inside
 * `createSharePointClient`, which boot awaits before `resolveAppCaseSources`, so
 * a Case Type module that throws here — or one that declares no `listName` —
 * would otherwise take the whole app down under `?mock=1`. Its Cases are dropped
 * and the failure reported; the other Case Types still load. Dropping never
 * widens access: a read without a `listName` still throws, and there is no
 * default store to fall back to.
 *
 * The failure goes to the console rather than the boot banner, and takes no
 * injection seam to say so. This is the `?mock=1` dev path; both of the ways a
 * Case Type fails here — the module throws, or its config declares no
 * `listName` — fail `resolveAppCaseSources` for the same Case Type moments
 * later, so the banner already names it. A reporter parameter would be
 * production API with only test callers, which is the same trade this change
 * declined when it kept `loadCaseTypeSources` un-exported.
 *
 * @param {import('../sharepoint-client.js').CaseRow[]} cases
 * @param {(slug: string) => Promise<import('../sharepoint-client.js').CaseTypeConfig>} loadCaseTypeConfig
 * @returns {Promise<Record<string, import('../sharepoint-client.js').CaseRow[]>>}
 */
export async function partitionCasesByList(cases, loadCaseTypeConfig) {
  /** @type {Record<string, string>} */
  const listNameByCaseType = {};
  for (const caseType of new Set(cases.map((c) => c.caseType))) {
    try {
      const config = await loadCaseTypeConfig(caseType);
      if (!config.listName) {
        throw new Error(
          `partitionCasesByList: Case Type "${caseType}" declares no listName; ` +
            `every fixture Case must map to a named list (there is no default store).`
        );
      }
      listNameByCaseType[caseType] = config.listName;
    } catch (error) {
      console.error(
        `[CORA] Case Type "${caseType}" failed to load; its mock Cases are unavailable:`,
        error
      );
    }
  }

  /** @type {Record<string, import('../sharepoint-client.js').CaseRow[]>} */
  const lists = {};
  for (const c of cases) {
    const listName = listNameByCaseType[c.caseType];
    // A contained Case Type has no list: its Cases are dropped, never pooled
    // into a default bucket.
    if (listName === undefined) continue;
    (lists[listName] ??= []).push(c);
  }
  return lists;
}
