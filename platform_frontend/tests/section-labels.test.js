// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SECTION_LABELS,
  resolveSectionLabels,
} from '../src/lib/section-labels.js';
import { SECTION_REGISTRY } from '../src/lib/section-registry.js';

test('every registered Section has a non-empty default label pair', () => {
  assert.deepEqual(
    Object.keys(DEFAULT_SECTION_LABELS).sort(),
    SECTION_REGISTRY.map(({ id }) => id).sort(),
    'a Section without labels renders an unnamed tab'
  );
  for (const [id, { tab, heading }] of Object.entries(DEFAULT_SECTION_LABELS)) {
    assert.ok(tab.trim(), `${id} has a tab label`);
    assert.ok(heading.trim(), `${id} has a heading`);
  }
});

test('resolveSectionLabels: returns the defaults unchanged when sectionLabels is absent', () => {
  assert.deepEqual(resolveSectionLabels({}), DEFAULT_SECTION_LABELS);
});

test('resolveSectionLabels: returns the defaults unchanged when config is null/undefined', () => {
  assert.deepEqual(resolveSectionLabels(null), DEFAULT_SECTION_LABELS);
  assert.deepEqual(resolveSectionLabels(undefined), DEFAULT_SECTION_LABELS);
});

test('resolveSectionLabels: a string override renames both the tab and the heading', () => {
  const resolved = resolveSectionLabels({
    sectionLabels: { questions: 'Assessment' },
  });

  assert.deepEqual(resolved.questions, {
    tab: 'Assessment',
    heading: 'Assessment',
  });
  assert.deepEqual(resolved.details, DEFAULT_SECTION_LABELS.details);
  assert.deepEqual(resolved.summary, DEFAULT_SECTION_LABELS.summary);
});

test('resolveSectionLabels: an object override patches only the axes it names', () => {
  const resolved = resolveSectionLabels({
    sectionLabels: { questions: { tab: 'Assessment' } },
  });

  assert.deepEqual(resolved.questions, {
    tab: 'Assessment',
    heading: 'Questions',
  });

  const headingOnly = resolveSectionLabels({
    sectionLabels: { details: { heading: 'About this Case' } },
  });

  assert.deepEqual(headingOnly.details, {
    tab: 'Details',
    heading: 'About this Case',
  });
});

test('resolveSectionLabels: an object override may set both axes to different copy', () => {
  const resolved = resolveSectionLabels({
    sectionLabels: { questions: { tab: 'Assess', heading: 'Assessment' } },
  });

  assert.equal(resolved.questions.tab, 'Assess');
  assert.equal(resolved.questions.heading, 'Assessment');
});

test('resolveSectionLabels: multiple overrides all apply', () => {
  const resolved = resolveSectionLabels({
    sectionLabels: { questions: 'Assessment', notes: 'Case Notes' },
  });

  assert.equal(resolved.questions.tab, 'Assessment');
  assert.equal(resolved.notes.heading, 'Case Notes');
  assert.equal(resolved.issues.heading, 'Issues');
});
