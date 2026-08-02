// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */

import { MockSharePointClient } from '../../src/services/mock-sharepoint-client.js';

import { reasonFlagFields } from '../../src/services/action-centre-flags.js';

import { makeCaseRow } from './fixtures.js';

// Standard named Case-list store for mock-client capability suites.
export const LIST = 'Cases-Test';

/** @type {CaseRow[]} */
export const CASES = [
  makeCaseRow({
    caseType: 'example-review',
    title: 'Example Review #1',
    assignedReviewer: 'user-1',
    responsibleParty: 'user-2',
  }),
  makeCaseRow({
    id: 'case-2',
    caseType: 'example-review',
    title: 'Example Review #2',
    assignedReviewer: 'user-1',
    responsibleParty: 'user-3',
    answers: { 'q-welcome': { value: 'Yes' } },
    etag: 'etag-2',
  }),
  makeCaseRow({
    id: 'case-3',
    caseType: 'example-review',
    title: 'Example Review #3',
    status: 'Completed',
    assignedReviewer: 'user-2',
    responsibleParty: 'user-4',
    answers: { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'No' } },
    completedAt: '2026-05-07T00:00:00Z',
    etag: 'etag-3',
  }),
];

export const PERSONAS = {
  reviewer: { groups: ['Reviewers'] },
  owner: { groups: ['Reviewers', 'CaseTypeOwners'] },
};

/** @param {string} [persona] */
export function makeClient(persona = 'reviewer') {
  return new MockSharePointClient({
    lists: { [LIST]: CASES },
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
  return makeCaseRow({
    id,
    caseType: 'example-review',
    title: id,
    status: completedAt ? 'Completed' : 'In-progress',
    assignedReviewer: 'u',
    responsibleParty: 'rp',
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
    personas: PERSONAS,
    people,
  });
}

// --- getVersionedExport ---

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
      failureValues: ['No'],
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
  return makeCaseRow({
    id,
    title: id,
    assignedReviewer: '',
    responsibleParty: '',
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
    personas: PERSONAS,
  });
}

export { MockSharePointClient, reasonFlagFields };
