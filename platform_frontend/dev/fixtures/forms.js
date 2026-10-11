// @ts-check
/**
 * 1-to-1 Forms for mock mode (?mock=1), stored as the real list would hold
 * them: people and dates plain, free text and Form Actions encoded.
 *
 * The cast is the seven Forms personas in `personas.js`:
 *
 * - `forms-employee` (Sam Patel) is the Employee on five Forms: one open and
 *   overdue, one open and due later, one Completed, one Void and one
 *   Cancelled so long ago it falls outside the archive's default window.
 * - `forms-line-manager` (Ana Lopez) is Sam's current first line manager on all
 *   three, and the Employee on a fourth, managed by Jo Reid.
 * - `forms-second-line-manager` (Jo Reid) is Sam's current second line manager.
 * - The Completed Form records a different first line manager at completion
 *   (Lee Morgan), who is no longer current and so has no access to it.
 * - `forms-former-manager` (Lee Morgan) is that former manager, still in the
 *   Forms group.
 * - `forms-control` (Kim Shaw) is on none of them; `forms-colleague` (Ade
 *   Okafor) is in the Forms group and on none of them; `forms-unrelated` (Ola
 *   Ben) is on none of them and has no Forms access at all.
 */

import { oneToOne } from '../../form-types/one-to-one.js';
import { storedFormFields } from '../../src/services/mock-sharepoint-client.js';

/** @typedef {import('../../src/services/mock-sharepoint-client.js').StoredFormItem} StoredFormItem */

const SAM = { loginName: 'user-forms-employee', displayName: 'Sam Patel' };
const ANA = { loginName: 'user-forms-flm', displayName: 'Ana Lopez' };
const JO = { loginName: 'user-forms-slm', displayName: 'Jo Reid' };
const LEE = { loginName: 'user-forms-former-flm', displayName: 'Lee Morgan' };

/**
 * @param {string} id
 * @param {string} created
 * @param {Record<string, import('../../src/sharepoint-client.js').FormValue>} fields
 * @returns {StoredFormItem}
 */
function oneToOneItem(id, created, fields) {
  return {
    id,
    etag: `"form-${id}"`,
    created,
    modified: created,
    fields: storedFormFields(oneToOne, fields),
  };
}

/** @type {Record<string, StoredFormItem[]>} */
export const formLists = {
  [oneToOne.listName]: [
    oneToOneItem('101', '2026-09-01T09:00:00Z', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      FirstLineManager: ANA,
      SecondLineManager: JO,
      Status: 'Pending',
      DueDate: '2026-09-30',
      MeetingDate: '2026-09-28',
      CompetencyStage: 'Stage 2',
      Location: 'In person',
      Tags: 'wellbeing, goals',
      Agenda: 'Quarter review — what went well, what’s next.',
      Wellbeing: 'Feeling good overall 🙂, a busy month.',
      Performance: 'Closed the backlog early; £ savings on the audit.',
      DevelopmentGrowth: '',
      OtherNotes: '',
      IndividualComments: 'Happy with the plan.',
      LineManagerComments: '',
      Actions: [
        {
          title: 'Book the SQL course',
          dueDate: '2026-10-15',
          status: 'Pending',
          details: 'Ask about the October intake.',
        },
      ],
    }),
    oneToOneItem('102', '2026-10-01T09:00:00Z', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      FirstLineManager: ANA,
      SecondLineManager: JO,
      Status: 'Pending',
      DueDate: '2026-10-31',
    }),
    oneToOneItem('103', '2026-06-01T09:00:00Z', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      FirstLineManager: LEE,
      SecondLineManager: JO,
      Status: 'Completed',
      DueDate: '2026-06-30',
      ClosedDate: '2026-06-24',
      ClosedBy: LEE,
      FormTitle: 'First quarter check-in',
      MeetingDate: '2026-06-24',
      CompetencyStage: 'Stage 1',
      Location: 'In person',
      Agenda: 'Settling in.',
      Wellbeing: 'Good.',
      Performance: 'On track.',
      IndividualComments: 'Thanks Lee.',
      LineManagerComments: 'A strong first quarter.',
      Actions: [],
    }),
    oneToOneItem('105', '2026-07-01T09:00:00Z', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      FirstLineManager: null,
      SecondLineManager: null,
      Status: 'Void',
      DueDate: '2026-07-31',
      ClosedDate: '2026-07-03',
      ClosedBy: SAM,
      VoidReason: 'Other',
      VoidReasonNote: 'Booked for the wrong week.',
    }),
    oneToOneItem('106', '2025-01-02T09:00:00Z', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      FirstLineManager: null,
      SecondLineManager: null,
      Status: 'Cancelled',
      DueDate: '2025-01-31',
      ClosedDate: '2025-01-10',
      ClosedBy: ANA,
    }),
    oneToOneItem('104', '2026-09-15T09:00:00Z', {
      Employee: ANA,
      CurrentFirstLineManager: JO,
      CurrentSecondLineManager: null,
      FirstLineManager: JO,
      SecondLineManager: null,
      Status: 'Pending',
      DueDate: '2026-10-20',
    }),
  ],
};
