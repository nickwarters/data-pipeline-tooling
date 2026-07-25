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
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';

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

test('tabEntries derives tab order and ids from the registry', () => {
  const tabs = tabEntries();
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

// --- Demonstration: adding a Section touches only the registry (+ a component) ---

test('adding a Section to a fixture registry flows into every derived structure', () => {
  /** @type {any[]} */
  const withRisk = [
    ...SECTION_REGISTRY,
    {
      id: 'riskAssessment',
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

test('the Section id union is stated in exactly one place', () => {
  // ADR-0032: the registry is the single source of truth for which Sections
  // exist. The `Section` *type* is projected from it, so no other module may
  // spell the id list out as a hand-written union — a typo in a restated union
  // is self-consistent, so `tsc --checkJs` cannot catch it.
  for (const path of [
    'src/services/section-access.js',
    'src/sharepoint-client.js',
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(
      !/'appealRequest'\s*\|/.test(source),
      `${path} restates the Section id union; import it from src/lib/section-registry.js instead`
    );
  }
});

test('sectionById resolves entries and returns undefined for unknown ids', () => {
  assert.equal(sectionById('notes')?.showInSummaryDefault, false);
  assert.equal(sectionById('details')?.showInSummaryDefault, true);
  assert.equal(sectionById('nope'), undefined);
});

test('every registry entry declares exactly the SectionDefinition fields', () => {
  // `SECTION_REGISTRY` deliberately carries no `@type` annotation — that would
  // widen the literal `id`s away and `Section` could not be projected from
  // them. The helpers' defaulted `registry` parameter still catches a missing
  // or wrongly-typed field, but *excess* properties slip past `tsc` entirely:
  // adding `typo: true` to an entry type-checks clean. This closes that gap at
  // the seam the house style prefers, rather than contorting the types.
  const fields = [
    'id',
    'tab',
    'tabOrder',
    'summaryBlock',
    'summaryOrder',
    'showInSummaryDefault',
  ];
  for (const entry of SECTION_REGISTRY) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      [...fields].sort(),
      `Section "${entry.id}" does not declare exactly the SectionDefinition fields`
    );
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.tab, 'boolean');
    assert.equal(typeof entry.tabOrder, 'number');
    assert.equal(typeof entry.summaryBlock, 'boolean');
    assert.equal(typeof entry.summaryOrder, 'number');
    assert.equal(typeof entry.showInSummaryDefault, 'boolean');
  }
});
