// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SECTION_LABELS,
  resolveSectionLabels,
} from '../src/lib/section-labels.js';

test('DEFAULT_SECTION_LABELS: one entry per Section, each carrying both spellings', () => {
  assert.deepEqual(DEFAULT_SECTION_LABELS, {
    details: { tab: 'Details', heading: 'Case Details' },
    questions: { tab: 'Review', heading: 'Questions' },
    issues: { tab: 'Issues', heading: 'Issues' },
    remediation: { tab: 'Remediation', heading: 'Remediation' },
    summary: { tab: 'Summary', heading: 'Summary' },
    notes: { tab: 'Notes', heading: 'Notes' },
    appealRequest: { tab: 'Appeal', heading: 'Appeal' },
    appealReview: { tab: 'Appeal Review', heading: 'Appeal Review' },
    amendOutcome: { tab: 'Amend Outcome', heading: 'Amend Outcome' },
    conversation: { tab: 'Conversation', heading: 'Conversation' },
  });
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
