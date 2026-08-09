// @ts-check
import { toBareAccount } from './account-name.js';
import { resolveHostWebUrl } from './create-sharepoint-client.js';

const REPORT_FEED_DIRECTORY = '/Shared%20Documents/cora_report_feeds/my-stats';
const MOCK_REPORT_FEED_URL = new URL(
  '../../dev/fixtures/my-stats/123456.txt',
  import.meta.url
);

/**
 * @typedef {{
 *   schema_version: number,
 *   reviewer_account: string,
 *   generated_at: string,
 *   complete_through: string,
 *   rows: { date: string, case_type: string, count: number }[],
 * }} ReportFeedEnvelope
 */

/**
 * @param {string} account
 * @param {{
 *   fetch?: typeof globalThis.fetch,
 *   search?: string,
 *   signal?: AbortSignal,
 *   hostWebUrl?: string,
 * }} [options]
 * @returns {Promise<ReportFeedEnvelope | null>}
 */
export async function loadReportFeed(
  account,
  {
    fetch = globalThis.fetch,
    search = globalThis.location?.search ?? '',
    signal,
    hostWebUrl = resolveHostWebUrl(),
  } = {}
) {
  const mock = new URLSearchParams(search).get('mock') === '1';
  const accountKey = toBareAccount(account).toLowerCase();
  const url = mock
    ? MOCK_REPORT_FEED_URL.href
    : `${hostWebUrl.replace(/\/+$/, '')}${REPORT_FEED_DIRECTORY}/${accountKey}.txt`;
  const response = await fetch(url, { signal });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Report Feed request failed with HTTP ${response.status}`);
  }
  return response.json();
}
