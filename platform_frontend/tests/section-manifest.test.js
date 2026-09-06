// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getSectionPlugins,
  sectionIds,
  summaryBlockIds,
  getSectionPlugin,
  showInSummaryDefaultOf,
  registerSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';
import { defaultSectionLabels } from '../src/lib/section-labels.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';

// Capability: data-driven Section registry single-source contracts.

// --- Registry basics ---

test('the manifest is the canonical Section order, and is stable', () => {
  assert.deepEqual(sectionIds(), [
    'details',
    'questions',
    'issues',
    'summary',
    'remediation',
    'notes',
    'conversation',
    'appealRequest',
    'appealReview',
    'amendOutcome',
  ]);
  assert.deepEqual(sectionIds(), sectionIds(), 'repeated reads agree');
});

test('getSectionPlugins() entries have unique ids', () => {
  const ids = getSectionPlugins().map((e) => e.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size);
});

test('getSectionPlugins() entries have unique non-zero tab orders among tabs', () => {
  const tabs = getSectionPlugins().filter((e) => e.tab);
  const orders = tabs.map((e) => e.tabOrder);
  assert.equal(orders.length, new Set(orders).size);
  for (const order of orders) {
    assert.ok(order > 0, `tabOrder ${order} must be positive`);
  }
});

test('getSectionPlugins() entries have unique non-zero summary orders among summary blocks', () => {
  const blocks = getSectionPlugins().filter((e) => e.summaryBlock);
  const orders = blocks.map((e) => e.summaryOrder ?? 0);
  assert.equal(orders.length, new Set(orders).size);
  for (const order of orders) {
    assert.ok(order > 0, `summaryOrder ${order} must be positive`);
  }
});

// --- Derivers preserve the exact shapes the pre-registry code exported ---

test('sectionIds() is derived from the registry', () => {
  assert.deepEqual([...sectionIds()], sectionIds());
});

test('summaryBlockIds() is derived from the registry (summary blocks in order)', () => {
  assert.deepEqual([...summaryBlockIds()], summaryBlockIds());
  // Unchanged observable set: Conversation, Summary itself and the appeal /
  // amend Sections never appear as Summary blocks.
  assert.deepEqual(
    [...summaryBlockIds()],
    ['details', 'questions', 'issues', 'remediation', 'notes']
  );
});

// --- Tabs are derived, Summary ahead of Remediation ---

test('registered plugins derive tab order and ids', () => {
  const tabs = getSectionPlugins()
    .filter((p) => p.tab)
    .sort((a, b) => a.tabOrder - b.tabOrder);
  assert.deepEqual(
    tabs.map((t) => t.id),
    [
      'details',
      'questions',
      'issues',
      'summary',
      'remediation',
      'notes',
      'appealRequest',
      'appealReview',
      'amendOutcome',
    ]
  );
  // Conversation is never a tab.
  assert.ok(!tabs.some((t) => /** @type {string} */ (t.id) === 'conversation'));
});

// --- Consistency contracts ---

test('every registered SectionPlugin conforms to the contract', () => {
  const plugins = getSectionPlugins();
  assert.ok(plugins.length >= 10);
  for (const plugin of plugins) {
    assert.equal(typeof plugin.id, 'string');
    assert.equal(typeof plugin.tab, 'boolean');
    assert.equal(typeof plugin.tabOrder, 'number');
    assert.ok(plugin.defaultLabels);
    assert.equal(typeof plugin.defaultLabels.tab, 'string');
    assert.equal(typeof plugin.defaultLabels.heading, 'string');
    assert.equal(typeof plugin.evaluateAccess, 'function');
    assert.equal(typeof plugin.view, 'function');
  }
});

test('defaultSectionLabels() keys equal the registry Section ids (no drift)', () => {
  assert.deepEqual(
    [...Object.keys(defaultSectionLabels())].sort(),
    [...sectionIds()].sort()
  );
});

test('registry ids ⊇ every `sections` key declared by every Case Type', async () => {
  /** @type {Set<string>} */
  const known = new Set([
    ...sectionIds(),
    ...getSectionPlugins().map((p) => p.id),
  ]);
  for (const [slug, importer] of Object.entries(CASE_TYPE_IMPORTERS)) {
    const { default: config } = await importer();
    for (const key of Object.keys(config.sections ?? {})) {
      assert.ok(
        known.has(key),
        `Case Type "${slug}" declares section "${key}" absent from the registry`
      );
    }
  }
});

// --- Parameterized derivers allow fixtures to simulate additions ---

test('a registered Section flows into every derived structure', () => {
  /** @type {any} */
  const fixture = {
    id: 'fixtureSection',
    tab: true,
    tabOrder: 99,
    summaryBlock: true,
    summaryOrder: 99,
    showInSummaryDefault: false,
    defaultLabels: { tab: 'Fixture', heading: 'Fixture' },
    evaluateAccess: () => 'hidden',
    view: () => null,
  };
  registerSectionPlugin(fixture);
  try {
    assert.ok(
      sectionIds().includes('fixtureSection'),
      'appears in the id list'
    );
    assert.equal(
      summaryBlockIds().at(-1),
      'fixtureSection',
      'sorts into the Summary blocks by its own summaryOrder'
    );
    assert.equal(
      showInSummaryDefaultOf(/** @type {any} */ ('fixtureSection')),
      false
    );
    assert.equal(
      defaultSectionLabels().fixtureSection.tab,
      'Fixture',
      'its own labels are the defaults — nothing restates them'
    );
  } finally {
    resetSectionRegistry();
  }
  assert.ok(
    !sectionIds().includes('fixtureSection'),
    'reset restores the built-ins'
  );
});

// --- Contract: the Section id union is stated in exactly one place ---

test('the Section id union is stated in exactly one place', () => {
  // `Section` is projected from `getSectionPlugins()` in `section-registry.js`.
  // Nowhere in `src/` should an independent union of Section ids appear.
  // We check for a pattern of quoted section names separated by pipes in
  // JSDoc typedef comments outside `section-registry.js`.
  const src = readFileSync(
    new URL('../src/services/section-access.js', import.meta.url),
    'utf-8'
  );
  // Match any type annotation that lists three or more section ids in a union
  const unionPattern =
    /'(?:details|summary|questions|issues|remediation|notes|conversation|appealRequest|appealReview|amendOutcome)'\s*\|/g;
  const matches = src.match(unionPattern);
  assert.equal(
    matches,
    null,
    'src/services/section-access.js must not state an independent Section id union'
  );
});

// --- getSectionPlugin helper ---

test('getSectionPlugin resolves entries and returns undefined for unknown ids', () => {
  assert.equal(showInSummaryDefaultOf('notes'), false);
  assert.equal(showInSummaryDefaultOf('details'), true);
  assert.equal(getSectionPlugin(/** @type {any} */ ('nope')), undefined);
});

test('every Section declares its own layout metadata', () => {
  for (const plugin of getSectionPlugins()) {
    assert.equal(typeof plugin.tab, 'boolean', `${plugin.id}.tab`);
    assert.equal(typeof plugin.tabOrder, 'number', `${plugin.id}.tabOrder`);
    assert.equal(
      typeof plugin.summaryBlock,
      'boolean',
      `${plugin.id}.summaryBlock`
    );
    assert.equal(
      typeof plugin.summaryOrder,
      'number',
      `${plugin.id}.summaryOrder`
    );
    assert.equal(
      typeof plugin.showInSummaryDefault,
      'boolean',
      `${plugin.id}.showInSummaryDefault`
    );
    assert.equal(
      typeof plugin.defaultLabels?.tab,
      'string',
      `${plugin.id}.defaultLabels.tab`
    );
    assert.equal(
      typeof plugin.defaultLabels?.heading,
      'string',
      `${plugin.id}.defaultLabels.heading`
    );
  }
});
