// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

import { MockSharePointClient } from '../../src/services/mock-sharepoint-client.js';

import { reasonFlagFields } from '../../src/services/action-centre-flags.js';

// Standard named Case-list store for mock-client capability suites.
export const LIST = 'Cases-Test';

/** @type {CaseRow[]} */
export const CASES = [
  {
    id: 'case-1',
    caseType: 'example-review',
    title: 'Example Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-1',
    responsibleParty: 'user-2',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-1',
  },
  {
    id: 'case-2',
    caseType: 'example-review',
    title: 'Example Review #2',
    status: 'In-progress',
    assignedReviewer: 'user-1',
    responsibleParty: 'user-3',
    answers: { 'q-welcome': { value: 'Yes' } },
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-2',
  },
  {
    id: 'case-3',
    caseType: 'example-review',
    title: 'Example Review #3',
    status: 'Completed',
    assignedReviewer: 'user-2',
    responsibleParty: 'user-4',
    answers: { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'No' } },
    conversation: [],
    notes: '',
    completedAt: '2026-05-07T00:00:00Z',
    etag: 'etag-3',
  },
];

/** @type {QuestionDefinition[]} */
export const QUESTION_DEFS = [
  {
    id: 'q-welcome',
    text: 'Was the customer greeted professionally?',
    responseType: 'yes-no-na',
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: "Were the customer's needs identified?",
    responseType: 'yes-no-na',
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Was the issue resolved?',
    responseType: 'yes-no-na',
    showWhen: { questionId: 'q-needs', equals: 'Yes' },
    deprecated: false,
  },
];

export const PERSONAS = {
  reviewer: { groups: ['Reviewers'] },
  owner: { groups: ['Reviewers', 'CaseTypeOwners'] },
};

/** @param {string} [persona] */
export function makeClient(persona = 'reviewer') {
  return new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    persona,
  });
}

/**
 * @param {string} id
 * @param {string | null} completedAt
 * @returns {CaseRow}
 */
export function completedCase(id, completedAt) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'example-review',
    title: id,
    status: completedAt ? 'Completed' : 'In-progress',
    assignedReviewer: 'u',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt,
    etag: `etag-${id}`,
  });
}

/** @type {Array<{ loginName: string, displayName: string, email?: string }>} */
export const PEOPLE = [
  {
    loginName: 'jsmith',
    displayName: 'John Smith',
    email: 'jsmith@contoso.com',
  },
  {
    loginName: 'asmith',
    displayName: 'Anna Smith',
    email: 'asmith@contoso.com',
  },
  { loginName: 'bjones', displayName: 'Bola Jones' },
];

/** @param {Array<{ loginName: string, displayName: string, email?: string }>} [people] */
export function makePeopleClient(people = PEOPLE) {
  return new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    people,
  });
}

// --- getVersionedExport (ADR-0021 Step 4) ---

export const VERSIONED_EXPORT = {
  slug: 'example-review',
  label: 'Example Review',
  generatedAt: '2026-01-10T09:00:00.000Z',
  hash: 'sha256:' + 'a'.repeat(64),
  questions: [
    {
      id: 'q-v1',
      text: 'V1 question',
      category: null,
      responseType: 'yes-no-na',
      options: null,
      showWhen: null,
      failureCriteria: 'No',
      deprecated: false,
    },
  ],
};

/**
 * @param {string} id
 * @param {Partial<CaseRow>} [over]
 * @returns {CaseRow}
 */
export function reasonCase(id, over = {}) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: id,
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: `etag-${id}`,
    ...over,
  });
}

export function makeReasonClient() {
  return new MockSharePointClient({
    lists: {
      [LIST]: [
        reasonCase('await-1', {
          awaitingResponsibleParty: true,
          awaitingSince: '2026-06-01T00:00:00Z',
        }),
        reasonCase('await-2', {
          awaitingResponsibleParty: true,
          awaitingSince: '2026-06-20T00:00:00Z',
        }),
        reasonCase('appeal-1', {
          status: 'Completed',
          hasOpenAppeal: true,
          appealRaisedAt: '2026-06-15T00:00:00Z',
          completedAt: '2026-06-10T00:00:00Z',
        }),
        reasonCase('reopened-1', {
          reopened: true,
          reopenedAt: '2026-06-25T00:00:00Z',
        }),
        reasonCase('plain-1', {}),
      ],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });
}

export { MockSharePointClient, reasonFlagFields };
