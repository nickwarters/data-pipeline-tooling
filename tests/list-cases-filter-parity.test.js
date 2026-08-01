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
 * Fields the two engines deliberately do not treat alike, each with the reason
 * it is recorded rather than fixed. Named here so a *new* divergence still
 * fails the scan below.
 */
const RECORDED_DIVERGENCES = {
  caseType:
    'Every Case Type has its own SharePoint list, so the server-side query ' +
    'scopes by list name and has no CaseType condition; the mock stores ' +
    'several Case Types in one store and filters on the field.',
};

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
    Status: row.status,
    AssignedReviewerId: personId(row.assignedReviewer),
    ResponsiblePartyId: personId(row.responsibleParty),
    AssignedReviewerManagerId: personId(row.assignedReviewerManager),
    DueDate: row.dueDate ?? null,
    CompletedAt: row.completedAt ?? null,
    EffectiveOutcome: row.effectiveOutcome ?? null,
    OutcomeOverridden: row.outcomeOverridden ? 1 : 0,
    AwaitingResponsibleParty: row.awaitingResponsibleParty ? 1 : 0,
    ReviewRequired: row.reviewRequired ? 1 : 0,
    OnHold: row.onHold ? 1 : 0,
    HasOpenAppeal: row.hasOpenAppeal ? 1 : 0,
    Reopened: row.reopened ? 1 : 0,
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
    name: 'reviewRequired',
    filter: { reviewRequired: true },
    rows: [caseRow('flagged', { reviewRequired: true }), caseRow('clear')],
    expected: ['flagged'],
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
    name: 'reopened',
    filter: { reopened: true },
    rows: [caseRow('back', { reopened: true }), caseRow('first-pass')],
    expected: ['back'],
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
    name: 'anyOf',
    filter: { anyOf: [{ onHold: true }, { reopened: true }] },
    rows: [
      caseRow('parked', { onHold: true }),
      caseRow('back', { reopened: true }),
      caseRow('plain'),
    ],
    expected: ['parked', 'back'],
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

  const recorded = new Set(Object.keys(RECORDED_DIVERGENCES));
  const onlyInMock = [...mockFields].filter(
    (field) => !odataFields.has(field) && !recorded.has(field)
  );
  const onlyInOdata = [...odataFields].filter(
    (field) => !mockFields.has(field) && !recorded.has(field)
  );
  assert.deepEqual(
    onlyInMock,
    [],
    'a field the mock filters on but the server-side query ignores'
  );
  assert.deepEqual(
    onlyInOdata,
    [],
    'a field the server-side query filters on but the mock ignores'
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

  const uncovered = [...mockFields, ...odataFields].filter(
    (field) => !covered.has(field) && !recorded.has(field)
  );
  assert.deepEqual(
    uncovered,
    [],
    'every filter field either has a parity scenario or is a recorded divergence'
  );
});

// --- the divergences this suite records rather than repairs ---

test('listCases: a Case Type filter is a mock-only concept — the server-side query scopes by list', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (call) => call.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ value: [] }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await client.listCases({ caseType: 'complaints' }, { listName: LIST });

  const url = decodeURIComponent(calls[0].url);
  assert.ok(!url.includes('CaseType'), RECORDED_DIVERGENCES.caseType);

  // The mock, whose stores are not per-Case-Type in every test, does filter.
  assert.deepEqual(
    await mockMatches({ caseType: 'complaints' }, [
      caseRow('here'),
      caseRow('elsewhere', { caseType: 'other-review' }),
    ]),
    ['here']
  );
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
