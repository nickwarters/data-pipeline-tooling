// @ts-check
/**
 * Report Feeds are JSON stored in `.txt` files because the document library's
 * handling of `.json` is unreliable. A missing artifact means that the
 * Reviewer has no settled work in the window, so 404 is an empty feed rather
 * than a failed read. Production files live in the document library outside
 * the deployed code tree; the mock URL is only fetched when mock mode is on.
 */

import { resolveHostWebUrl } from './create-sharepoint-client.js';

const REPORT_FEED_DIRECTORY = '/Shared%20Documents/cora_report_feeds/my-stats';
const MOCK_REPORT_FEED_URL = new URL(
  '../../dev/fixtures/my-stats/123456.txt',
  import.meta.url
);

/**
 * @typedef {{
 *   schema_version: 1,
 *   reviewer_account: string,
 *   generated_at: string,
 *   complete_through: string,
 *   rows: { date: string, case_type: string, count: number }[],
 * }} ReportFeedEnvelope
 */

/**
 * @param {string} bareAccount account id already reduced by the SharePoint client boundary
 * @param {{
 *   fetch?: typeof globalThis.fetch,
 *   search?: string,
 *   signal?: AbortSignal,
 *   hostWebUrl?: string,
 * }} [options]
 * @returns {Promise<ReportFeedEnvelope | null>}
 */
export async function loadReportFeed(
  bareAccount,
  {
    fetch = globalThis.fetch,
    search = globalThis.location?.search ?? '',
    signal,
    hostWebUrl = resolveHostWebUrl(),
  } = {}
) {
  const mock = new URLSearchParams(search).get('mock') === '1';
  const accountKey = bareAccount.toLowerCase();
  const url = mock
    ? MOCK_REPORT_FEED_URL.href
    : `${hostWebUrl.replace(/\/+$/, '')}${REPORT_FEED_DIRECTORY}/${encodeURIComponent(accountKey)}.txt`;
  const response = await fetch(url, { signal });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Report Feed request failed with HTTP ${response.status}`);
  }
  const envelope = await response.json();
  // The loader gates the supported version; the rendering slice owns
  // validation of the version-specific fields when it consumes the envelope.
  if (envelope?.schema_version !== 1) {
    throw new Error('Unsupported Report Feed schema version');
  }
  return /** @type {ReportFeedEnvelope} */ (envelope);
}

const REPORT_FEED_ROOT = '/Shared%20Documents/cora_report_feeds';
const MOCK_REPORT_ROOT = new URL(
  '../../dev/fixtures/reports/',
  import.meta.url
);

/**
 * @typedef {{ status: 'loaded', envelope: import('../reports/contract.js').ReportEnvelope }
 *   | { status: 'missing' }
 *   | { status: 'forbidden' }} ReportFileResult
 */

/**
 * @param {string} path e.g. `case-types/complaints/case-type.txt`
 * @param {{
 *   schemaVersion: number,
 *   fetch?: typeof globalThis.fetch,
 *   search?: string,
 *   signal?: AbortSignal,
 *   hostWebUrl?: string,
 * }} options
 * @returns {Promise<ReportFileResult>}
 */
export async function loadReportFile(
  path,
  {
    schemaVersion,
    fetch = globalThis.fetch,
    search = globalThis.location?.search ?? '',
    signal,
    hostWebUrl,
  }
) {
  const segments = path.split('/');
  if (
    path.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '..')
  ) {
    throw new TypeError(`report file path must be relative: ${path}`);
  }
  const mock = new URLSearchParams(search).get('mock') === '1';
  const url = mock
    ? new URL(path, MOCK_REPORT_ROOT).href
    : `${(hostWebUrl ?? resolveHostWebUrl()).replace(/\/+$/, '')}${REPORT_FEED_ROOT}/${segments
        .map(encodeURIComponent)
        .join('/')}`;
  const response = await fetch(url, { signal });

  if (response.status === 404) return { status: 'missing' };
  if (response.status === 401 || response.status === 403) {
    return { status: 'forbidden' };
  }
  if (!response.ok) {
    throw new Error(`Report Feed request failed with HTTP ${response.status}`);
  }
  const envelope = await response.json();
  if (envelope?.schema_version !== schemaVersion) {
    throw new Error('Unsupported Report Feed schema version');
  }
  if (
    envelope.datasets === null ||
    typeof envelope.datasets !== 'object' ||
    Array.isArray(envelope.datasets)
  ) {
    throw new Error('Report Feed has no datasets');
  }
  return { status: 'loaded', envelope };
}
