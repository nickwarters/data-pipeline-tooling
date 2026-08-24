// @ts-check

/** @param {string} value */
function encodeRoutePart(value) {
  return encodeURIComponent(value);
}

/**
 * @param {import('../sharepoint-client.js').CaseRow} row
 * @returns {string}
 */
export function caseRouteFor(row) {
  return `#/case/${encodeRoutePart(row.caseType)}/${encodeRoutePart(row.id)}`;
}
