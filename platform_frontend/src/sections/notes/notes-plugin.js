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

  // The two plain-text Case Row columns this Section edits, and the whole of
  // what it may persist. Declared here rather than in a Case Type descriptor:
  // what a Section writes is a fact about the Section.
  writes: { fields: ['notes', 'caseJustification'] },

  // `persist` already carries this Section's declaration and the framework's
  // refusals, so there is nothing to add between it and the view.
  createActions: ({ persist }) => ({ fieldEdited: persist }),

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
        actions?.notes?.fieldEdited?.(field, value),
    });
  },
});
