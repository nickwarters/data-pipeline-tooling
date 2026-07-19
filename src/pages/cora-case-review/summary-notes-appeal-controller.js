// @ts-check
import { resolveSectionHeadings } from '../../lib/section-labels.js';

/**
 * Owns property assignment for the remaining legacy Notes tab.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateNotes(context) {
  const { viewModel: vm, nodes } = context;
  const { notes } = nodes;
  const { caseRow, config, access } = vm;
  if (!notes || !caseRow || !config) return;

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
}
