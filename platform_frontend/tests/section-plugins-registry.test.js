// @ts-check
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import {
  registerSectionPlugin,
  getSectionPlugins,
  getSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';
import { SECTION_REGISTRY } from '../src/lib/section-registry.js';

installDom();

beforeEach(() => {
  resetSectionRegistry();
});

test('getSectionPlugins initially returns plugins for all SECTION_REGISTRY entries plus registered plugins', () => {
  const plugins = getSectionPlugins();
  const ids = plugins.map((p) => p.id);
  for (const entry of SECTION_REGISTRY) {
    assert.ok(ids.includes(entry.id));
  }
  assert.ok(ids.includes('adminDetails'));
});

test('getSectionPlugin returns plugin by id or undefined if missing', () => {
  const details = getSectionPlugin('details');
  assert.ok(details);
  assert.equal(details.id, 'details');
  assert.equal(details.tab, true);
  assert.equal(details.tabOrder, 1);
  assert.deepEqual(details.defaultLabels, {
    tab: 'Details',
    heading: 'Case Details',
  });

  const unknown = getSectionPlugin('nonExistent');
  assert.equal(unknown, undefined);
});

test('registerSectionPlugin registers a new plugin and overrides existing', () => {
  /** @type {any} */
  const customPlugin = {
    id: 'customSection',
    tab: true,
    tabOrder: 99,
    defaultLabels: { tab: 'Custom', heading: 'Custom Section' },
    evaluateAccess: () => 'read-only',
    view: () => null,
  };

  registerSectionPlugin(customPlugin);
  assert.equal(getSectionPlugin('customSection'), customPlugin);

  // Override details
  const detailsOverride = {
    ...customPlugin,
    id: 'details',
  };
  registerSectionPlugin(detailsOverride);
  assert.equal(getSectionPlugin('details'), detailsOverride);
});

test('adapter shim evaluateAccess delegates to MATRIX', () => {
  const details = getSectionPlugin('details');
  assert.ok(details);

  // Case details for assignedReviewer is read-only
  const mode = details.evaluateAccess({
    caseRow: /** @type {any} */ ({ status: 'Allocated' }),
    roles: ['assignedReviewer'],
  });
  assert.equal(mode, 'read-only');

  // Case details for responsibleParty is hidden
  const hiddenMode = details.evaluateAccess({
    caseRow: /** @type {any} */ ({ status: 'Allocated' }),
    roles: ['responsibleParty'],
  });
  assert.equal(hiddenMode, 'hidden');
});

test('adapter shim view delegates to SECTION_PANELS', () => {
  const details = getSectionPlugin('details');
  assert.ok(details);
  assert.equal(typeof details.view, 'function');

  const panelContext = /** @type {any} */ ({
    snapshot: {
      machine: {},
      sectionLabels: { details: { heading: 'Custom Heading' } },
      access: { details: 'read-only' },
    },
    caseRow: { id: '123' },
    config: { detailFields: [] },
    route: { voidReason: null, voidReasonNote: '', voidPanelOpen: false },
    dispatch: () => {},
    actions: {},
  });

  const rendered = details.view(panelContext);
  assert.ok(rendered !== undefined);
});
