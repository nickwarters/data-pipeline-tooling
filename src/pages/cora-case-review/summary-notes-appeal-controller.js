// @ts-check
import { resolveSectionHeadings } from '../../lib/section-labels.js';

/**
 * Owns property assignment for Summary, Notes, and Appeal tabs.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateSummaryNotesAppeal(context) {
  const { viewModel: vm, nodes } = context;
  const { summary, notes, appeal } = nodes;
  const {
    caseRow,
    catalogue,
    config,
    answersSignal,
    allAnswered,
    currentUser,
    access,
    summarySections,
  } = vm;
  if (!summary || !notes || !appeal || !caseRow || !config || !currentUser)
    return;

  const answers = answersSignal.get();
  // Prefer the view model's resolved headings; fall back to resolving from
  // the config so the controller stays usable with minimal contexts.
  const headings = vm.sectionHeadings ?? resolveSectionHeadings(config);
  Object.assign(summary, {
    caseRow,
    catalogue,
    summarySections,
    captureGroups: config.captureGroups ?? [],
    detailFields: config.detailFields ?? [],
    outcomeOptions: config.outcomeOptions ?? [],
    sectionHeadings: headings,
  });
  if (/** @type {any} */ (summary)?.update) {
    /** @type {any} */ (summary).update({
      computeOutcome: config.computeOutcome,
      answers,
      allAnswered: allAnswered.get(),
    });
  }

  Object.assign(notes, {
    caseRow,
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    access: context.displayMode(access.notes),
    heading: headings.notes,
  });

  Object.assign(appeal, {
    caseRow,
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    access: context.displayMode(access.appealRequest),
    currentUser,
    catalogue,
    answers: caseRow.answers,
    heading: headings.appealRequest,
  });
}
