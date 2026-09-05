// src/sections/details/details-plugin.js
// @ts-check
import { caseDetailsView } from '../../pages/cora-case-review/details-view.js';
import {
  voidControl,
  voidControlView,
} from '../../pages/cora-case-review/void-actions.js';

/** @type {import('../registry.js').SectionPlugin} */
export const DetailsPlugin = {
  id: 'details',
  tab: true,
  tabOrder: 1,
  summaryBlock: true,
  summaryOrder: 1,
  showInSummaryDefault: true,
  defaultLabels: {
    tab: 'Details',
    heading: 'Case Details',
  },

  evaluateAccess({ roles }) {
    const reviewerSide = [
      'assignedReviewer',
      'otherReviewer',
      'reviewerManager',
      'caseTypeOwner',
      'controls',
      'journeyOwner',
    ];
    if (roles.some((role) => reviewerSide.includes(role))) {
      return 'read-only';
    }
    return 'hidden';
  },

  view({ snapshot, caseRow, config, route, dispatch, actions }) {
    const control = voidControl({
      machine: snapshot.machine,
      config,
      reasonKey: route?.voidReason,
      note: route?.voidReasonNote,
    });
    const details = caseDetailsView(
      caseRow,
      config?.detailFields ?? [],
      snapshot.sectionLabels?.details?.heading ?? 'Case Details'
    );
    const voidView = voidControlView({
      control,
      disclosureOpen: route?.voidPanelOpen ?? false,
      pending: route?.voidPending ?? false,
      onToggle: () => dispatch({ type: 'case/void-panel-toggled' }),
      onReasonSelected: (reasonKey) =>
        dispatch({ type: 'case/void-reason-selected', reasonKey }),
      onNoteChanged: (note) =>
        dispatch({ type: 'case/void-note-changed', note }),
      onConfirm: actions?.onVoid,
    });
    return voidView ? [details, voidView] : [details];
  },
};
