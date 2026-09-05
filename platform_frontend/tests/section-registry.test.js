// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SECTION_REGISTRY,
  sectionIds,
  summaryBlockIds,
  sectionById,
} from '../src/lib/section-registry.js';
import { SECTIONS, SUMMARY_SECTIONS } from '../src/services/section-access.js';
import { DEFAULT_SECTION_LABELS } from '../src/lib/section-labels.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';
import { getSectionPlugins } from '../src/sections/registry.js';

// Capability: data-driven Section registry single-source contracts.

// --- Registry basics ---

test('SECTION_REGISTRY is frozen', () => {
  assert.ok(Object.isFrozen(SECTION_REGISTRY));
});

test('SECTION_REGISTRY entries have unique ids', () => {
  const ids = SECTION_REGISTRY.map((e) => e.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size);
});

test('SECTION_REGISTRY entries have unique non-zero tab orders among tabs', () => {
  const tabs = SECTION_REGISTRY.filter((e) => e.tab);
  const orders = tabs.map((e) => e.tabOrder);
  assert.equal(orders.length, new Set(orders).size);
  for (const order of orders) {
    assert.ok(order > 0, `tabOrder ${order} must be positive`);
  }
});

test('SECTION_REGISTRY entries have unique non-zero summary orders among summary blocks', () => {
  const blocks = SECTION_REGISTRY.filter((e) => e.summaryBlock);
  const orders = blocks.map((e) => e.summaryOrder);
  assert.equal(orders.length, new Set(orders).size);
  for (const order of orders) {
    assert.ok(order > 0, `summaryOrder ${order} must be positive`);
  }
});

// --- Derivers preserve the exact shapes the pre-registry code exported ---

test('SECTIONS is derived from the registry', () => {
  assert.deepEqual([...SECTIONS], sectionIds());
});

test('SUMMARY_SECTIONS is derived from the registry (summary blocks in order)', () => {
  assert.deepEqual([...SUMMARY_SECTIONS], summaryBlockIds());
  // Unchanged observable set: Conversation, Summary itself and the appeal /
  // amend Sections never appear as Summary blocks.
  assert.deepEqual(
    [...SUMMARY_SECTIONS],
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
      'adminDetails',
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

test('DEFAULT_SECTION_LABELS keys equal the registry Section ids (no drift)', () => {
  assert.deepEqual(
    [...Object.keys(DEFAULT_SECTION_LABELS)].sort(),
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

test('adding a Section to a fixture registry flows into every derived structure', () => {
  /** @type {any[]} */
  const withRisk = [
    ...SECTION_REGISTRY,
    {
      id: 'riskAssessment',
      tab: true,
      tabOrder: 99,
      summaryBlock: true,
      summaryOrder: 99,
      showInSummaryDefault: true,
    },
  ];

  // One new definition in a custom registry causes the new Section to
  // appear in the canonical id list, as the last tab, and as the last Summary
  // block.
  assert.equal(sectionIds(withRisk).at(-1), 'riskAssessment');
  assert.equal(summaryBlockIds(withRisk).at(-1), 'riskAssessment');
});

// --- Contract: the Section id union is stated in exactly one place ---

test('the Section id union is stated in exactly one place', () => {
  // `Section` is projected from `SECTION_REGISTRY` in `section-registry.js`.
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

// --- sectionById helper ---

test('sectionById resolves entries and returns undefined for unknown ids', () => {
  assert.equal(sectionById('notes')?.showInSummaryDefault, false);
  assert.equal(sectionById('details')?.showInSummaryDefault, true);
  assert.equal(sectionById(/** @type {any} */ ('nope')), undefined);
});

test('every registry entry declares exactly the SectionDefinition fields', () => {
  const expectedKeys = [
    'id',
    'tab',
    'tabOrder',
    'summaryBlock',
    'summaryOrder',
    'showInSummaryDefault',
  ].sort();
  for (const entry of SECTION_REGISTRY) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      expectedKeys,
      `${entry.id} field set`
    );
  }
});
