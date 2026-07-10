// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SECTION_HEADINGS,
  DEFAULT_SECTION_LABELS,
  resolveSectionHeadings,
  resolveSectionLabels,
} from '../src/lib/section-labels.js';

test('DEFAULT_SECTION_LABELS: matches the exact current hardcoded tab/heading strings', () => {
  assert.deepEqual(DEFAULT_SECTION_LABELS, {
    details: 'Details',
    questions: 'Review',
    issues: 'Issues',
    remediation: 'Remediation',
    summary: 'Summary',
    notes: 'Notes',
    appealRequest: 'Appeal',
    appealReview: 'Appeal Review',
    amendOutcome: 'Amend Outcome',
    conversation: 'Conversation',
  });
});

test('resolveSectionLabels: returns the defaults unchanged when sectionLabels is absent', () => {
  assert.deepEqual(resolveSectionLabels({}), DEFAULT_SECTION_LABELS);
});

test('resolveSectionLabels: returns the defaults unchanged when config is null/undefined', () => {
  assert.deepEqual(resolveSectionLabels(null), DEFAULT_SECTION_LABELS);
  assert.deepEqual(resolveSectionLabels(undefined), DEFAULT_SECTION_LABELS);
});

test('resolveSectionLabels: an override merges over the defaults, leaving other keys untouched', () => {
  const resolved = resolveSectionLabels({
    sectionLabels: { questions: 'Assessment' },
  });

  assert.equal(resolved.questions, 'Assessment');
  assert.equal(resolved.details, 'Details');
  assert.equal(resolved.summary, 'Summary');
});

test('DEFAULT_SECTION_HEADINGS: matches the tab labels except the questions panel heading', () => {
  assert.deepEqual(DEFAULT_SECTION_HEADINGS, {
    ...DEFAULT_SECTION_LABELS,
    questions: 'Questions',
  });
});

test('resolveSectionHeadings: returns the heading defaults unchanged when sectionLabels is absent', () => {
  assert.deepEqual(resolveSectionHeadings({}), DEFAULT_SECTION_HEADINGS);
  assert.deepEqual(resolveSectionHeadings(null), DEFAULT_SECTION_HEADINGS);
});

test('resolveSectionHeadings: an override merges over the heading defaults', () => {
  const resolved = resolveSectionHeadings({
    sectionLabels: { questions: 'Assessment' },
  });

  assert.equal(resolved.questions, 'Assessment');
  assert.equal(resolved.notes, 'Notes');
});

test('resolveSectionLabels: multiple overrides all apply', () => {
  const resolved = resolveSectionLabels({
    sectionLabels: { questions: 'Assessment', notes: 'Case Notes' },
  });

  assert.equal(resolved.questions, 'Assessment');
  assert.equal(resolved.notes, 'Case Notes');
  assert.equal(resolved.issues, 'Issues');
});
