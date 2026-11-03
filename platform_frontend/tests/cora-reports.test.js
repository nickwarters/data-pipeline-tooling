// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeChrome } from './helpers/fixtures.js';
import {
  getByRole,
  getByText,
  queryAllByRole,
  queryByRole,
} from './helpers/semantic-dom.js';

installDom();

const reportsPage = await import('../src/pages/cora-reports.js');
const reportPage = await import('../src/pages/cora-report.js');

/** @typedef {import('../src/reports/contract.js').ReportPlugin} ReportPlugin */

/**
 * @param {string} id
 * @param {ReportPlugin['access']} access
 * @returns {ReportPlugin}
 */
function report(id, access) {
  return {
    id,
    title: `${id} report`,
    description: `What ${id} shows.`,
    layout: 'stacked',
    access,
    scope: { kind: 'case-type' },
    feeds: {
      report: {
        path: (scope) => `case-types/${scope.key}/${id}.txt`,
        schemaVersion: 1,
      },
    },
    view: () => ({}),
  };
}

const REPORTS = [
  report('owned', [{ role: 'caseTypeOwner', of: 'scope' }]),
  report('controls-only', ['controls']),
];

/**
 * @param {Partial<import('../src/services/permissions.js').Capabilities>} permissions
 * @param {readonly ReportPlugin[] | undefined} [reportPlugins]
 */
function indexFor(permissions, reportPlugins = REPORTS) {
  const slice = reportsPage.createRouteSlice(
    {},
    /** @type {any} */ ({
      chrome: makeChrome({ permissions }),
      reportPlugins,
    })
  );
  assert.equal(slice.reducer(slice.initialState), slice.initialState);
  return slice.view(slice.initialState);
}

test('the reports index lists only the reports a viewer can open, each linking to its scopes', () => {
  const page = indexFor({ ownedCaseTypes: ['complaints', 'example-review'] });
  assert.ok(getByRole(page, 'heading', { name: 'owned report' }));
  assert.equal(
    queryByRole(page, 'heading', { name: 'controls-only report' }),
    null
  );
  assert.ok(getByText(page, 'What owned shows.'));

  const scopes = getByRole(page, 'list', { name: 'owned report scopes' });
  const links = scopes.querySelectorAll('a');
  assert.deepEqual(
    links.map((/** @type {any} */ link) => link.getAttribute('href')),
    ['#/reports/owned/complaints', '#/reports/owned/example-review']
  );
  assert.deepEqual(
    links.map((/** @type {any} */ link) => link.textContent),
    ['Complaints', 'Example Review']
  );
});

test('a viewer no report admits sees an empty index rather than a broken one', () => {
  const page = indexFor({ ownedCaseTypes: [] });
  assert.ok(getByText(page, 'There are no reports for you yet.'));
  assert.equal(queryAllByRole(page, 'heading').length, 1);
});

test('an application with no reports configured shows the empty index', () => {
  const page = indexFor({ isControls: true }, []);
  assert.ok(getByText(page, 'There are no reports for you yet.'));
  const unconfigured = reportsPage.createRouteSlice(
    {},
    /** @type {any} */ ({
      chrome: makeChrome({ permissions: { isControls: true } }),
    })
  );
  assert.ok(
    getByText(
      unconfigured.view(unconfigured.initialState),
      'There are no reports for you yet.'
    )
  );
});

test('a report page finds its report by the id in the URL', () => {
  const slice = /** @type {any} */ (
    reportPage.createRouteSlice(
      { report: 'owned', scope: 'complaints' },
      /** @type {any} */ ({
        chrome: makeChrome({ permissions: { ownedCaseTypes: ['complaints'] } }),
        reportPlugins: REPORTS,
      })
    )
  );
  assert.equal(slice.initialState.routes.report.scopeKey, 'complaints');
});

for (const [label, reportPlugins] of /** @type {const} */ ([
  ['an id no report has', REPORTS],
  ['no reports configured at all', undefined],
])) {
  test(`a report page for ${label} says there is no such report`, () => {
    const slice = /** @type {any} */ (
      reportPage.createRouteSlice(
        { report: 'nonexistent' },
        /** @type {any} */ ({
          chrome: makeChrome(),
          reportPlugins,
        })
      )
    );
    assert.equal(slice.reducer(slice.initialState), slice.initialState);
    const page = slice.view(slice.initialState);
    assert.ok(getByText(page, 'There is no such report.'));
    assert.equal(
      getByText(page, 'Back to Reports').getAttribute('href'),
      '#/reports'
    );
  });
}
