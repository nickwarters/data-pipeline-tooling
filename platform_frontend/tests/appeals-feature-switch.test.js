// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const features = await import('../src/config/features.js');
const { APPEALS_ENABLED } = features;
const { evaluateAccess } = await import('../src/services/section-access.js');
const { visibleDashboardPanels } =
  await import('../src/pages/dashboard/panel-descriptors.js');
const { reasonsForCapabilities } =
  await import('../src/services/action-centre-model.js');
const { loadKpiModel } = await import('../src/evaluators/kpi-strip-model.js');
const { createRouteSlice } = await import('../src/pages/cora-dashboard.js');

/**
 * The Appeals feature switch, tested at all five places that read it.
 *
 * This file exists only for as long as the switch does, and goes when it goes.
 * Its job is to make the switched-off state a stated behaviour rather than an
 * accident of five separate edits — so that a gate lost in a rebase fails here,
 * loudly, instead of quietly putting a half-built journey back in front of a
 * user.
 *
 * The complement is the Appeal *policy*, which is still exercised where it
 * always was: the access rows via `matrixMode` in the section-access suites,
 * and the Appeal actions, effects and views by their own untouched suites. The
 * code is unreachable, not unmaintained.
 *
 * The removal procedure is `docs/guide/feature-switches.md`. In short: the
 * feature is enabled by DELETING the constant and every `if` that reads it,
 * never by setting it to `true` — which is what the first test here enforces.
 */

const APPEAL_SECTIONS = /** @type {const} */ ([
  'appealRequest',
  'appealReview',
]);

/** @param {Partial<import('../src/services/permissions.js').Capabilities>} [o] */
function caps(o = {}) {
  return makePermissions({ isReviewer: false, ...o });
}

/** @param {Partial<import('../src/sharepoint-client.js').CaseRow>} [o] */
function completedCase(o = {}) {
  return makeCaseRow({
    status: 'Completed',
    appeals: [
      {
        id: 'ap1',
        appellant: 'someone',
        at: '2026-07-01T00:00:00Z',
        rationale: 'wrong outcome',
        state: 'raised',
      },
    ],
    ...o,
  });
}

test('the switch is a hard-coded false, and the module carries nothing else', () => {
  assert.equal(APPEALS_ENABLED, false);
  assert.equal(
    typeof APPEALS_ENABLED,
    'boolean',
    'the switch is a boolean constant, not a function or a resolved value'
  );
  // A switch is enabled by deletion, not by flipping. If this file still exists
  // and the constant reads `true`, the removal was done half way: every `if`
  // reading it is now permanently true and standing where it will not be
  // recognised as removable. Delete the constant and its five `if`s instead.
  assert.deepEqual(
    Object.keys(features),
    ['APPEALS_ENABLED'],
    'features.js holds switches only; move anything else out'
  );
});

test('gate 1: neither Appeal Section is reachable, for any role, on any Case', () => {
  // The strongest case for each tab: a Completed Case with an open Appeal, the
  // configured raiser, and Controls — the exact conditions under which the
  // MATRIX rows grant `edit`.
  for (const raisedBy of /** @type {const} */ ([
    'responsiblePartyManager',
    'journeyOwner',
  ])) {
    const config = /** @type {any} */ ({ appeal: { raisedBy } });
    for (const section of APPEAL_SECTIONS) {
      for (const role of /** @type {const} */ ([
        'assignedReviewer',
        'otherReviewer',
        'reviewerManager',
        'responsibleParty',
        'responsiblePartyManager',
        'caseTypeOwner',
        'journeyOwner',
        'controls',
        'none',
      ])) {
        assert.equal(
          evaluateAccess(section, [role], completedCase(), config),
          'hidden',
          `${section} × ${role} with ${raisedBy} raising`
        );
      }
    }
  }
});

test('gate 1: Amend Outcome is deliberately NOT gated', () => {
  // Controls amends a reportable Case's Outcome whether or not an Appeal
  // prompted it, so the switch must not reach this tab. A change that hides it
  // has over-applied the gate.
  assert.equal(
    evaluateAccess(
      'amendOutcome',
      ['controls'],
      completedCase(),
      /** @type {any} */ ({})
    ),
    'edit'
  );
});

test('gate 2: the Controls Appeals panel is not composed', () => {
  assert.equal(
    visibleDashboardPanels(caps({ isControls: true })).includes('appeals'),
    false
  );
});

test('gate 3: the dashboard issues no Appeals fan-out', async () => {
  let calls = 0;
  const context = /** @type {any} */ ({
    chrome: {
      currentUser: { id: 'me' },
      permissions: caps({ isControls: true }),
    },
    caseSources: [
      { slug: 'complaints', listName: 'Cases-Complaints', displayName: 'C' },
    ],
    allocationSources: [],
    client: {
      /** @param {any} _f @param {any} _o */
      async listCases(_f, _o) {
        return [];
      },
      /** @param {any} _f @param {any} _o */
      async countCases(_f, _o) {
        return 0;
      },
    },
    appEl: document.createElement('main'),
  });
  const slice = createRouteSlice(
    {},
    context,
    /** @type {any} */ ({
      listAcrossSources: async () => [],
      loadKpis: async () => [],
      loadAppeals: async () => {
        calls += 1;
        return [];
      },
    })
  );
  slice.start({
    context,
    params: {},
    dispatch: () => {},
    listen: (
      /** @type {any} */ target,
      /** @type {string} */ type,
      /** @type {any} */ listener
    ) => target.addEventListener(type, listener),
    isActive: () => true,
  });
  // One turn is enough: the effect is issued synchronously inside `start()` or
  // not at all, so nothing is pending that could still call through.
  await Promise.resolve();
  assert.equal(
    calls,
    0,
    'loadAppeals must not be called while appeals are off'
  );
});

test('gate 4: the Controls KPI lane is absent, and costs no count request', async () => {
  /** @type {any[]} */
  const countCalls = [];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ ({
      /** @param {any} f @param {any} o */
      async countCases(f, o) {
        countCalls.push([f, o]);
        return 7;
      },
      /** @param {any} _f @param {any} _o */
      async listCases(_f, _o) {
        return [];
      },
    }),
    currentUserId: 'me',
    capabilities: caps({ isControls: true }),
    allCaseSources: [
      { slug: 'complaints', listName: 'Cases-Complaints', displayName: 'C' },
    ],
    now: new Date('2026-07-04T00:00:00Z'),
  });
  assert.equal(
    lanes.some((l) => l.role === 'controls'),
    false
  );
  assert.deepEqual(countCalls, []);
});

test('gate 5: no capability qualifies for the Appeals worklist group', () => {
  for (const c of [
    caps({ isControls: true }),
    caps({ isReviewer: true, isControls: true }),
    caps({ isControls: true, ownedCaseTypes: ['complaints'] }),
  ]) {
    assert.equal(
      reasonsForCapabilities(c).some((r) => r.id === 'appeals'),
      false
    );
  }
});

test('the Appeal code itself is intact and importable', async () => {
  // The point of the switch is that Appeals are unreachable, not absent. If
  // these modules are deleted or emptied while the switch stands, the switch has
  // become cover for a removal, and turning the feature back on is a rewrite
  // rather than the six-step edit the guide describes.
  const [state, actions, effects, view, reviewView] = await Promise.all([
    import('../src/evaluators/appeal-state.js'),
    import('../src/pages/cora-case-review/appeal-actions.js'),
    import('../src/pages/cora-case-review/appeal-effects.js'),
    import('../src/pages/cora-case-review/appeal-view.js'),
    import('../src/pages/cora-case-review/appeal-review-view.js'),
  ]);
  assert.equal(typeof state.openAppealOf, 'function');
  assert.equal(typeof actions.raiseAppeal, 'function');
  assert.equal(typeof actions.resolveAppeal, 'function');
  assert.equal(typeof actions.amendOutcome, 'function');
  assert.equal(typeof effects.createAppealEffects, 'function');
  assert.equal(typeof view.AppealSection, 'function');
  assert.equal(typeof reviewView.AppealReviewSection, 'function');
});
