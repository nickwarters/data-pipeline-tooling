// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').SupportLogEntry} SupportLogEntry */

/** @type {SupportLogEntry[]} Every shape the page draws, all on CR-2003. */
export const supportLog = [
  {
    id: '5001',
    caseType: 'complaints',
    caseId: 'cr-2003',
    caseReference: 'CR-2003',
    action: 'reassign',
    reason: 'The original Reviewer is on long-term leave.',
    changes: [
      {
        field: 'assignedReviewer',
        before: 'user-reviewer-2',
        after: 'user-reviewer',
      },
    ],
    outcome: 'recorded',
    relatesTo: null,
    createdAt: '2026-10-01T09:15:00Z',
    createdBy: 'Robin Maintainer',
  },
  {
    id: '5002',
    caseType: 'complaints',
    caseId: 'cr-2003',
    caseReference: 'CR-2003',
    action: 'flags',
    reason: 'The awaiting flag stayed set after the Responsible Party replied.',
    changes: [
      { field: 'awaitingResponsibleParty', before: true, after: false },
      { field: 'awaitingSince', before: '2026-09-20T10:00:00Z', after: null },
    ],
    outcome: 'recorded',
    relatesTo: null,
    createdAt: '2026-10-02T14:30:00Z',
    createdBy: 'Robin Maintainer',
  },
  {
    id: '5003',
    caseType: 'complaints',
    caseId: 'cr-2003',
    caseReference: 'CR-2003',
    action: 'flags',
    reason:
      'The Case changed while this action was being applied, so nothing was changed.',
    changes: [],
    outcome: 'not-applied',
    relatesTo: '5002',
    createdAt: '2026-10-02T14:30:02Z',
    createdBy: 'Robin Maintainer',
  },
];
