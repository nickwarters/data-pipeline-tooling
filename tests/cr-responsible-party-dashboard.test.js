// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.value = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach(h => h(e));
    return true;
  }
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs) =====
const { CRResponsiblePartyDashboard } = await import('../src/cr-responsible-party-dashboard.js');
const { CRCaseTable } = await import('../src/cr-case-table.js');

/**
 * Find CRCaseTable instances by walking _children (custom-element tagNames
 * aren't set in the stub DOM since `customElements.define` is a noop).
 * @param {any} root
 * @returns {any[]}
 */
function findCaseTables(root) {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  function walk(n) {
    if (n instanceof CRCaseTable) out.push(n);
    for (const c of n._children ?? []) walk(c);
  }
  walk(root);
  return out;
}

/**
 * Find a section by className and return the CRCaseTable inside.
 * @param {any} root
 * @param {string} sectionClass
 */
function caseTableInSection(root, sectionClass) {
  for (const sec of findAll(root, 'section')) {
    if (sec.className === sectionClass) {
      const tables = findCaseTables(sec);
      return tables[0];
    }
  }
  return undefined;
}

// ===== HELPERS =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */

/**
 * Walk the tree and collect all elements with matching tagName.
 * @param {any} root
 * @param {string} tag
 * @returns {StubEl[]}
 */
function findAll(root, tag) {
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

/** @param {any} root @param {string} tag @returns {StubEl | undefined} */
function findFirst(root, tag) { return findAll(root, tag)[0]; }

const now = new Date();
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** @returns {CaseRow} */
function makeCase(/** @type {Partial<CaseRow>} */ overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'hello-review',
    title: 'Hello Review #1',
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

/**
 * @param {CaseRow[]} rows
 * @param {ListCasesFilter[]} [callLog]
 */
function makeClient(rows, callLog) {
  return {
    async listCases(/** @type {ListCasesFilter} */ f) {
      callLog?.push(f);
      return rows.map(c => ({ ...c }));
    },
  };
}

// ===== TESTS =====

test('CRResponsiblePartyDashboard: connectedCallback does nothing when client is null', async () => {
  const el = new CRResponsiblePartyDashboard();
  el.client = null;
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal((/** @type {any} */ (el))._children.length, 0);
});

test('CRResponsiblePartyDashboard: connectedCallback does nothing when currentUserId is empty', async () => {
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient([]));
  el.currentUserId = '';
  await el.connectedCallback();
  assert.equal((/** @type {any} */ (el))._children.length, 0);
});

test('CRResponsiblePartyDashboard: calls listCases with responsibleParty filter', async () => {
  /** @type {ListCasesFilter[]} */
  const calls = [];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient([], calls));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { responsibleParty: 'user-rp' });
});

test('CRResponsiblePartyDashboard: renders 3 sections after connectedCallback', async () => {
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient([]));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  // outcome section + remediation section + messages section
  assert.equal((/** @type {any} */ (el))._children.length, 3);
});

// ===== Outcome summary tests =====

test('CRResponsiblePartyDashboard: outcome summary includes completed cases within last 12 months', async () => {
  const recentMonth = new Date(todayStart);
  recentMonth.setMonth(recentMonth.getMonth() - 2);
  const cases = [
    makeCase({ id: 'c1', status: 'Completed', completedAt: recentMonth.toISOString(), outcome: 'Pass' }),
    makeCase({ id: 'c2', status: 'Completed', completedAt: recentMonth.toISOString(), outcome: 'Fail' }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._outcomeSummary.totalCompleted, 2);
});

test('CRResponsiblePartyDashboard: outcome summary excludes completed cases older than 12 months', async () => {
  const old = new Date(todayStart);
  old.setMonth(old.getMonth() - 13);
  const recent = new Date(todayStart);
  recent.setMonth(recent.getMonth() - 1);
  const cases = [
    makeCase({ id: 'c1', status: 'Completed', completedAt: old.toISOString(), outcome: 'Pass' }),
    makeCase({ id: 'c2', status: 'Completed', completedAt: recent.toISOString(), outcome: 'Pass' }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._outcomeSummary.totalCompleted, 1, 'only the recent case counts');
});

test('CRResponsiblePartyDashboard: outcome summary excludes in-progress cases', async () => {
  const cases = [
    makeCase({ id: 'c1', status: 'In-progress', completedAt: null }),
    makeCase({ id: 'c2', status: 'Completed', completedAt: todayStart.toISOString(), outcome: 'Pass' }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._outcomeSummary.totalCompleted, 1);
});

test('CRResponsiblePartyDashboard: outcome summary groups by outcome type', async () => {
  const cases = [
    makeCase({ id: 'c1', status: 'Completed', completedAt: todayStart.toISOString(), outcome: 'Pass' }),
    makeCase({ id: 'c2', status: 'Completed', completedAt: todayStart.toISOString(), outcome: 'Pass' }),
    makeCase({ id: 'c3', status: 'Completed', completedAt: todayStart.toISOString(), outcome: 'Fail' }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._outcomeSummary.byOutcome['Pass'], 2);
  assert.equal(el._outcomeSummary.byOutcome['Fail'], 1);
});

// ===== Remediation actions table tests =====

test('CRResponsiblePartyDashboard: _remediationCases includes cases with uncompleted actions', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      answers: {
        'q-needs': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'Fix the issue', completed: false }],
        },
      },
    }),
    makeCase({ id: 'c2', answers: {} }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._remediationCases.length, 1);
  assert.equal(el._remediationCases[0].id, 'c1');
});

test('CRResponsiblePartyDashboard: _remediationCases excludes cases where all actions are completed', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      answers: {
        'q-needs': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'Fix the issue', completed: true }],
        },
      },
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._remediationCases.length, 0);
});

test('CRResponsiblePartyDashboard: remediation table renders row for each case with open actions', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      title: 'Case One',
      answers: {
        'q-1': { value: 'No', remediationActions: [{ id: 'ra-1', text: 'Action 1', completed: false }] },
      },
    }),
    makeCase({
      id: 'c2',
      title: 'Case Two',
      answers: {
        'q-2': { value: 'No', remediationActions: [{ id: 'ra-2', text: 'Action 2', completed: false }] },
      },
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  const rows = findAll(el, 'tr').filter(r => r.className.includes('cr-remediation-row'));
  assert.equal(rows.length, 2);
});

test('CRResponsiblePartyDashboard: remediation row is flagged as overdue when dueDate is past', async () => {
  const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const cases = [
    makeCase({
      id: 'c1',
      dueDate: yesterday,
      answers: { 'q-1': { value: 'No', remediationActions: [{ id: 'ra-1', text: 'Fix', completed: false }] } },
    }),
    makeCase({
      id: 'c2',
      dueDate: tomorrow,
      answers: { 'q-2': { value: 'No', remediationActions: [{ id: 'ra-2', text: 'Fix', completed: false }] } },
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  const rows = findAll(el, 'tr').filter(r => r.className.includes('cr-remediation-row'));
  const overdueRows = rows.filter(r => r.className.includes('cr-overdue'));
  assert.equal(overdueRows.length, 1, 'only the past-due case gets overdue flag');
});

test('CRResponsiblePartyDashboard: remediation table filterable by case type', async () => {
  const cases = [
    makeCase({ id: 'c1', caseType: 'hello-review', answers: { 'q-1': { value: 'No', remediationActions: [{ id: 'ra-1', text: 'A', completed: false }] } } }),
    makeCase({ id: 'c2', caseType: 'audit-review', answers: { 'q-2': { value: 'No', remediationActions: [{ id: 'ra-2', text: 'B', completed: false }] } } }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  // Apply case type filter
  el._setCaseTypeFilter('hello-review');
  const rows = findAll(el, 'tr').filter(r => r.className.includes('cr-remediation-row'));
  assert.equal(rows.length, 1);
  // Case Type is the second cell in the remediation column set
  const caseTypeCells = rows.map(r => r._children[1]?.textContent);
  assert.ok(caseTypeCells.every(t => t === 'hello-review'));
});

test('CRResponsiblePartyDashboard: sort by due date ascending puts earliest due first', async () => {
  const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const cases = [
    makeCase({ id: 'c2', title: 'Case Two', dueDate: nextWeek, answers: { 'q-1': { value: 'No', remediationActions: [{ id: 'ra-2', text: 'B', completed: false }] } } }),
    makeCase({ id: 'c1', title: 'Case One', dueDate: tomorrow, answers: { 'q-2': { value: 'No', remediationActions: [{ id: 'ra-1', text: 'A', completed: false }] } } }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  // Default sort is dueDate asc; Case One (tomorrow) should come before Case Two (nextWeek)
  const rows = findAll(el, 'tr').filter(r => r.className.includes('cr-remediation-row'));
  assert.equal(rows[0]._children[0].textContent, 'Case One');
  assert.equal(rows[1]._children[0].textContent, 'Case Two');
});

// ===== Unread messages table tests =====

test('CRResponsiblePartyDashboard: _unreadCases includes cases with reviewer messages after RP last reply', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        { author: 'user-rp', timestamp: '2026-05-07T09:00:00Z', body: 'My reply' },
        { author: 'user-reviewer', timestamp: '2026-05-07T10:00:00Z', body: 'Follow up question' },
      ],
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._unreadCases.length, 1);
  assert.equal(el._unreadCases[0].id, 'c1');
});

test('CRResponsiblePartyDashboard: _unreadCases includes cases with reviewer messages when RP never replied', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        { author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Please clarify' },
      ],
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._unreadCases.length, 1);
});

test('CRResponsiblePartyDashboard: _unreadCases excludes cases where RP replied after all reviewer messages', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        { author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Question' },
        { author: 'user-rp', timestamp: '2026-05-07T10:00:00Z', body: 'Answer' },
      ],
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._unreadCases.length, 0);
});

test('CRResponsiblePartyDashboard: _unreadCases excludes cases with empty conversation', async () => {
  const cases = [
    makeCase({ id: 'c1', conversation: [] }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  assert.equal(el._unreadCases.length, 0);
});

test('CRResponsiblePartyDashboard: unread messages section uses cr-case-table with only unread cases', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      title: 'Case One',
      conversation: [{ author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Q' }],
    }),
    makeCase({
      id: 'c2',
      title: 'Case Two',
      conversation: [{ author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Q' }],
    }),
    makeCase({ id: 'c3', title: 'Case Three', conversation: [] }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();
  const allTables = findCaseTables(el);
  assert.equal(allTables.length, 2, 'should have two cr-case-table instances (remediation + unread)');
  const unreadTable = caseTableInSection(el, 'cr-rp-messages');
  assert.ok(unreadTable, 'unread section should contain a cr-case-table');
  assert.equal(unreadTable.cases.length, 2, 'table should have the two unread cases');
});

test('CRResponsiblePartyDashboard: cr-case-open on unread table dispatches cr-open-conversation event', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [{ author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Q' }],
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();

  /** @type {any[]} */
  const fired = [];
  /** @type {any} */ (el).addEventListener('cr-open-conversation', (/** @type {any} */ e) => fired.push(e));

  const unreadTable = caseTableInSection(el, 'cr-rp-messages');
  assert.ok(unreadTable, 'unread section should contain a cr-case-table');
  const handler = unreadTable._listeners['cr-case-open']?.[0];
  assert.ok(handler, 'cr-case-table should have a cr-case-open listener');
  handler({ detail: { caseId: 'c1' } });
  assert.equal(fired.length, 1);
  assert.equal(fired[0].detail.caseId, 'c1');
});

test('CRResponsiblePartyDashboard: select change event calls _refreshRemediationCases via DOM event', async () => {
  const cases = [
    makeCase({ id: 'c1', caseType: 'hello-review', answers: { 'q-1': { value: 'No', remediationActions: [{ id: 'ra-1', text: 'A', completed: false }] } } }),
    makeCase({ id: 'c2', caseType: 'audit-review', answers: { 'q-2': { value: 'No', remediationActions: [{ id: 'ra-2', text: 'B', completed: false }] } } }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();

  // Find the filter select by class name
  const select = /** @type {any} */ (findAll(el, 'select').find(s => s.className === 'cr-rp-remediation-filter'));
  assert.ok(select, 'remediation filter select should exist');

  // Fire the change event with a filter value
  select.value = 'hello-review';
  for (const h of select._listeners['change'] ?? []) {
    h({ target: select });
  }

  // After filtering, only the hello-review case should appear in the remediation table
  const rows = findAll(el, 'tr').filter(r => r.className.includes('cr-remediation-row'));
  assert.equal(rows.length, 1, 'only matching case type should remain after change event');
  assert.equal(rows[0]._children[1]?.textContent, 'hello-review');
});

test('CRResponsiblePartyDashboard: Open button click dispatches cr-case-open on messages table', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [{ author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Q' }],
    }),
  ];
  const el = new CRResponsiblePartyDashboard();
  el.client = /** @type {any} */ (makeClient(cases));
  el.currentUserId = 'user-rp';
  await el.connectedCallback();

  /** @type {any[]} */
  const fired = [];
  el.addEventListener('cr-open-conversation', (/** @type {any} */ e) => fired.push(e));

  // Find the Open button in the messages section
  const messagesSection = findAll(el, 'section').find(s => s.className === 'cr-rp-messages');
  assert.ok(messagesSection, 'messages section should exist');
  const openBtn = findAll(messagesSection, 'button').find(b => b.className === 'cr-case-open-btn');
  assert.ok(openBtn, 'Open button should exist in messages table');

  // Click the open button — should dispatch cr-case-open which is handled by the table listener
  for (const h of openBtn._listeners['click'] ?? []) {
    h();
  }

  assert.equal(fired.length, 1, 'cr-open-conversation should be dispatched');
  assert.equal(fired[0].detail.caseId, 'c1');
});
