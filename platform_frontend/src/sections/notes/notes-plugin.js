// src/sections/notes/notes-plugin.js
// @ts-check
import { notesView } from '../../pages/cora-case-review/notes-view.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { notesSummaryView } from '../../pages/cora-case-review/notes-summary-view.js';

/** @satisfies {import('../contract.js').SectionPlugin} */
export const NotesPlugin = /** @type {const} */ ({
  id: 'notes',
  tab: true,
  tabOrder: 6,
  summaryBlock: true,
  summaryOrder: 5,
  showInSummaryDefault: false,
  defaultLabels: { tab: 'Notes', heading: 'Notes' },

  evaluateAccess({ caseRow, roles }) {
    if (roles.includes('assignedReviewer')) {
      const status = caseRow?.status;
      return status === CASE_STATUS.COMPLETED || status === CASE_STATUS.VOID
        ? 'read-only'
        : 'edit';
    }
    const readOnlyRoles = ['otherReviewer', 'reviewerManager', 'caseTypeOwner'];
    if (roles.some((r) => readOnlyRoles.includes(r))) {
      return 'read-only';
    }
    return 'hidden';
  },

  summaryView: notesSummaryView,

  view({ caseRow, config, snapshot, actions }) {
    return notesView({
      notes: caseRow?.notes ?? '',
      caseJustification: caseRow?.caseJustification ?? '',
      access: snapshot?.access?.notes ?? 'hidden',
      heading: snapshot?.sectionLabels?.notes?.heading ?? 'Notes',
      placeholders: config?.placeholders ?? {},
      onFieldInput: (field, value) =>
        actions?.save?.fieldEdited?.(field, value),
    });
  },
});
