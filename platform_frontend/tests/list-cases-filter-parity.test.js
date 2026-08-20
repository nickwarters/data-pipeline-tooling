// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { matchesFilter } from './_odata-filter.js';
import {
  WEB_URL,
  peopleFilterFetch,
  makeFetch,
} from './helpers/http-sharepoint-client.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */

/** @type {ListCasesFilter} */
// @ts-expect-error Case Type scope belongs to CaseListOptions.listName.
const _invalidListCasesFilter = { caseType: 'complaints' };

// Capability: the two Case-query engines answer the same question.
//
// `listCases` is served by two implementations — an in-memory predicate for the
// mock-first dev loop and an OData `$filter` for SharePoint. They are written
// separately and drift separately, and a rule that drifts is invisible: each
// engine looks self-consistent while a dashboard shows one population and the
// dev loop another. Every scenario below is checked three ways — mock, server
// query, and a hand-written list of the ids that ought to match — so the two
// engines agreeing with each other is not enough to pass.
//
// Time is not injectable into the SharePoint query builder (it stamps
// `new Date()` as it builds), so the fixtures sit decades either side of any
// plausible run date rather than near a boundary, and every date is written at
// the same `…Z` millisecond precision so a string comparison of two ISO dates
// means what it looks like it means.

const LIST = 'Cases-Parity';

const PERSONAS = { reviewer: { groups: ['Reviewers'] } };

// The directory the SharePoint client resolves account names through: Person
// columns hold numeric ids, so a person filter is a number server-side and an
// account name in the mock.
/** @type {Record<string, number>} */
const PERSON_IDS = { 'rev-a': 11, 'rev-b': 12, 'rp-a': 21, 'mgr-a': 31 };

const LONG_PAST = '2001-02-03T04:05:06.000Z';
const MID_PAST = '2001-03-03T04:05:06.000Z';
const LATE_PAST = '2001-04-03T04:05:06.000Z';
const LONG_FUTURE = '2098-02-03T04:05:06.000Z';

/**
 * @param {string} id
 * @param {Partial<CaseRow>} [over]
 * @returns {CaseRow}
 */
function caseRow(id, over = {}) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: id,
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: `etag-${id}`,
    ...over,
  });
}

/**
 * Project a Case row into the SharePoint list item the server would hold for
 * it. Written out by hand on purpose: deriving it from the client's own column
 * mapping would make the server-side half of every assertion agree with the
 * code it is checking.
 *
 * @param {CaseRow} row
 * @returns {Record<string, unknown>}
 */
function toListItem(row) {
  /** @param {string | null | undefined} account */
  const personId = (account) =>
    account ? (PERSON_IDS[account] ?? null) : null;
  return {
    Id: row.id,
    Title: row.title,
    Status: row.status,
    ReportableAt: row.reportableAt ?? null,
    AssignedReviewerId: personId(row.assignedReviewer),
    ResponsiblePartyId: personId(row.responsibleParty),
    AssignedReviewerManagerId: personId(row.assignedReviewerManager),
    DueDate: row.dueDate ?? null,
    CompletedAt: row.completedAt ?? null,
    VoidedAt: row.voidedAt ?? null,
    EffectiveOutcome: row.effectiveOutcome ?? null,
    OutcomeOverridden: row.outcomeOverridden ? 1 : 0,
    AwaitingResponsibleParty: row.awaitingResponsibleParty ? 1 : 0,
    OnHold: row.onHold ? 1 : 0,
    HasOpenAppeal: row.hasOpenAppeal ? 1 : 0,
  };
}

/**
 * The ids the mock returns for a filter, through its public read.
 *
 * @param {ListCasesFilter} filter
 * @param {CaseRow[]} rows
 * @returns {Promise<string[]>}
 */
async function mockMatches(filter, rows) {
  const client = new MockSharePointClient({
    lists: { [LIST]: rows },
    personas: PERSONAS,
  });
  const matched = await client.listCases(filter, { listName: LIST });
  return matched.map((row) => row.id);
}

/**
 * The ids the SharePoint query would return: run the real client against a fake
 * fetch, take the `$filter` it sent, and evaluate it over the projected rows.
 *
 * @param {ListCasesFilter} filter
 * @param {CaseRow[]} rows
 * @returns {Promise<string[]>}
 */
async function odataMatches(filter, rows) {
  const { fetch, calls } = peopleFilterFetch(PERSON_IDS);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await client.listCases(filter, { listName: LIST });
  const itemsCall = calls.filter((call) => call.url.includes('/items?')).pop();
  const expr =
    new URL(String(itemsCall?.url)).searchParams.get('$filter') ?? '';
  return rows
    .filter((row) => matchesFilter(expr, toListItem(row)))
    .map((row) => row.id);
}

// --- the scenarios ---

const OVERDUE_ROWS = [
  caseRow('open-late', { dueDate: LONG_PAST }),
  caseRow('open-early', { dueDate: LONG_FUTURE }),
  caseRow('open-undated'),
  caseRow('sent-late', { status: 'Actions In Progress', dueDate: LONG_PAST }),
  caseRow('done-late', {
    status: 'Completed',
    completedAt: MID_PAST,
    dueDate: LONG_PAST,
  }),
];

const COMPLETED_ROWS = [
  caseRow('done-early', { status: 'Completed', completedAt: LONG_PAST }),
  caseRow('done-mid', { status: 'Completed', completedAt: MID_PAST }),
  caseRow('done-late', { status: 'Completed', completedAt: LATE_PAST }),
  caseRow('never-done'),
];

const REPORTABLE_ROWS = [
  caseRow('rep-early', { reportableAt: LONG_PAST }),
  caseRow('rep-mid', { reportableAt: MID_PAST }),
  caseRow('rep-late', { reportableAt: LATE_PAST }),
  caseRow('never-reportable'),
];

const VOIDED_ROWS = [
  caseRow('void-early', { status: 'Void', voidedAt: LONG_PAST }),
  caseRow('void-mid', { status: 'Void', voidedAt: MID_PAST }),
  caseRow('void-late', { status: 'Void', voidedAt: LATE_PAST }),
  caseRow('never-voided'),
];

// Titles sharing partial prefixes, so a prefix filter genuinely separates them
// rather than passing on any anchored match. `cr-109` pins the case-insensitive
// answer: SharePoint's `startswith` ignores case, so both engines must too.
const TITLE_ROWS = [
  caseRow('CR-100'),
  caseRow('CR-101'),
  caseRow('XX-100'),
  caseRow('mixed-case', { title: 'cr-109' }),
];

/** @type {Array<{ name: string, filter: ListCasesFilter, rows: CaseRow[], expected: string[] }>} */
const SCENARIOS = [
  {
    name: 'status',
    filter: { status: 'Completed' },
    rows: [
      caseRow('open'),
      caseRow('done', { status: 'Completed', completedAt: MID_PAST }),
    ],
    expected: ['done'],
  },
  {
    name: 'assignedReviewer',
    filter: { assignedReviewer: 'rev-a' },
    rows: [
      caseRow('mine', { assignedReviewer: 'rev-a' }),
      caseRow('theirs', { assignedReviewer: 'rev-b' }),
    ],
    expected: ['mine'],
  },
  {
    name: 'responsibleParty',
    filter: { responsibleParty: 'rp-a' },
    rows: [
      caseRow('theirs', { responsibleParty: 'rp-a' }),
      caseRow('others', { responsibleParty: 'rev-b' }),
    ],
    expected: ['theirs'],
  },
  {
    name: 'assignedReviewerManager',
    filter: { assignedReviewerManager: 'mgr-a' },
    rows: [
      caseRow('managed', { assignedReviewerManager: 'mgr-a' }),
      caseRow('elsewhere', { assignedReviewerManager: 'rev-b' }),
    ],
    expected: ['managed'],
  },
  {
    name: 'overdue',
    filter: { overdue: true },
    rows: OVERDUE_ROWS,
    expected: ['open-late'],
  },
  {
    name: 'overdue negated',
    filter: { overdue: false },
    rows: OVERDUE_ROWS,
    // A null due date is not overdue — no clock has passed — and a status the
    // review clock does not run in is not overdue however old the date.
    expected: ['open-early', 'open-undated', 'sent-late', 'done-late'],
  },
  {
    name: 'onHold with overdue negated (the Action Centre On Hold group)',
    filter: { onHold: true, overdue: false },
    rows: [
      caseRow('parked', { onHold: true, dueDate: LONG_FUTURE }),
      caseRow('parked-late', { onHold: true, dueDate: LONG_PAST }),
      caseRow('running-late', { dueDate: LONG_PAST }),
    ],
    expected: ['parked'],
  },
  {
    name: 'effectiveOutcome',
    filter: { effectiveOutcome: 'fail' },
    rows: [
      caseRow('failed', { effectiveOutcome: 'fail' }),
      caseRow('passed', { effectiveOutcome: 'pass' }),
    ],
    expected: ['failed'],
  },
  {
    name: 'outcomeOverridden',
    filter: { outcomeOverridden: true },
    rows: [
      caseRow('amended', { outcomeOverridden: true }),
      caseRow('untouched', { outcomeOverridden: false }),
    ],
    expected: ['amended'],
  },
  {
    name: 'awaitingResponsibleParty',
    filter: { awaitingResponsibleParty: true },
    rows: [
      caseRow('waiting', { awaitingResponsibleParty: true }),
      caseRow('answered'),
    ],
    expected: ['waiting'],
  },
  {
    name: 'onHold',
    filter: { onHold: true },
    rows: [caseRow('parked', { onHold: true }), caseRow('running')],
    expected: ['parked'],
  },
  {
    name: 'hasOpenAppeal',
    filter: { hasOpenAppeal: true },
    rows: [caseRow('appealed', { hasOpenAppeal: true }), caseRow('accepted')],
    expected: ['appealed'],
  },
  {
    name: 'completedAfter',
    filter: { completedAfter: MID_PAST },
    rows: COMPLETED_ROWS,
    expected: ['done-mid', 'done-late'],
  },
  {
    name: 'completedBefore',
    filter: { completedBefore: LATE_PAST },
    rows: COMPLETED_ROWS,
    expected: ['done-early', 'done-mid'],
  },
  {
    name: 'reportableAfter',
    filter: { reportableAfter: MID_PAST },
    rows: REPORTABLE_ROWS,
    expected: ['rep-mid', 'rep-late'],
  },
  {
    name: 'reportableBefore',
    filter: { reportableBefore: LATE_PAST },
    rows: REPORTABLE_ROWS,
    expected: ['rep-early', 'rep-mid'],
  },
  {
    name: 'voidedAfter',
    filter: { voidedAfter: MID_PAST },
    rows: VOIDED_ROWS,
    expected: ['void-mid', 'void-late'],
  },
  {
    name: 'voidedBefore',
    filter: { voidedBefore: LATE_PAST },
    rows: VOIDED_ROWS,
    expected: ['void-early', 'void-mid'],
  },
  {
    name: 'titlePrefix',
    filter: { titlePrefix: 'CR-1' },
    rows: TITLE_ROWS,
    expected: ['CR-100', 'CR-101', 'mixed-case'],
  },
  {
    name: 'anyOf',
    filter: { anyOf: [{ onHold: true }, { hasOpenAppeal: true }] },
    rows: [
      caseRow('parked', { onHold: true }),
      caseRow('queued', { hasOpenAppeal: true }),
      caseRow('plain'),
    ],
    expected: ['parked', 'queued'],
  },
  {
    // The Action Centre's In progress group nests an `anyOf` inside the
    // headline's `anyOf`, and ANDs a person alongside it. Neither engine had a
    // caller doing that before the group existed.
    name: 'a nested anyOf, scoped to one reviewer',
    filter: {
      anyOf: [
        {
          anyOf: [{ status: 'In-progress' }, { status: 'Actions In Progress' }],
          assignedReviewer: 'rev-a',
        },
      ],
    },
    rows: [
      caseRow('mine-open', {
        status: 'In-progress',
        assignedReviewer: 'rev-a',
      }),
      caseRow('mine-sent', {
        status: 'Actions In Progress',
        assignedReviewer: 'rev-a',
      }),
      caseRow('mine-done', {
        status: 'Completed',
        assignedReviewer: 'rev-a',
      }),
      caseRow('theirs-open', {
        status: 'In-progress',
        assignedReviewer: 'rev-b',
      }),
    ],
    expected: ['mine-open', 'mine-sent'],
  },
  {
    name: 'status and overdue together',
    filter: { status: 'In-progress', overdue: true },
    rows: OVERDUE_ROWS,
    expected: ['open-late'],
  },
  {
    name: 'assignedReviewer and overdue together',
    filter: { assignedReviewer: 'rev-a', overdue: true },
    rows: [
      caseRow('mine-late', { assignedReviewer: 'rev-a', dueDate: LONG_PAST }),
      caseRow('mine-early', {
        assignedReviewer: 'rev-a',
        dueDate: LONG_FUTURE,
      }),
      caseRow('theirs-late', {
        assignedReviewer: 'rev-b',
        dueDate: LONG_PAST,
      }),
    ],
    expected: ['mine-late'],
  },
];

// The one scenario the table above cannot hold, because it matches nothing by
// design: an OR of no branches. Left to itself the server-side query emits no
// condition for it and silently widens to the whole list, where the mock
// predicate answers "nothing matches" — a scoping bug rather than a cosmetic
// one, so the two are pinned together here.
test('listCases parity: an anyOf with no branches matches nothing on either engine', async () => {
  const rows = [caseRow('parked', { onHold: true }), caseRow('plain')];
  assert.deepEqual(await mockMatches({ anyOf: [] }, rows), []);
  assert.deepEqual(await odataMatches({ anyOf: [] }, rows), []);
});

for (const scenario of SCENARIOS) {
  test(`listCases parity: ${scenario.name}`, async () => {
    // A scenario that matched everything, or nothing, would pass while both
    // engines were broken the same way.
    assert.ok(
      scenario.expected.length > 0 &&
        scenario.expected.length < scenario.rows.length,
      'the scenario must separate some rows from others'
    );

    assert.deepEqual(
      (await mockMatches(scenario.filter, scenario.rows)).sort(),
      [...scenario.expected].sort(),
      'the mock predicate must match the hand-written expectation'
    );
    assert.deepEqual(
      (await odataMatches(scenario.filter, scenario.rows)).sort(),
      [...scenario.expected].sort(),
      'the server-side $filter must match the hand-written expectation'
    );
  });
}

// --- the filter evaluator this suite checks against is itself checked ---

test('$filter evaluator: `and` binds tighter than `or`', () => {
  // `A or B and C` is `A or (B and C)`. Read the other way round it would be
  // `(A or B) and C`, which answers differently for a row matching only A —
  // and the whole suite would then be measuring the wrong server.
  const expr = "Status eq 'a' or Status eq 'b' and OnHold eq 1";
  assert.equal(matchesFilter(expr, { Status: 'a', OnHold: 0 }), true);
  assert.equal(matchesFilter(expr, { Status: 'b', OnHold: 0 }), false);
  assert.equal(matchesFilter(expr, { Status: 'b', OnHold: 1 }), true);
});

test('$filter evaluator: parentheses override the default precedence', () => {
  const expr = "(Status eq 'a' or Status eq 'b') and OnHold eq 1";
  assert.equal(matchesFilter(expr, { Status: 'a', OnHold: 0 }), false);
  assert.equal(matchesFilter(expr, { Status: 'a', OnHold: 1 }), true);
});

test('$filter evaluator: startswith is anchored, case-insensitive, and empty-column-blind', () => {
  const expr = "startswith(Title,'CR-1')";
  assert.equal(matchesFilter(expr, { Title: 'CR-100' }), true);
  assert.equal(matchesFilter(expr, { Title: 'cr-100' }), true);
  assert.equal(matchesFilter(expr, { Title: 'XCR-100' }), false);
  assert.equal(matchesFilter(expr, { Title: null }), false);
  assert.equal(matchesFilter(expr, {}), false);
  // A quote in the literal arrives doubled, as the client escapes it.
  assert.equal(
    matchesFilter("startswith(Title,'O''B')", { Title: "O'Brien" }),
    true
  );
});

// --- every filter field both engines handle has a scenario ---

// A source scan that quietly reads too little is worse than no scan: it passes
// while reporting a smaller field set than the engine really handles. So the
// body is delimited by counting braces to the real closing one — not by looking
// for the first line that happens to look like an end — and every way the scan
// can fail to see a whole body is an assertion, never a shrug.

/**
 * The smallest number of `filter.<name>` reads a real `listCases`
 * implementation can plausibly contain. Both engines are well above it; a
 * result under it means the scan read a fragment, not a body.
 */
const MIN_FILTER_FIELDS = 12;

/**
 * The source text of the function whose body opens at `header`, from the header
 * through its matching closing brace. Strings, template literals and comments
 * are skipped so a brace inside one cannot end the body early, and running off
 * the end of the file fails loudly instead of returning what was read so far.
 *
 * @param {string} source
 * @param {string} header must end at the body's opening brace
 * @returns {string}
 */
function functionBodyAt(source, header) {
  assert.ok(header.endsWith('{'), 'the scan starts at the body opening brace');
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `could not find ${header}`);
  assert.equal(
    source.indexOf(header, start + 1),
    -1,
    `${header} appears more than once, so the scan cannot say which body it read`
  );

  // Top of the stack is the text the scanner is currently inside. `code` is
  // pushed by a template substitution and popped by its closing brace.
  const modes = ['code'];
  let depth = 1;
  let i = start + header.length;
  for (; i < source.length && depth > 0; i += 1) {
    const mode = modes[modes.length - 1];
    const char = source[i];
    const pair = source.slice(i, i + 2);
    if (mode === 'line-comment') {
      if (char === '\n') modes.pop();
    } else if (mode === 'block-comment') {
      if (pair === '*/') {
        modes.pop();
        i += 1;
      }
    } else if (mode === "'" || mode === '"') {
      if (char === '\\') i += 1;
      else if (char === mode) modes.pop();
    } else if (mode === 'template') {
      if (char === '\\') i += 1;
      else if (char === '`') modes.pop();
      else if (pair === '${') {
        modes.push('code');
        depth += 1;
        i += 1;
      }
    } else if (pair === '//') {
      modes.push('line-comment');
      i += 1;
    } else if (pair === '/*') {
      modes.push('block-comment');
      i += 1;
    } else if (char === "'" || char === '"' || char === '`') {
      modes.push(char === '`' ? 'template' : char);
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (modes.length > 1) modes.pop();
    }
  }

  assert.equal(depth, 0, `the braces in ${header} never balanced`);
  assert.deepEqual(
    modes,
    ['code'],
    `a string or comment in ${header} never closed`
  );
  const body = source.slice(start, i);
  assert.ok(body.endsWith('}'), `the extracted body of ${header} is truncated`);
  return body;
}

/**
 * The `filter.<name>` reads inside one implementation. Scanning the source is
 * how a field handled by one engine and forgotten by the other is found —
 * reading the typedef instead would only ever list what was declared, which is
 * the half that never drifts.
 *
 * @param {string} source
 * @param {string} header
 * @returns {Set<string>}
 */
function filterFieldsIn(source, header) {
  const body = functionBodyAt(source, header);
  const fields = new Set(
    [...body.matchAll(/filter\.([A-Za-z]+)/g)].map((m) => m[1])
  );
  assert.ok(
    fields.size >= MIN_FILTER_FIELDS,
    `only ${fields.size} filter fields found in ${header} — the scan read a fragment`
  );
  return fields;
}

test('listCases parity: both engines handle the same filter fields, and every field has a scenario', async () => {
  const httpSource = await readFile(
    new URL('../src/services/http-sharepoint-client.js', import.meta.url),
    'utf8'
  );
  const mockSource = await readFile(
    new URL('../src/services/mock-sharepoint-client.js', import.meta.url),
    'utf8'
  );
  const odataFields = filterFieldsIn(
    httpSource,
    'function buildFilterExpr(filter) {'
  );
  const mockFields = filterFieldsIn(mockSource, '_predicate(filter) {');

  const mockFieldList = [...mockFields].sort();
  const odataFieldList = [...odataFields].sort();
  assert.deepEqual(
    mockFieldList,
    odataFieldList,
    'the mock and server-side query must handle identical filter fields'
  );

  /** @type {Set<string>} */
  const covered = new Set();
  /** @param {ListCasesFilter} filter */
  const collect = (filter) => {
    for (const [key, value] of Object.entries(filter)) {
      covered.add(key);
      if (key === 'anyOf')
        for (const branch of /** @type {ListCasesFilter[]} */ (value))
          collect(branch);
    }
  };
  for (const scenario of SCENARIOS) collect(scenario.filter);

  const uncovered = mockFieldList.filter((field) => !covered.has(field));
  assert.deepEqual(uncovered, [], 'every filter field has a parity scenario');
});

test('listCases: a Case placed on hold is still overdue once its due date passes', async () => {
  // Nothing in the model stops the review clock for a parked Case, and this
  // pins that answer rather than leaving it to be discovered: an on-hold Case
  // past its due date counts as overdue in both engines. Changing that is a
  // product decision, not a tidy-up.
  const rows = [
    caseRow('parked-late', { onHold: true, dueDate: LONG_PAST }),
    caseRow('parked-early', { onHold: true, dueDate: LONG_FUTURE }),
  ];
  assert.deepEqual(await mockMatches({ overdue: true }, rows), ['parked-late']);
  assert.deepEqual(await odataMatches({ overdue: true }, rows), [
    'parked-late',
  ]);
});
