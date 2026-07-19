// @ts-check
import { resolveSectionHeadings } from '../../lib/section-labels.js';

/**
 * Owns property assignment for the remaining Notes and Appeal tabs.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateSummaryNotesAppeal(context) {
  const { viewModel: vm, nodes } = context;
  const { notes, appeal } = nodes;
  const {
    caseRow,
    catalogue,
    config,
    answersSignal,
    allAnswered,
    currentUser,
    access,
  } = vm;
  if (!notes || !appeal || !caseRow || !config || !currentUser) return;

  // Prefer the view model's resolved headings; fall back to resolving from
  // the config so the controller stays usable with minimal contexts.
  const headings = vm.sectionHeadings ?? resolveSectionHeadings(config);

  Object.assign(notes, {
    caseRow,
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    access: context.displayMode(access.notes),
    heading: headings.notes,
    placeholders: config.placeholders ?? {},
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
