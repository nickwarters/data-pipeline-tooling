// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkBankArtifacts,
  checkCaseTypes,
  checkRouteTable,
  literalPathOf,
} from '../scripts/verify-config.js';
import { CASE_TYPES } from '../case-types/manifest.js';
import { routeTable } from '../src/setup/register-routes.js';

/**
 * A config the real `loadCaseTypeConfig` accepts, so every fixture goes through
 * the same loader the gate uses rather than a weaker stand-in.
 *
 * @param {Partial<Record<string, unknown>>} [overrides]
 * @returns {any}
 */
function demoConfig(overrides = {}) {
  return {
    listName: 'Cases-Demo',
    questions: [],
    computeOutcome: () => 'good',
    outcomeOptions: [{ id: 'good', wording: 'Good', severity: 0 }],
    defaultOutcomeId: 'good',
    ...overrides,
  };
}

/**
 * @param {any} config
 * @param {Partial<{ slug: string, displayName: string }>} [overrides]
 * @returns {any}
 */
function demoEntry(config, overrides = {}) {
  return {
    slug: 'demo',
    displayName: 'Demo',
    importer: async () => ({ default: config }),
    ...overrides,
  };
}

/**
 * @param {any[]} failures
 * @returns {string}
 */
function joined(failures) {
  return failures.map((f) => `${f.file} ${f.message}`).join('\n');
}

test('checkCaseTypes names the slug when a Case Type module throws', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      {
        slug: 'exploding',
        displayName: 'Exploding',
        importer: async () => {
          throw new Error('bad shared question key');
        },
      },
    ],
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'case-type');
  assert.match(failures[0].message, /exploding/);
  assert.match(failures[0].message, /bad shared question key/);
});

test('checkCaseTypes fails a showWhen reference to an unknown question id', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
            {
              id: 'q-2',
              text: 'Two',
              responseType: 'yes-no-na',
              showWhen: { 'q-missing': { equals: 'Yes' } },
            },
          ],
        })
      ),
    ],
  });

  assert.equal(failures.length, 1);
  const { message } = failures[0];
  assert.match(message, /demo/);
  assert.match(message, /q-2/);
  assert.match(message, /q-missing/);
});

test('checkCaseTypes accepts a showWhen reference to a deprecated question', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            {
              id: 'q-old',
              text: 'Retired',
              responseType: 'yes-no-na',
              deprecated: true,
            },
            {
              id: 'q-2',
              text: 'Two',
              responseType: 'yes-no-na',
              showWhen: { 'q-old': { equals: 'Yes' } },
            },
          ],
        })
      ),
    ],
  });

  assert.deepEqual(failures, []);
});

test('checkCaseTypes fails a missing or non-function computeOutcome', async () => {
  const missing = demoConfig();
  delete missing.computeOutcome;
  const notAFunction = demoConfig({ computeOutcome: 'good' });

  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(missing, { slug: 'no-outcome', displayName: 'No Outcome' }),
      demoEntry(notAFunction, {
        slug: 'string-outcome',
        displayName: 'String Outcome',
      }),
    ],
  });

  assert.equal(failures.length, 2);
  for (const failure of failures) {
    assert.match(failure.message, /computeOutcome/);
  }
  assert.match(joined(failures), /no-outcome/);
  assert.match(joined(failures), /string-outcome/);
});

test('checkCaseTypes fails an empty listName and an empty display name', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(demoConfig({ listName: '  ' }), { slug: 'no-list' }),
      demoEntry(demoConfig(), { slug: 'no-name', displayName: '' }),
    ],
  });

  assert.equal(failures.length, 2);
  assert.match(joined(failures), /listName/);
  assert.match(joined(failures), /displayName/);
});

test('checkCaseTypes fails a duplicate Question Definition id', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
            { id: 'q-1', text: 'Again', responseType: 'yes-no-na' },
          ],
        })
      ),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /q-1/);
  assert.match(failures[0].message, /duplicate/i);
});

test('checkCaseTypes fails a showWhen cycle', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            {
              id: 'q-1',
              text: 'One',
              responseType: 'yes-no-na',
              showWhen: { 'q-2': { equals: 'Yes' } },
            },
            {
              id: 'q-2',
              text: 'Two',
              responseType: 'yes-no-na',
              showWhen: { 'q-1': { equals: 'Yes' } },
            },
          ],
        })
      ),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /cycle/i);
});

test('checkCaseTypes fails an unknown key in sections', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(demoConfig({ sections: { details: {}, mystery: {} } })),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /mystery/);
  assert.match(failures[0].message, /sections/);
});

test('checkCaseTypes fails an unknown role in a showInSummary list', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          sections: { issues: { showInSummary: ['controls', 'auditor'] } },
        })
      ),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /auditor/);
  assert.match(failures[0].message, /sections\.issues\.showInSummary/);
});

test('checkCaseTypes accepts the boolean form of showInSummary', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          sections: {
            issues: { showInSummary: true },
            notes: { showInSummary: false },
          },
        })
      ),
    ],
  });

  assert.deepEqual(failures, [], joined(failures));
});

test('checkCaseTypes fails a showWhen node whose siblings the evaluator ignores', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
            { id: 'q-2', text: 'Two', responseType: 'yes-no-na' },
            {
              id: 'q-3',
              text: 'Three',
              responseType: 'yes-no-na',
              showWhen: {
                'q-1': { equals: 'Yes' },
                $or: [{ 'q-2': { equals: 'Yes' } }],
              },
            },
            {
              id: 'q-4',
              text: 'Four',
              responseType: 'yes-no-na',
              showWhen: {
                $and: [{ 'q-1': { equals: 'Yes' } }],
                $or: [{ 'q-2': { equals: 'Yes' } }],
              },
            },
          ],
        })
      ),
    ],
  });

  assert.equal(failures.length, 2, joined(failures));
  assert.match(joined(failures), /q-3/);
  assert.match(joined(failures), /q-4/);
  for (const failure of failures) {
    assert.match(failure.message, /ignores everything beside it/);
  }
});

test('checkCaseTypes names the question when a showWhen combinator is not an array', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
            {
              id: 'q-2',
              text: 'Two',
              responseType: 'yes-no-na',
              showWhen: { $and: { 'q-1': { equals: 'Yes' } } },
            },
          ],
        })
      ),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /demo/);
  assert.match(failures[0].message, /q-2/);
  assert.match(failures[0].message, /\$and/);
  assert.match(failures[0].message, /not an array/);
});

test('checkCaseTypes finds a non-array combinator nested inside a valid one', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
            {
              id: 'q-2',
              text: 'Two',
              responseType: 'yes-no-na',
              showWhen: { $and: [{ $or: { 'q-1': { equals: 'Yes' } } }] },
            },
          ],
        })
      ),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /\$or/);
  assert.match(failures[0].message, /not an array/);
});

test('checkCaseTypes names the question when a showWhen is not a condition object', async () => {
  // Each of these is applicable-evaluation crashing on the Case Review page:
  // the evaluator asks `'$and' in showWhen`, which throws on a primitive, and
  // an array's index keys are not question ids.
  for (const showWhen of [7, true, 'q-1', [{ 'q-1': { equals: 'Yes' } }]]) {
    const failures = await checkCaseTypes({
      caseTypes: [
        demoEntry(
          demoConfig({
            questions: [
              { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
              { id: 'q-2', text: 'Two', responseType: 'yes-no-na', showWhen },
            ],
          })
        ),
      ],
    });

    assert.equal(failures.length, 1, `showWhen: ${JSON.stringify(showWhen)}`);
    assert.match(failures[0].message, /q-2/);
    assert.match(failures[0].message, /where a condition object was expected/);
  }
});

test('checkCaseTypes names the question when a combinator holds a non-condition', async () => {
  for (const child of [5, null, 'q-1']) {
    const failures = await checkCaseTypes({
      caseTypes: [
        demoEntry(
          demoConfig({
            questions: [
              { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
              {
                id: 'q-2',
                text: 'Two',
                responseType: 'yes-no-na',
                showWhen: { $and: [child] },
              },
            ],
          })
        ),
      ],
    });

    assert.equal(failures.length, 1, `child: ${JSON.stringify(child)}`);
    assert.match(failures[0].message, /q-2/);
    assert.match(failures[0].message, /where a condition object was expected/);
  }
});

test('checkCaseTypes accepts a question with no showWhen at all', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(
        demoConfig({
          questions: [
            { id: 'q-1', text: 'One', responseType: 'yes-no-na' },
            {
              id: 'q-2',
              text: 'Two',
              responseType: 'yes-no-na',
              showWhen: undefined,
            },
          ],
        })
      ),
    ],
  });

  assert.deepEqual(failures, []);
});

test('checkCaseTypes passes over the live Case Type registry', async () => {
  assert.deepEqual(await checkCaseTypes({ caseTypes: CASE_TYPES }), []);
});

test('checkBankArtifacts fails a bank artifact that is not JSON, naming the file', () => {
  const failures = checkBankArtifacts({
    artifacts: ['case-types/banks/broken.txt'],
    readText: () => 'not json at all',
    caseTypes: [],
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'bank');
  assert.equal(failures[0].file, 'case-types/banks/broken.txt');
  assert.match(failures[0].message, /JSON/i);
});

test('checkBankArtifacts fails a bank whose top level is not an object', () => {
  const failures = checkBankArtifacts({
    artifacts: ['case-types/banks/list.txt'],
    readText: () => '[]',
    caseTypes: [],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /object/);
});

test('checkBankArtifacts fails a missing questions array, label, question id and unknown responseType', () => {
  /** @type {Record<string, string>} */
  const files = {
    'case-types/banks/noquestions.txt': JSON.stringify({
      slug: 'noquestions',
      label: 'No Questions',
    }),
    'case-types/banks/nolabel.txt': JSON.stringify({
      slug: 'nolabel',
      questions: [],
    }),
    'case-types/banks/noid.txt': JSON.stringify({
      slug: 'noid',
      label: 'No Id',
      questions: [{ text: 'Q', responseType: 'yes-no-na' }],
    }),
    'case-types/banks/badtype.txt': JSON.stringify({
      slug: 'badtype',
      label: 'Bad Type',
      questions: [{ id: 'q-1', text: 'Q', responseType: 'freeform' }],
    }),
    'case-types/banks/notext.txt': JSON.stringify({
      slug: 'notext',
      label: 'No Text',
      questions: [{ id: 'q-1', responseType: 'yes-no-na' }],
    }),
    'case-types/banks/dupid.txt': JSON.stringify({
      slug: 'dupid',
      label: 'Dup Id',
      questions: [
        { id: 'q-1', text: 'A', responseType: 'yes-no-na' },
        { id: 'q-1', text: 'B', responseType: 'yes-no-na' },
      ],
    }),
  };

  const failures = checkBankArtifacts({
    artifacts: Object.keys(files),
    readText: (rel) => files[rel],
    caseTypes: [],
  });

  assert.equal(failures.length, 6);
  const text = joined(failures);
  assert.match(text, /noquestions\.txt.*questions/);
  assert.match(text, /nolabel\.txt.*label/);
  assert.match(text, /noid\.txt.*id/);
  assert.match(text, /badtype\.txt.*responseType/);
  assert.match(text, /notext\.txt.*text/);
  assert.match(text, /dupid\.txt.*duplicate/i);
});

test('checkBankArtifacts fails a bank slug that disagrees with its filename', () => {
  const failures = checkBankArtifacts({
    artifacts: ['case-types/banks/complaints.txt'],
    readText: () =>
      JSON.stringify({
        slug: 'grievances',
        label: 'Grievances',
        questions: [],
      }),
    caseTypes: [],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /grievances/);
  assert.match(failures[0].message, /complaints/);
});

test('checkBankArtifacts fails a registry bank thunk whose artifact is absent', () => {
  const failures = checkBankArtifacts({
    artifacts: [],
    readText: () => '',
    caseTypes: [
      /** @type {any} */ ({
        slug: 'ghost',
        displayName: 'Ghost',
        importer: async () => ({ default: {} }),
        bank: () => Promise.resolve('./banks/ghost.txt'),
      }),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /ghost/);
  assert.match(failures[0].message, /case-types\/banks\/ghost\.txt/);
});

test('checkBankArtifacts reports a bank thunk it cannot read a path out of', () => {
  const path = './banks/ghost.txt';
  const failures = checkBankArtifacts({
    artifacts: [],
    readText: () => '',
    caseTypes: [
      /** @type {any} */ ({
        slug: 'computed',
        displayName: 'Computed',
        importer: async () => ({ default: {} }),
        bank: () => Promise.resolve(path),
      }),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /computed/);
  assert.match(failures[0].message, /no literal/i);
});

test('checkBankArtifacts passes over the real bank artifacts and registry', () => {
  assert.deepEqual(checkBankArtifacts({}), []);
});

test('checkRouteTable fails an entry with no page and one with two', () => {
  const failures = checkRouteTable({
    table: /** @type {any} */ ({
      pageless: { paths: ['#/pageless'] },
      both: { paths: ['#/both'], page: {}, load: async () => ({}) },
    }),
  });

  assert.equal(failures.length, 2, joined(failures));
  for (const failure of failures) {
    assert.equal(failure.kind, 'route');
    assert.equal(failure.file, 'src/setup/register-routes.js');
  }
  assert.match(joined(failures), /pageless/);
  assert.match(joined(failures), /both/);
});

test('checkRouteTable fails two entries sharing a pattern, naming both routes', () => {
  const failures = checkRouteTable({
    table: /** @type {any} */ ({
      first: { paths: ['#/twin'], page: {} },
      second: { paths: ['#/twin'], page: {} },
    }),
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'route');
  assert.match(failures[0].message, /first/);
  assert.match(failures[0].message, /second/);
  assert.match(failures[0].message, /#\/twin/);
});

test('checkRouteTable fails malformed hash patterns', () => {
  const failures = checkRouteTable({
    table: /** @type {any} */ ({
      unhashed: { paths: ['/dashboard'], page: {} },
      metachar: { paths: ['#/rep(ort)'], page: {} },
      repeated: { paths: ['#/case/:id/:id'], page: {} },
      reserved: { paths: ['#/case/:queryString'], page: {} },
      numeric: { paths: ['#/case/:1st'], page: {} },
      trailing: { paths: ['#/case/'], page: {} },
      empty: { paths: [], page: {} },
      root: { paths: ['#/'], page: {} },
    }),
  });

  const text = joined(failures);
  assert.match(text, /\/dashboard/);
  assert.match(text, /rep\(ort\)/);
  assert.match(text, /:id/);
  assert.match(text, /queryString/);
  assert.match(text, /1st/);
  assert.match(text, /#\/case\//);
  assert.match(text, /empty/);
  assert.equal(failures.length, 7, joined(failures));
});

test('checkRouteTable passes over the real route table', () => {
  const table = routeTable(/** @type {any} */ ({ journeyCaseSources: [] }));
  assert.deepEqual(checkRouteTable({ table }), []);
});

test('literalPathOf reads both thunk shapes and gives up on a computed one', () => {
  const path = './banks/complaints.txt';
  assert.equal(
    literalPathOf(() => import('../src/pages/home.js')),
    '../src/pages/home.js'
  );
  assert.equal(
    literalPathOf(() => Promise.resolve('./banks/complaints.txt')),
    './banks/complaints.txt'
  );
  assert.equal(
    literalPathOf(() => Promise.resolve(path)),
    null
  );
});

test('checkCaseTypes fails an empty remediationStatuses list', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [demoEntry(demoConfig({ remediationStatuses: [] }))],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /remediationStatuses/);
  assert.match(failures[0].message, /omit/i);
});

test('checkCaseTypes fails remediationStatuses that cannot resolve a row', async () => {
  const failures = await checkCaseTypes({
    caseTypes: [
      demoEntry(demoConfig({ remediationStatuses: ['partial', 'cancelled'] })),
    ],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /complete/);
});

test('checkCaseTypes accepts a narrowed remediationStatuses and an absent one', async () => {
  const narrowed = await checkCaseTypes({
    caseTypes: [
      demoEntry(demoConfig({ remediationStatuses: ['complete', 'cancelled'] })),
    ],
  });
  assert.deepEqual(narrowed, []);

  const absent = await checkCaseTypes({ caseTypes: [demoEntry(demoConfig())] });
  assert.deepEqual(absent, []);
});
