// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SECTION_REGISTRY,
  sectionIds,
  tabEntries,
  summaryBlockIds,
  sectionById,
} from '../src/lib/section-registry.js';
import {
  SECTIONS,
  SUMMARY_SECTIONS,
  MATRIX,
} from '../src/services/section-access.js';
import { DEFAULT_SECTION_LABELS } from '../src/lib/section-labels.js';
import { buildCaseReviewTabs } from '../src/pages/cora-case-review/tab-controller.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';

const ROOT = new URL('../', import.meta.url);

/** @param {string} path */
function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

// --- The registry itself ---

test('SECTION_REGISTRY declares the ten built-in Sections in canonical order', () => {
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
});

test('every registry entry has the wiring the derivations need', () => {
  for (const entry of SECTION_REGISTRY) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.nodeKey, 'string');
    assert.ok(
      entry.componentTag === null || typeof entry.componentTag === 'string'
    );
    assert.equal(typeof entry.tab, 'boolean');
    assert.equal(typeof entry.summaryBlock, 'boolean');
    assert.equal(typeof entry.showInSummaryDefault, 'boolean');
  }
});

// --- SECTIONS / SUMMARY_SECTIONS are derived, not restated ---

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

// --- Tabs are derived, in the historical order ---

test('buildCaseReviewTabs derives tab order and ids from the registry', () => {
  /** @type {any} */
  const context = {
    viewModel: {
      config: {},
      access: Object.fromEntries(SECTIONS.map((s) => [s, 'read-only'])),
    },
  };
  const tabs = buildCaseReviewTabs(context);
  assert.deepEqual(
    tabs.map((t) => t.id),
    [
      'details',
      'questions',
      'issues',
      'remediation',
      'summary',
      'notes',
      'appealRequest',
      'appealReview',
      'amendOutcome',
    ]
  );
  // Conversation is never a tab.
  assert.ok(!tabs.some((t) => /** @type {string} */ (t.id) === 'conversation'));
});

test('tab labels come from the resolved labels, hidden from the access map', () => {
  /** @type {any} */
  const context = {
    viewModel: {
      config: {},
      access: { ...Object.fromEntries(SECTIONS.map((s) => [s, 'read-only'])) },
    },
  };
  context.viewModel.access.notes = 'hidden';
  const tabs = buildCaseReviewTabs(context);
  const notes = tabs.find((t) => t.id === 'notes');
  assert.equal(notes?.label, DEFAULT_SECTION_LABELS.notes);
  assert.equal(notes?.hidden, true);
  assert.equal(tabs.find((t) => t.id === 'details')?.hidden, false);
});

// --- Consistency contracts (ADR-0032 acceptance criteria) ---

test('the access MATRIX keys equal the registry Section ids (no drift)', () => {
  assert.deepEqual([...Object.keys(MATRIX)].sort(), [...sectionIds()].sort());
});

test('DEFAULT_SECTION_LABELS keys equal the registry Section ids', () => {
  assert.deepEqual(
    [...Object.keys(DEFAULT_SECTION_LABELS)].sort(),
    [...sectionIds()].sort()
  );
});

test('registry ids ⊇ every `sections` key declared by every Case Type', async () => {
  /** @type {Set<string>} */
  const known = new Set(sectionIds());
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

test('tab-controller.js lists no Section ids independently — it derives them', () => {
  const src = read('src/pages/cora-case-review/tab-controller.js');
  // None of the tab-only Section ids should appear as a string literal now that
  // the tab list and panel map are derived from the registry.
  for (const id of [
    'appealRequest',
    'appealReview',
    'amendOutcome',
    'issues',
  ]) {
    assert.doesNotMatch(
      src,
      new RegExp(`['"]${id}['"]`),
      `tab-controller.js still hardcodes the "${id}" Section id`
    );
  }
});

test('the node registry materializes each registry componentTag under its nodeKey', () => {
  const src = read('src/pages/cora-case-review/node-registry.js');
  // The uniform Section panels are created by looping the registry; assert no
  // Section is left independently hand-created with its own h('cora-...') call.
  for (const entry of SECTION_REGISTRY) {
    if (!entry.componentTag) continue;
    assert.doesNotMatch(
      src,
      new RegExp(`h\\(['"]${entry.componentTag}['"]\\)`),
      `node-registry.js still hand-creates ${entry.componentTag}; derive it from the registry`
    );
  }
});

// --- Demonstration: adding a Section touches only the registry (+ a component) ---

test('adding a Section to a fixture registry flows into every derived structure', () => {
  /** @type {any[]} */
  const withRisk = [
    ...SECTION_REGISTRY,
    {
      id: 'riskAssessment',
      componentTag: 'cora-risk-assessment',
      nodeKey: 'riskAssessment',
      tab: true,
      tabOrder: 10,
      summaryBlock: true,
      summaryOrder: 6,
      showInSummaryDefault: true,
    },
  ];

  // A single registry entry — no other list edited — makes the new Section
  // appear in the canonical id list, as the last tab, and as the last Summary
  // block.
  assert.equal(sectionIds(withRisk).at(-1), 'riskAssessment');
  assert.equal(tabEntries(withRisk).at(-1)?.id, 'riskAssessment');
  assert.equal(summaryBlockIds(withRisk).at(-1), 'riskAssessment');
});

test('sectionById resolves entries and returns undefined for unknown ids', () => {
  assert.equal(sectionById('notes')?.showInSummaryDefault, false);
  assert.equal(sectionById('details')?.showInSummaryDefault, true);
  assert.equal(sectionById('nope'), undefined);
});
