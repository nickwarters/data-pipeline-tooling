// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONS,
  makeAmendOutcomeContext,
  makeAppealReviewContext,
  makeSummaryNotesAppealContext,
  updateAmendOutcome,
  updateAppealReview,
  updateSummaryNotesAppeal,
} from './helpers/cora-case-review-controllers.js';

// Capability: summary, notes, appeal, and amended-outcome routing.

test('updateSummaryNotesAppeal: assigns Summary, Notes, and Appeal tab props', () => {
  const {
    context,
    summary,
    notes,
    appeal,
    saveQueue,
    currentUser,
    answers,
    summarySections,
    captureGroups,
    computeOutcome,
    caseRow,
  } = makeSummaryNotesAppealContext();

  updateSummaryNotesAppeal(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (summary).caseRow, caseRow);
  assert.equal(/** @type {any} */ (summary).catalogue, QUESTIONS);
  assert.equal(/** @type {any} */ (summary).summarySections, summarySections);
  assert.equal(/** @type {any} */ (summary).captureGroups, captureGroups);
  assert.deepEqual(summary._updateArgs, [
    { computeOutcome, answers, allAnswered: true },
  ]);

  // Notes renders from and writes edits back onto the Case row (issue #317).
  assert.equal(/** @type {any} */ (notes).caseRow, caseRow);
  assert.equal(/** @type {any} */ (notes).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (notes).caseId, 'case-1');
  assert.equal(/** @type {any} */ (notes).access, 'edit');

  assert.equal(/** @type {any} */ (appeal).caseRow, caseRow);
  assert.equal(/** @type {any} */ (appeal).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (appeal).caseId, 'case-1');
  assert.equal(/** @type {any} */ (appeal).access, 'read-only');
  assert.equal(/** @type {any} */ (appeal).currentUser, currentUser);
  assert.equal(/** @type {any} */ (appeal).catalogue, QUESTIONS);
  assert.equal(/** @type {any} */ (appeal).answers, answers);
});

test('updateAmendOutcome: assigns the Amend Outcome tab props from the view model', () => {
  const {
    context,
    amendOutcome,
    saveQueue,
    currentUser,
    outcomeOptions,
    caseRow,
  } = makeAmendOutcomeContext();

  updateAmendOutcome(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (amendOutcome).caseRow, caseRow);
  assert.equal(/** @type {any} */ (amendOutcome).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (amendOutcome).caseId, 'case-1');
  assert.equal(/** @type {any} */ (amendOutcome).access, 'edit');
  assert.equal(/** @type {any} */ (amendOutcome).currentUser, currentUser);
  assert.equal(
    /** @type {any} */ (amendOutcome).outcomeOptions,
    outcomeOptions
  );
});

test('updateAmendOutcome: defaults outcomeOptions to an empty array when the Case Type declares none', () => {
  const { context, amendOutcome } = makeAmendOutcomeContext();
  context.viewModel.config = /** @type {any} */ ({});
  updateAmendOutcome(/** @type {any} */ (context));
  assert.deepEqual(/** @type {any} */ (amendOutcome).outcomeOptions, []);
});

test('updateAmendOutcome: no-ops when the node or required view-model state is absent', () => {
  const missingNode = makeAmendOutcomeContext();
  missingNode.context.nodes.amendOutcome = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    updateAmendOutcome(/** @type {any} */ (missingNode.context))
  );

  const missingCase = makeAmendOutcomeContext();
  missingCase.context.viewModel.caseRow = /** @type {any} */ (null);
  updateAmendOutcome(/** @type {any} */ (missingCase.context));
  assert.equal(
    /** @type {any} */ (missingCase.amendOutcome).caseRow,
    undefined,
    'no props assigned without a Case row'
  );
});

test('updateAppealReview: assigns the Appeal Review tab props from the view model', () => {
  const {
    context,
    appealReview,
    saveQueue,
    currentUser,
    outcomeOptions,
    caseRow,
  } = makeAppealReviewContext();

  updateAppealReview(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (appealReview).caseRow, caseRow);
  assert.equal(/** @type {any} */ (appealReview).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (appealReview).caseId, 'case-1');
  assert.equal(/** @type {any} */ (appealReview).access, 'edit');
  assert.equal(/** @type {any} */ (appealReview).currentUser, currentUser);
  assert.equal(
    /** @type {any} */ (appealReview).outcomeOptions,
    outcomeOptions
  );
});

test('updateAppealReview: defaults outcomeOptions to an empty array when the Case Type declares none', () => {
  const { context, appealReview } = makeAppealReviewContext();
  context.viewModel.config = /** @type {any} */ ({});
  updateAppealReview(/** @type {any} */ (context));
  assert.deepEqual(/** @type {any} */ (appealReview).outcomeOptions, []);
});

test('updateAppealReview: no-ops when the node or required view-model state is absent', () => {
  const missingNode = makeAppealReviewContext();
  missingNode.context.nodes.appealReview = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    updateAppealReview(/** @type {any} */ (missingNode.context))
  );

  const missingCase = makeAppealReviewContext();
  missingCase.context.viewModel.caseRow = /** @type {any} */ (null);
  updateAppealReview(/** @type {any} */ (missingCase.context));
  assert.equal(
    /** @type {any} */ (missingCase.appealReview).caseRow,
    undefined,
    'no props assigned without a Case row'
  );
});

test('updateSummaryNotesAppeal: threads resolved section headings to Summary, Notes, and Appeal', () => {
  const { context, summary, notes, appeal } = makeSummaryNotesAppealContext();
  /** @type {any} */ (context.viewModel).config.sectionLabels = {
    notes: 'Case Notes',
    appealRequest: 'Challenge',
    questions: 'Assessment',
  };

  updateSummaryNotesAppeal(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (notes).heading, 'Case Notes');
  assert.equal(/** @type {any} */ (appeal).heading, 'Challenge');
  const headings = /** @type {any} */ (summary).sectionHeadings;
  assert.equal(headings.notes, 'Case Notes');
  assert.equal(headings.questions, 'Assessment');
  assert.equal(headings.summary, 'Summary');
});

test('updateSummaryNotesAppeal: threads Case-Type-configured placeholders to Notes', () => {
  const { context, notes } = makeSummaryNotesAppealContext();
  /** @type {any} */ (context.viewModel).config.placeholders = {
    notes: 'Record anything the report should carry…',
  };

  updateSummaryNotesAppeal(/** @type {any} */ (context));

  assert.deepEqual(/** @type {any} */ (notes).placeholders, {
    notes: 'Record anything the report should carry…',
  });
});

test('updateSummaryNotesAppeal: defaults placeholders to an empty object when the Case Type declares none', () => {
  const { context, notes } = makeSummaryNotesAppealContext();

  updateSummaryNotesAppeal(/** @type {any} */ (context));

  assert.deepEqual(/** @type {any} */ (notes).placeholders, {});
});

test('updateSummaryNotesAppeal: defaults the section headings when no sectionLabels declared', () => {
  const { context, summary, notes, appeal } = makeSummaryNotesAppealContext();

  updateSummaryNotesAppeal(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (notes).heading, 'Notes');
  assert.equal(/** @type {any} */ (appeal).heading, 'Appeal');
  assert.equal(
    /** @type {any} */ (summary).sectionHeadings.questions,
    'Questions'
  );
});
