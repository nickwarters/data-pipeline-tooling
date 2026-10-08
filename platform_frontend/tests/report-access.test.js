// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allScopes,
  groupsForScope,
  scopesFor,
} from '../src/reports/report-access.js';
import { CASE_TYPES } from '../case-types/manifest.js';
import { permissions } from '../src/services/permissions.js';
import { makePermissions } from './helpers/fixtures.js';

/** @typedef {import('../src/reports/contract.js').ReportPlugin} ReportPlugin */

/**
 * @param {Partial<ReportPlugin>} [overrides]
 * @returns {ReportPlugin}
 */
function plugin(overrides = {}) {
  return {
    id: 'example',
    title: 'Example report',
    description: 'An example.',
    layout: 'stacked',
    access: ['maintainer', { role: 'caseTypeOwner', of: 'scope' }],
    scope: { kind: 'case-type' },
    feeds: {
      report: {
        path: (scope) => `case-types/${scope.key}/x.txt`,
        schemaVersion: 1,
      },
    },
    view: () => ({}),
    ...overrides,
  };
}

const nobody = makePermissions({ isReviewer: false });

test('a Case Type report has one scope per registered Case Type, named by its display name', () => {
  const scopes = allScopes(plugin());
  assert.deepEqual(
    scopes.map(({ key }) => key),
    CASE_TYPES.map(({ slug }) => slug)
  );
  for (const scope of scopes) {
    assert.equal(scope.kind, 'case-type');
    assert.equal(
      scope.label,
      CASE_TYPES.find(({ slug }) => slug === scope.key)?.displayName
    );
  }
});

test('a platform report has exactly one scope', () => {
  const scopes = allScopes(plugin({ scope: { kind: 'platform' } }));
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].kind, 'platform');
});

test('a Case Type Owner is admitted only to the Case Types they own', () => {
  const owner = makePermissions({ ownedCaseTypes: ['example-review'] });
  assert.deepEqual(
    scopesFor(plugin(), owner).map(({ key }) => key),
    ['example-review']
  );
});

test('a platform-wide role is admitted to every scope', () => {
  const maintainer = { ...nobody, isMaintainer: true };
  assert.deepEqual(
    scopesFor(plugin(), maintainer).map(({ key }) => key),
    CASE_TYPES.map(({ slug }) => slug)
  );
});

test('a viewer the report does not name is admitted to nothing', () => {
  assert.deepEqual(scopesFor(plugin(), nobody), []);
});

test('a role tied to a Case Type never admits anyone to a platform-wide scope', () => {
  const owner = makePermissions({ ownedCaseTypes: ['complaints'] });
  const platformReport = plugin({
    scope: { kind: 'platform' },
    access: [{ role: 'caseTypeOwner', of: 'scope' }],
  });
  assert.deepEqual(scopesFor(platformReport, owner), []);
  assert.deepEqual(
    groupsForScope(platformReport, allScopes(platformReport)[0]),
    []
  );
});

/** @type {[import('../src/reports/contract.js').PlatformRole, Partial<import('../src/services/permissions.js').Capabilities>][]} */
const PLATFORM_ROLES = [
  ['maintainer', { isMaintainer: true }],
  ['reviewer', { isReviewer: true }],
  ['adviser', { isAdviser: true }],
  ['controls', { isControls: true }],
  ['reviewerManager', { isReviewerManager: true }],
  ['responsiblePartyManager', { isResponsiblePartyManager: true }],
];

for (const [role, capability] of PLATFORM_ROLES) {
  test(`the ${role} role admits exactly the viewers who hold it`, () => {
    const report = plugin({ access: [role] });
    assert.equal(
      scopesFor(report, { ...nobody, ...capability }).length,
      CASE_TYPES.length
    );
    assert.equal(scopesFor(report, nobody).length, 0);
  });
}

/** @type {[import('../src/reports/contract.js').CaseTypeRole, keyof import('../src/services/permissions.js').Capabilities, keyof ReturnType<typeof import('../src/services/permissions.js').caseTypeGroupNames>][]} */
const CASE_TYPE_ROLES = [
  ['caseTypeOwner', 'ownedCaseTypes', 'caseTypeOwner'],
  ['journeyOwner', 'ownedJourneyCaseTypes', 'journeyOwner'],
  ['caseTypeReviewer', 'listAccessCaseTypes', 'listAccess'],
];

for (const [role, capability] of CASE_TYPE_ROLES) {
  test(`the ${role} role admits a viewer to the Case Types it covers and no others`, () => {
    const report = plugin({ access: [{ role, of: 'scope' }] });
    const viewer = { ...nobody, [capability]: ['complaints'] };
    assert.deepEqual(
      scopesFor(report, viewer).map(({ key }) => key),
      ['complaints']
    );
  });
}

test('a folder must be readable by the scope’s own group for each Case Type role', () => {
  const complaints = allScopes(plugin()).find(
    ({ key }) => key === 'complaints'
  );
  if (!complaints) throw new Error('complaints is registered');
  const report = plugin({
    access: [
      { role: 'caseTypeOwner', of: 'scope' },
      { role: 'journeyOwner', of: 'scope' },
      { role: 'caseTypeReviewer', of: 'scope' },
    ],
  });
  assert.deepEqual(groupsForScope(report, complaints), [
    'CaseTypeOwner - Complaints',
    'JourneyOwner - Complaints',
    'Reviewers - Complaints',
  ]);
});

test('a folder must be readable by each platform role’s groups, listed once and in order', () => {
  const [scope] = allScopes(plugin());
  const groups = groupsForScope(
    plugin({
      access: [
        'maintainer',
        'maintainer',
        'adviser',
        'controls',
        'reviewerManager',
        'responsiblePartyManager',
      ],
    }),
    scope
  );
  assert.deepEqual(groups, [...new Set(groups)].sort());
  for (const group of [
    permissions.maintainer,
    permissions.adviser,
    permissions.controls,
    permissions.reviewerManager,
    permissions.responsiblePartyManager,
  ]) {
    assert.ok(groups.includes(group), group);
  }
});

test('the reviewer role needs every group that makes someone a Reviewer', () => {
  const [scope] = allScopes(plugin());
  const groups = groupsForScope(plugin({ access: ['reviewer'] }), scope);
  assert.ok(groups.includes(permissions.reviewer));
  for (const { displayName } of permissions.caseTypes) {
    assert.ok(groups.includes(`Reviewers - ${displayName}`), displayName);
  }
});

test('a named group admits its members to every scope of the report', () => {
  const report = plugin({ access: [{ group: 'Housing Report Readers' }] });
  const member = makePermissions({
    isReviewer: false,
    groups: ['Housing Report Readers'],
  });
  assert.deepEqual(scopesFor(report, member), allScopes(report));
  const platformReport = plugin({
    scope: { kind: 'platform' },
    access: [{ group: 'Housing Report Readers' }],
  });
  assert.deepEqual(
    scopesFor(platformReport, member),
    allScopes(platformReport)
  );
});

test('a named group admits nobody outside it, however many roles they hold', () => {
  const report = plugin({
    scope: { kind: 'platform' },
    access: [{ group: 'Housing Report Readers' }],
  });
  const busy = makePermissions({
    isMaintainer: true,
    ownedCaseTypes: ['complaints'],
    groups: ['CORA Owner Delegates', 'Housing Report Readers - Old'],
  });
  assert.deepEqual(scopesFor(report, busy), []);
});

test('a named group sits beside the roles in one audience', () => {
  const report = plugin({
    scope: { kind: 'platform' },
    access: ['maintainer', { group: 'Housing Report Readers' }],
  });
  const maintainer = makePermissions({ isMaintainer: true });
  const member = makePermissions({ groups: ['Housing Report Readers'] });
  assert.equal(scopesFor(report, maintainer).length, 1);
  assert.equal(scopesFor(report, member).length, 1);
  assert.deepEqual(groupsForScope(report, allScopes(report)[0]), [
    'CORA Owner Delegates',
    'Housing Report Readers',
  ]);
});

test('a folder must be readable by a named group in every scope', () => {
  const report = plugin({ access: [{ group: 'Housing Report Readers' }] });
  for (const scope of allScopes(report)) {
    assert.deepEqual(groupsForScope(report, scope), ['Housing Report Readers']);
  }
});

for (const rule of [
  'auditor',
  { role: 'caseTypeOwner', of: 'everything' },
  { role: 'auditor', of: 'scope' },
  { group: '' },
  { group: '   ' },
  { group: 42 },
]) {
  test(`an unknown access rule (${JSON.stringify(rule)}) fails loudly instead of admitting nobody`, () => {
    const report = plugin({ access: [/** @type {any} */ (rule)] });
    assert.throws(() => scopesFor(report, nobody), /unknown report role/);
    assert.throws(
      () => groupsForScope(report, allScopes(report)[0]),
      /unknown report role/
    );
  });
}
