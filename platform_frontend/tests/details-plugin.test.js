// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { DetailsPlugin } from '../src/sections/details/details-plugin.js';
import { ROLES } from '../src/services/section-access.js';

installDom();

test('DetailsPlugin has correct contract properties', () => {
  assert.equal(DetailsPlugin.id, 'details');
  assert.equal(DetailsPlugin.tab, true);
  assert.equal(DetailsPlugin.tabOrder, 1);
  assert.equal(DetailsPlugin.summaryBlock, true);
  assert.equal(DetailsPlugin.summaryOrder, 1);
  assert.equal(DetailsPlugin.showInSummaryDefault, true);
  assert.deepEqual(DetailsPlugin.defaultLabels, {
    tab: 'Details',
    heading: 'Case Details',
  });
});

test('DetailsPlugin evaluates access correctly across all 9 roles', () => {
  const expectedModes = {
    assignedReviewer: 'read-only',
    otherReviewer: 'read-only',
    reviewerManager: 'read-only',
    responsibleParty: 'hidden',
    responsiblePartyManager: 'hidden',
    caseTypeOwner: 'read-only',
    journeyOwner: 'read-only',
    controls: 'read-only',
    none: 'hidden',
  };

  for (const role of ROLES) {
    const mode = DetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: [role],
    });
    assert.equal(
      mode,
      expectedModes[role],
      `expected ${expectedModes[role]} for role ${role}, got ${mode}`
    );
  }
});

test('multi-role access: most permissive mode wins across overlapping roles', () => {
  // Overlapping RP-side and reviewer-side roles: reviewer-side read-only must win
  assert.equal(
    DetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['responsibleParty', 'controls'],
    }),
    'read-only'
  );
  assert.equal(
    DetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['responsiblePartyManager', 'caseTypeOwner'],
    }),
    'read-only'
  );
  assert.equal(
    DetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['responsibleParty', 'journeyOwner'],
    }),
    'read-only'
  );
  assert.equal(
    DetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['responsiblePartyManager', 'reviewerManager'],
    }),
    'read-only'
  );

  // Purely hidden roles remain hidden
  assert.equal(
    DetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['responsibleParty', 'responsiblePartyManager'],
    }),
    'hidden'
  );
  assert.equal(
    DetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['none', 'assignedReviewer'],
    }),
    'read-only'
  );
});

test('DetailsPlugin view renders case details and void control when active', () => {
  const panelContext = /** @type {any} */ ({
    snapshot: {
      machine: {},
      sectionLabels: { details: { heading: 'Case Details Heading' } },
      access: { details: 'read-only' },
    },
    caseRow: { id: 'case-100', status: 'Allocated' },
    config: {
      detailFields: [{ id: 'ref', label: 'Reference' }],
    },
    route: {
      voidReason: null,
      voidReasonNote: '',
      voidPanelOpen: false,
      voidPending: false,
    },
    dispatch: () => {},
    actions: { onVoid: () => {} },
  });

  const rendered = DetailsPlugin.view(panelContext);
  assert.ok(Array.isArray(rendered));
  assert.ok(rendered.length >= 1);
});
