// @ts-check

/** @typedef {import('../_dom-stub.js').StubEl} StubEl */
/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */

import {
  installDom,
  ConnectingStubEl,
  useElementClass,
  waitForRender,
} from '../_dom-stub.js';

installDom();

useElementClass(ConnectingStubEl, { registry: true });

// ===== IMPORTS (after stubs) =====
export const { ResponsiblePartyDashboard } =
  await import('../../src/pages/cora-responsible-party-dashboard.js');

export const { CORACaseTable } =
  await import('../../src/components/collections/cora-case-table.js');

/**
 * Find CORACaseTable instances by walking _children (custom-element tagNames
 * aren't set to the real tag name in h() output beyond what document.createElement gives).
 * @param {any} root
 * @returns {any[]}
 */
export function findCaseTables(root) {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  function walk(n) {
    if (n instanceof CORACaseTable) out.push(n);
    for (const c of n._children ?? []) walk(c);
  }
  walk(root);
  return out;
}

/**
 * Find a section by className and return the CORACaseTable inside.
 * @param {any} root
 * @param {string} sectionClass
 */
export function caseTableInSection(root, sectionClass) {
  for (const sec of findAll(root, 'section')) {
    if (sec.className === sectionClass) {
      const tables = findCaseTables(sec);
      return tables[0];
    }
  }
  return undefined;
}

/**
 * Walk the tree and collect all elements with matching tagName.
 * @param {any} root
 * @param {string} tag
 * @returns {StubEl[]}
 */
export function findAll(root, tag) {
  /** @type {StubEl[]} */
  const out = [];
  /** @param {any} n */
  function walk(n) {
    if (n.tagName === tag.toUpperCase()) out.push(n);
    for (const c of n._children ?? []) walk(c);
  }
  walk(root);
  return out;
}

export const now = new Date();

export const todayStart = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate()
);

/** @returns {CaseRow} */
export function makeCase(/** @type {Partial<CaseRow>} */ overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'example-review',
    title: 'Example Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-c1',
    ...overrides,
  };
}

/** Single-source case list, used by tests that don't care about fan-out. */
export const oneSource = [
  {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    displayName: 'Example Review',
  },
];

/**
 * @param {CaseRow[]} rows
 * @param {Array<{ filter: ListCasesFilter, opts: any }>} [callLog]
 */
export function makeClient(rows, callLog) {
  return {
    async listCases(/** @type {ListCasesFilter} */ f, /** @type {any} */ opts) {
      callLog?.push({ filter: f, opts });
      return rows.map((c) => ({ ...c }));
    },
  };
}

/** @param {any} host @returns {number | undefined} */
export function outcomeTotal(host) {
  const dd = findAll(host, 'dd').find(
    (d) => d.className === 'cora-rp-outcome-total'
  );
  return dd ? Number(dd.textContent) : undefined;
}

/** @param {any} host @param {string} label @returns {number | undefined} */
export function outcomeCount(host, label) {
  const dd = findAll(host, 'dd').find(
    (d) => d.className === `cora-rp-outcome-${label.toLowerCase()}`
  );
  return dd ? Number(dd.textContent) : undefined;
}

/** @param {any} host @param {string} month @returns {Record<string, number> | null} */
export function outcomeMonthRow(host, month) {
  const section = findAll(host, 'section').find(
    (s) => s.className === 'cora-rp-outcome-summary'
  );
  if (!section) return null;
  const table = findAll(section, 'table')[0];
  if (!table) return null;
  const rows = findAll(table, 'tr');
  const [headerRow, ...bodyRows] = rows;
  const labels = headerRow._children.slice(1).map((th) => th.textContent);
  const row = bodyRows.find((r) => r._children[0].textContent === month);
  if (!row) return null;
  /** @type {Record<string, number>} */
  const counts = {};
  labels.forEach((label, i) => {
    counts[label] = Number(row._children[i + 1].textContent);
  });
  return counts;
}

export { waitForRender };
